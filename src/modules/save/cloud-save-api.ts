import type { FormalSaveData } from './persistent-save';

export interface CloudSnapshot {
  readonly data: FormalSaveData | null;
  readonly revision: number;
  readonly leaseToken: string;
  readonly leaseExpiresAt: number;
}
export interface CloudCommit {
  readonly revision: number;
  readonly leaseExpiresAt: number;
}
export interface CloudSaveApi {
  open(): Promise<CloudSnapshot>;
  write(token: string, revision: number, data: FormalSaveData): Promise<CloudCommit>;
  heartbeat(token: string): Promise<{ readonly leaseExpiresAt: number }>;
  release(token: string): Promise<void>;
}
export class CloudSaveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export class HttpCloudSaveApi implements CloudSaveApi {
  constructor(
    private readonly clientId: string,
    private readonly request: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async open(): Promise<CloudSnapshot> {
    const body = await this.post('/open', { clientId: this.clientId });
    if (
      !this.validCommit(body) ||
      typeof body.leaseToken !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(body.leaseToken) ||
      !('data' in body)
    ) {
      throw new Error('云存档响应无效，请稍后重试。');
    }
    return body as unknown as CloudSnapshot;
  }

  async write(leaseToken: string, revision: number, data: FormalSaveData): Promise<CloudCommit> {
    const body = await this.post('', { leaseToken, revision, data });
    if (!this.validCommit(body) || body.revision !== revision + 1)
      throw new Error('云存档版本响应无效，请刷新读取最新进度。');
    return body as unknown as CloudCommit;
  }

  async heartbeat(leaseToken: string): Promise<{ readonly leaseExpiresAt: number }> {
    const body = await this.post('/heartbeat', { leaseToken });
    if (
      typeof body.leaseExpiresAt !== 'number' ||
      !Number.isSafeInteger(body.leaseExpiresAt) ||
      body.leaseExpiresAt <= Date.now()
    )
      throw new Error('云存档占用已过期，请刷新。');
    return { leaseExpiresAt: body.leaseExpiresAt };
  }

  async release(leaseToken: string): Promise<void> {
    await this.post('/release', { leaseToken }, true);
  }

  private validCommit(body: Record<string, unknown>): boolean {
    return (
      typeof body.revision === 'number' &&
      Number.isSafeInteger(body.revision) &&
      body.revision >= 0 &&
      typeof body.leaseExpiresAt === 'number' &&
      Number.isSafeInteger(body.leaseExpiresAt) &&
      body.leaseExpiresAt > Date.now()
    );
  }

  private async post(
    path: string,
    body: object,
    keepalive = false,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await this.request(`/api/save${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        keepalive,
        headers: { 'Content-Type': 'application/json', 'X-Game-Request': '1' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new CloudSaveError('无法连接云存档，请检查网络后重试。', 0);
    }
    if (response.status === 204) return {};
    const value: unknown = await response.json().catch(() => null);
    const record =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    if (!response.ok)
      throw new CloudSaveError(
        typeof record.message === 'string' ? record.message : '无法读取云存档，请重新登录后重试。',
        response.status,
      );
    return record;
  }
}
