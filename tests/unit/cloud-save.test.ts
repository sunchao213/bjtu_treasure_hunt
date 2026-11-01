import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudSave } from '../../src/modules/save/cloud-save';
import {
  CloudSaveError,
  HttpCloudSaveApi,
  type CloudSaveApi,
} from '../../src/modules/save/cloud-save-api';
import { FORMAL_SAVE_KEY, type FormalSaveData } from '../../src/modules/save/persistent-save';

const empty = (): FormalSaveData => ({
  schemaVersion: 3,
  warehouse: [],
  codexIds: [],
  unlockedChapterIds: [],
  activeRaid: null,
  settledRaidIds: [],
  lastResult: null,
});
const storage = (raw: string | null = null) => {
  let value = raw;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, next: string) => {
      value = next;
    }),
  };
};
function endpoint(data: FormalSaveData | null = empty()) {
  let revision = 5;
  const api = {
    open: vi.fn(async () => ({
      data,
      revision,
      leaseToken: 'A'.repeat(64),
      leaseExpiresAt: Date.now() + 90_000,
    })),
    write: vi.fn<CloudSaveApi['write']>(async () => ({
      revision: ++revision,
      leaseExpiresAt: Date.now() + 90_000,
    })),
    heartbeat: vi.fn(async () => ({ leaseExpiresAt: Date.now() + 90_000 })),
    release: vi.fn(async () => undefined),
  } satisfies CloudSaveApi;
  return api;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('cloud progress transactions', () => {
  it('loads cloud progress instead of overwriting it with an older browser copy', async () => {
    const remote = { ...empty(), codexIds: ['school-badge'] };
    const cache = storage(JSON.stringify(empty()));
    const api = endpoint(remote);
    const save = await CloudSave.connect(cache, api, { onLost: vi.fn() });
    expect(save.view().codexIds).toEqual(['school-badge']);
    expect(api.write).not.toHaveBeenCalled();
    expect(cache.setItem).toHaveBeenCalledWith(FORMAL_SAVE_KEY, JSON.stringify(remote));
    save.close();
  });

  it('uploads the account browser save only when the cloud has no save yet', async () => {
    const legacy = { ...empty(), codexIds: ['school-badge'] };
    const api = endpoint(null);
    const save = await CloudSave.connect(storage(JSON.stringify(legacy)), api, { onLost: vi.fn() });
    expect(api.write).toHaveBeenCalledWith('A'.repeat(64), 5, legacy);
    expect(save.view()).toEqual(legacy);
    save.close();
  });

  it('refuses a corrupt first-time import and releases the cloud lock without writing', async () => {
    const api = endpoint(null);
    await expect(CloudSave.connect(storage('broken'), api, { onLost: vi.fn() })).rejects.toThrow();
    expect(api.write).not.toHaveBeenCalled();
    expect(api.release).toHaveBeenCalledExactlyOnceWith('A'.repeat(64));
  });

  it('does not consume carry-in or advance local progress before the database confirms the write', async () => {
    const api = endpoint();
    const cache = storage();
    const save = await CloudSave.connect(cache, api, { onLost: vi.fn() });
    api.write.mockRejectedValueOnce(new CloudSaveError('unavailable', 503));
    await expect(save.beginRaid('retry-raid', [])).rejects.toThrow('unavailable');
    expect(save.view().activeRaid).toBeNull();
    expect(JSON.parse(cache.getItem()!).activeRaid).toBeNull();
    await save.beginRaid('retry-raid', []);
    expect(save.view().activeRaid?.raidId).toBe('retry-raid');
    expect(api.write.mock.calls[0]?.[1]).toBe(api.write.mock.calls[1]?.[1]);
    save.close();
  });

  it('keeps a confirmed database commit even when the local backup quota is exhausted', async () => {
    const cache = storage();
    const status = vi.fn();
    cache.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    const save = await CloudSave.connect(cache, endpoint(), { onLost: vi.fn(), onStatus: status });
    await save.beginRaid('confirmed', []);
    expect(save.view().activeRaid?.raidId).toBe('confirmed');
    expect(status).toHaveBeenLastCalledWith('云端已保存，本地备份暂不可用');
    save.close();
  });

  it('serializes simultaneous actions using the revision returned by the preceding commit', async () => {
    const api = endpoint();
    const save = await CloudSave.connect(storage(), api, { onLost: vi.fn() });
    const began = save.beginRaid('serial', []);
    const reset = save.reset();
    await Promise.all([began, reset]);
    expect(api.write.mock.calls.map((call) => call[1])).toEqual([5, 6]);
    expect(api.write.mock.calls[0]?.[2].activeRaid?.raidId).toBe('serial');
    expect(api.write.mock.calls[1]?.[2].activeRaid).toBeNull();
    expect(save.view().activeRaid).toBeNull();
    save.close();
  });

  it('recovers an interrupted raid on the server before exposing the recovered progress', async () => {
    const api = endpoint({ ...empty(), activeRaid: { raidId: 'interrupted', loadout: [] } });
    const save = await CloudSave.connect(storage(), api, { onLost: vi.fn() });
    expect(await save.recoverInterrupted()).toBe(true);
    expect(save.view().lastResult?.reason).toBe('interrupted');
    expect(api.write.mock.calls[0]?.[2].settledRaidIds).toEqual(['interrupted']);
    save.close();
  });

  it('blocks further writes and returns to login when the server revokes ownership', async () => {
    const api = endpoint();
    const lost = vi.fn();
    const save = await CloudSave.connect(storage(), api, { onLost: lost });
    api.write.mockRejectedValueOnce(new CloudSaveError('conflict', 409));
    await expect(save.beginRaid('revoked', [])).rejects.toThrow('conflict');
    expect(lost).toHaveBeenCalledTimes(1);
    await expect(save.beginRaid('invalid', [])).rejects.toThrow('已关闭');
    expect(api.write).toHaveBeenCalledTimes(1);
  });

  it('stops play when repeated network failures allow the cloud lease to expire', async () => {
    const api = endpoint();
    api.heartbeat.mockRejectedValue(new CloudSaveError('offline', 0));
    const lost = vi.fn();
    const save = await CloudSave.connect(storage(), api, { onLost: lost });
    await vi.advanceTimersByTimeAsync(90_001);
    expect(lost).toHaveBeenCalledTimes(1);
    expect(api.release).toHaveBeenCalledTimes(1);
    await expect(save.reset()).rejects.toThrow('已关闭');
  });

  it('renews the lease after a transient heartbeat failure', async () => {
    const api = endpoint();
    api.heartbeat.mockRejectedValueOnce(new CloudSaveError('offline', 0));
    const lost = vi.fn();
    const save = await CloudSave.connect(storage(), api, { onLost: lost });
    await vi.advanceTimersByTimeAsync(95_000);
    expect(lost).not.toHaveBeenCalled();
    save.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('authenticated cloud API', () => {
  it('uses the session cookie, CSRF header and revision while leaving account identity to the server', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ revision: 8, leaseExpiresAt: Date.now() + 90_000 }));
    await new HttpCloudSaveApi('window', request).write('token', 7, empty());
    expect(request).toHaveBeenCalledWith(
      '/api/save',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Game-Request': '1' },
        body: JSON.stringify({ leaseToken: 'token', revision: 7, data: empty() }),
      }),
    );
  });

  it('fails closed on malformed cloud versions and preserves the error status for lease conflicts', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ revision: 77, leaseExpiresAt: Date.now() + 90_000 }))
      .mockResolvedValueOnce(Response.json({ message: 'other device' }, { status: 409 }));
    const api = new HttpCloudSaveApi('window', request);
    await expect(api.write('token', 7, empty())).rejects.toThrow('版本');
    await expect(api.open()).rejects.toMatchObject({ status: 409, message: 'other device' });
  });
});
