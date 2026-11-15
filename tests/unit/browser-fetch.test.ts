import { afterEach, expect, it, vi } from 'vitest';
import { AuthClient } from '../../src/modules/auth/auth-client';
import { HttpCloudSaveApi } from '../../src/modules/save/cloud-save-api';

afterEach(() => vi.unstubAllGlobals());

it('uses the browser receiver for default authentication and cloud-save requests', async () => {
  const session = {
    user: { id: 'a'.repeat(32), username: 'explorer', displayName: 'Explorer' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const snapshot = {
    data: null,
    revision: 0,
    leaseToken: 'a'.repeat(64),
    leaseExpiresAt: Date.now() + 60_000,
  };
  const request = vi.fn(function (this: unknown, path: RequestInfo | URL) {
    // Window.fetch rejects an unrelated object as its receiver in real browsers.
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return Promise.resolve(Response.json(path === '/api/auth/me' ? session : snapshot));
  });
  vi.stubGlobal('fetch', request);

  await expect(new AuthClient().current()).resolves.toEqual(session);
  await expect(new HttpCloudSaveApi('window').open()).resolves.toEqual(snapshot);
  expect(request).toHaveBeenCalledTimes(2);
});
