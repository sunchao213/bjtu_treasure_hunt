import {
  LeaderboardClient,
  type LeaderboardEntry,
  type LeaderboardScope,
} from '../social/leaderboard-client';

export function leaderboardMarkup(): string {
  return `<div id="leaderboard-panel" class="leaderboard-panel">
    <div class="leaderboard-browser">
      <nav class="leaderboard-scopes" aria-label="排行榜范围">
        <button type="button" data-leaderboard-scope="friends" aria-pressed="true">好友榜</button>
        <button type="button" data-leaderboard-scope="global" aria-pressed="false">全服榜</button>
      </nav>
      <div class="leaderboard-content">
        <header class="leaderboard-heading"><span>ROLLING 7 DAYS / EXTRACTION VALUE</span><h3>近七日成功撤离总价值</h3>
          <p id="leaderboard-window">正在读取服务器榜单窗口…</p></header>
        <p class="leaderboard-integrity">原型测试榜：目前根据客户端上报的结算记录统计，尚未进行服务器权威反作弊校验。</p>
        <div class="leaderboard-toolbar"><span id="leaderboard-updated">成绩仅统计成功撤离</span><button id="leaderboard-refresh" type="button">刷新榜单</button></div>
        <ol id="leaderboard-entries" class="leaderboard-entries" aria-live="polite"></ol>
        <p id="leaderboard-empty" class="leaderboard-empty" hidden>近 7 天还没有符合条件的成功撤离记录。</p>
        <p id="leaderboard-status" class="leaderboard-status" role="status" aria-live="polite"></p>
        <button id="leaderboard-more" class="leaderboard-more" type="button" hidden>加载更多</button>
      </div>
    </div>
  </div>`;
}

export class LeaderboardPanel {
  private scope: LeaderboardScope = 'friends';
  private cursor: string | null = null;
  private hasMore = false;
  private busy = false;

  constructor(private readonly client: LeaderboardClient) {}

  mount(): void {
    this.byId('leaderboard-panel').addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-leaderboard-scope]');
      const scope = target?.dataset.leaderboardScope;
      if (scope === 'friends' || scope === 'global') {
        if (scope === this.scope) return;
        this.scope = scope;
        this.setActiveScope();
        void this.load(true);
      }
    });
    this.byId('leaderboard-refresh').addEventListener('click', () => void this.load(true));
    this.byId('leaderboard-more').addEventListener('click', () => void this.load(false));
  }

  open(): void {
    void this.load(true);
  }

  private async load(reset: boolean): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const status = this.byId('leaderboard-status');
    const more = this.byId<HTMLButtonElement>('leaderboard-more');
    const refresh = this.byId<HTMLButtonElement>('leaderboard-refresh');
    const scopeButtons = Array.from(
      this.byId('leaderboard-panel').querySelectorAll<HTMLButtonElement>(
        '[data-leaderboard-scope]',
      ),
    );
    status.textContent = reset ? '正在生成服务器榜单快照…' : '正在读取下一页…';
    more.disabled = true;
    refresh.disabled = true;
    for (const button of scopeButtons) button.disabled = true;
    if (reset) {
      this.cursor = null;
      this.hasMore = false;
      this.byId<HTMLOListElement>('leaderboard-entries').replaceChildren();
      this.byId('leaderboard-empty').hidden = true;
    }
    try {
      const page = await this.client.page(
        this.scope,
        reset ? undefined : (this.cursor ?? undefined),
      );
      const entries = this.byId<HTMLOListElement>('leaderboard-entries');
      for (const entry of page.entries) entries.append(this.renderEntry(entry));
      this.cursor = page.nextCursor;
      this.hasMore = page.hasMore;
      this.byId('leaderboard-window').textContent =
        `${this.formatDate(page.windowStartMs)} — ${this.formatDate(page.windowEndMs)}（服务器时间，起含止不含）`;
      this.byId('leaderboard-updated').textContent =
        `快照更新于 ${this.formatDateTime(page.updatedAtMs)} · 仅累计成功撤离带出价值`;
      this.byId('leaderboard-empty').hidden = entries.childElementCount > 0;
      status.textContent =
        entries.childElementCount === 0
          ? '仅展示近 7 天至少成功撤离一次的玩家；零成绩玩家暂不入榜。'
          : '';
      more.hidden = !this.hasMore;
    } catch (error) {
      status.textContent =
        error instanceof Error ? error.message : '排行榜暂时不可用，请稍后重试。';
      more.hidden = true;
      if (!reset && this.cursor) more.hidden = false;
    } finally {
      this.busy = false;
      more.disabled = false;
      refresh.disabled = false;
      for (const button of scopeButtons) button.disabled = false;
    }
  }

  private renderEntry(entry: LeaderboardEntry): HTMLLIElement {
    const row = document.createElement('li');
    row.className = 'leaderboard-entry';
    if (entry.rank <= 3) row.classList.add(`is-rank-${entry.rank}`);
    const place = document.createElement('span');
    place.className = 'leaderboard-rank';
    place.textContent = entry.rank <= 3 ? String(entry.rank).padStart(2, '0') : `#${entry.rank}`;
    if (entry.rank <= 3) place.setAttribute('aria-label', `第 ${entry.rank} 名`);
    const identity = document.createElement('span');
    identity.className = 'leaderboard-identity';
    const name = document.createElement('b');
    name.textContent = entry.displayName;
    const detail = document.createElement('small');
    detail.textContent = `最高单局 ${entry.bestValue} · 成功撤离 ${entry.successfulRaids} 次`;
    identity.append(name, detail);
    const total = document.createElement('strong');
    total.className = 'leaderboard-total';
    total.textContent = String(entry.totalValue);
    total.setAttribute('aria-label', `总价值 ${entry.totalValue}`);
    row.append(place, identity, total);
    return row;
  }

  private setActiveScope(): void {
    for (const button of this.byId('leaderboard-panel').querySelectorAll<HTMLButtonElement>(
      '[data-leaderboard-scope]',
    )) {
      button.setAttribute('aria-pressed', String(button.dataset.leaderboardScope === this.scope));
    }
  }

  private formatDate(ms: number): string {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' }).format(new Date(ms));
  }

  private formatDateTime(ms: number): string {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(ms));
  }

  private byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`排行榜界面缺少 #${id}`);
    return element as T;
  }
}

export function createLeaderboardPanel(client: LeaderboardClient): LeaderboardPanel {
  return new LeaderboardPanel(client);
}
