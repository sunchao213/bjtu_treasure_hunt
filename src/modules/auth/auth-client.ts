export interface AccountUser {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
}

export interface AuthSession {
  readonly user: AccountUser;
  readonly expiresAt: string;
}

export class AuthClient {
  constructor(private readonly request: typeof fetch = fetch) {}

  async current(): Promise<AuthSession | null> {
    const response = await this.send('/api/auth/me');
    if (response.status === 401) return null;
    return this.readSession(response);
  }

  async submit(
    mode: 'login' | 'register',
    username: string,
    password: string,
    displayName?: string,
  ): Promise<AuthSession> {
    const response = await this.send(`/api/auth/${mode}`, { username, password, displayName });
    return this.readSession(response);
  }

  async logout(): Promise<void> {
    await this.check(await this.send('/api/auth/logout', {}));
  }

  private async send(path: string, body?: object): Promise<Response> {
    try {
      return await this.request(path, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json', 'X-Game-Request': '1' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('无法连接账号服务，请确认服务端已启动后重试。');
    }
  }

  private async check(response: Response): Promise<void> {
    if (response.ok) return;
    if (response.status === 429) throw new Error('操作过于频繁，请一分钟后重试。');
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(
      typeof body?.message === 'string' ? body.message : '账号服务暂时不可用，请稍后重试。',
    );
  }

  private async readSession(response: Response): Promise<AuthSession> {
    await this.check(response);
    const value = (await response.json()) as Partial<AuthSession> | null;
    if (
      !value?.user ||
      !/^[a-f0-9]{32}$/.test(value.user.id) ||
      typeof value.user.username !== 'string' ||
      typeof value.user.displayName !== 'string' ||
      typeof value.expiresAt !== 'string' ||
      !(Date.parse(value.expiresAt) > Date.now())
    ) {
      throw new Error('登录信息无效，请重新登录。');
    }
    return value as AuthSession;
  }
}

/** Keep game imports and all game side effects behind a fresh server session check. */
export async function startAuthenticated(
  client: Pick<AuthClient, 'current'>,
  load: () => Promise<(user: AccountUser) => Promise<void>>,
): Promise<boolean> {
  const session = await client.current();
  if (!session) return false;
  const start = await load();
  // Loading game code can take time. Recheck before touching a save or starting a scene.
  const current = await client.current();
  if (!current || current.user.id !== session.user.id) return false;
  await start(current.user);
  return true;
}
