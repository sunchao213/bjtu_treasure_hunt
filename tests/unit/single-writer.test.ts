import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireSaveLock } from '../../src/modules/save/single-writer';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('single-writer save lock', () => {
  it('fails closed when Web Locks is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(acquireSaveLock()).rejects.toThrow('localhost 或 HTTPS');
  });

  it('reports a competing tab and releases an acquired lock', async () => {
    const request = vi
      .fn()
      .mockImplementationOnce(async (_name, _options, callback) => callback(null))
      .mockImplementationOnce(async (_name, _options, callback) => callback({ name: 'save' }));
    vi.stubGlobal('navigator', { locks: { request } });

    await expect(acquireSaveLock()).resolves.toBeNull();
    const release = await acquireSaveLock();
    expect(release).toEqual(expect.any(Function));
    release?.();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
