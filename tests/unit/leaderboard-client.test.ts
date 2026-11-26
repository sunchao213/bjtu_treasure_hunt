import { describe, expect, it, vi } from 'vitest';
import { LeaderboardClient } from '../../src/modules/social/leaderboard-client';
import { leaderboardMarkup } from '../../src/modules/ui/leaderboard-panel';

describe('排行榜客户端', () => {
  it('请求固定范围的服务器快照并继续携带游标', async () => {
    const request = vi.fn().mockResolvedValue(
      Response.json({
        scope: 'friends',
        windowStartMs: 1,
        windowEndMs: 2,
        updatedAtMs: 2,
        entries: [],
        nextCursor: 'snapshot-cursor',
        hasMore: true,
      }),
    );
    const client = new LeaderboardClient(request);
    const page = await client.page('friends', 'previous-page');
    expect(page.hasMore).toBe(true);
    expect(request.mock.calls[0]?.[0]).toBe('/api/leaderboard?scope=friends&cursor=previous-page');
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
    });
  });

  it('拒绝错误范围或字段不全的榜单响应', async () => {
    const client = new LeaderboardClient(
      vi.fn().mockResolvedValue(
        Response.json({
          scope: 'global',
          windowStartMs: 1,
          windowEndMs: 2,
          updatedAtMs: 2,
          entries: [],
          nextCursor: null,
          hasMore: false,
        }),
      ),
    );
    await expect(client.page('friends')).rejects.toThrow('数据格式异常');
  });

  it('榜单面板提供好友榜、全服榜和快照信息区域', () => {
    const markup = leaderboardMarkup();
    expect(markup).toContain('data-leaderboard-scope="friends"');
    expect(markup).toContain('data-leaderboard-scope="global"');
    expect(markup).toContain('leaderboard-window');
    expect(markup).toContain('leaderboard-more');
  });
});
