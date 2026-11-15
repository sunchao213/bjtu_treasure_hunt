import { describe, expect, it, vi } from 'vitest';
import { AuthClient, startAuthenticated } from '../../src/modules/auth/auth-client';

const session = {
  user: { id: 'a'.repeat(32), username: 'explorer', displayName: '探索者' },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

describe('authentication before game startup', () => {
  it('does not even load the game when no session exists', async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    const load = vi.fn();
    expect(await startAuthenticated(new AuthClient(request), load)).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('fails closed when the account server is unreachable', async () => {
    const client = new AuthClient(vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const load = vi.fn();
    await expect(startAuthenticated(client, load)).rejects.toThrow('账号服务');
    expect(load).not.toHaveBeenCalled();
  });

  it('starts once only after server verification, using the server account', async () => {
    const request = vi.fn().mockImplementation(async () => Response.json(session));
    const start = vi.fn();
    const load = vi.fn(async () => {
      expect(request).toHaveBeenCalledTimes(1);
      expect(start).not.toHaveBeenCalled();
      return start;
    });
    expect(await startAuthenticated(new AuthClient(request), load)).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledExactlyOnceWith(session.user);
  });

  it.each([null, { ...session, user: { ...session.user, id: 'b'.repeat(32) } }])(
    'does not start a scene or touch saves if the account changes while loading: %j',
    async (next) => {
      const start = vi.fn();
      const current = vi.fn().mockResolvedValueOnce(session).mockResolvedValueOnce(next);
      expect(await startAuthenticated({ current }, async () => start)).toBe(false);
      expect(start).not.toHaveBeenCalled();
    },
  );

  it('sends credentials only in the same-origin POST body with the CSRF header', async () => {
    const request = vi.fn().mockResolvedValue(Response.json(session));
    await new AuthClient(request).submit('register', 'explorer', 'example-password', '探索者');
    expect(request).toHaveBeenCalledWith(
      '/api/auth/register',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Game-Request': '1' },
        body: JSON.stringify({
          username: 'explorer',
          password: 'example-password',
          displayName: '探索者',
        }),
      }),
    );
  });

  it('shows useful credential and rate-limit errors without starting the game', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ message: '用户名或密码不正确。' }, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }));
    const client = new AuthClient(request);
    await expect(client.submit('login', 'explorer', 'incorrect')).rejects.toThrow(
      '用户名或密码不正确',
    );
    await expect(client.submit('login', 'explorer', 'incorrect')).rejects.toThrow('一分钟');
  });

  it.each([
    { ...session, expiresAt: new Date(0).toISOString() },
    { ...session, user: { ...session.user, id: '../other-user' } },
    { user: null },
  ])('rejects invalid or expired session data: %j', async (value) => {
    const client = new AuthClient(vi.fn().mockResolvedValue(Response.json(value)));
    await expect(client.current()).rejects.toThrow('登录信息无效');
  });
});
