export type LeaderboardScope = 'friends' | 'global';

export interface LeaderboardEntry {
  readonly rank: number;
  readonly displayName: string;
  readonly totalValue: number;
  readonly bestValue: number;
  readonly successfulRaids: number;
}

export interface LeaderboardPage {
  readonly scope: LeaderboardScope;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly updatedAtMs: number;
  readonly entries: readonly LeaderboardEntry[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export class LeaderboardClient {
  constructor(private readonly request: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  async page(scope: LeaderboardScope, cursor?: string): Promise<LeaderboardPage> {
    const query = new URLSearchParams({ scope });
    if (cursor) query.set('cursor', cursor);
    let response: Response;
    try {
      response = await this.request(`/api/leaderboard?${query}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error('无法连接排行榜服务，请检查网络后重试。');
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof payload === 'object' &&
        payload !== null &&
        'message' in payload &&
        typeof payload.message === 'string'
          ? payload.message
          : '排行榜暂时不可用，请稍后重试。';
      throw new Error(message);
    }
    if (!this.isPage(payload, scope)) throw new Error('排行榜数据格式异常，请刷新后重试。');
    return payload;
  }

  private isPage(value: unknown, scope: LeaderboardScope): value is LeaderboardPage {
    if (typeof value !== 'object' || value === null) return false;
    const page = value as Partial<LeaderboardPage>;
    return (
      page.scope === scope &&
      Number.isSafeInteger(page.windowStartMs) &&
      Number.isSafeInteger(page.windowEndMs) &&
      Number.isSafeInteger(page.updatedAtMs) &&
      Array.isArray(page.entries) &&
      (page.nextCursor === null || typeof page.nextCursor === 'string') &&
      typeof page.hasMore === 'boolean' &&
      page.entries.every(
        (entry) =>
          Number.isSafeInteger(entry.rank) &&
          typeof entry.displayName === 'string' &&
          Number.isSafeInteger(entry.totalValue) &&
          Number.isSafeInteger(entry.bestValue) &&
          Number.isSafeInteger(entry.successfulRaids),
      )
    );
  }
}
