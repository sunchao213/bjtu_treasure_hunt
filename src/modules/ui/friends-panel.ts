import {
  MESSAGE_MAX_LENGTH,
  SocialClient,
  SocialError,
  UID_PATTERN,
  createMessageId,
  describeUnread,
  formatClock,
  validateMessage,
  type ChatMessage,
  type FriendSummary,
  type SocialRoster,
  type SocialSelf,
} from '../social/social-client';

/**
 * R15 好友面板（大厅「行动中心」下的「好友」页签）。
 *
 * 界面只做三件事：展示服务端给出的关系与未读、把用户意图转成接口调用、把失败原因说清楚。
 * 所有用户内容一律用 textContent 写入，杜绝把昵称或消息当 HTML 执行。
 */
const POLL_INTERVAL_MS = 6000;

export function friendsPanelMarkup(): string {
  return `<section class="lobby-panel lobby-panel-wide friends-panel" data-lobby-panel="friends" hidden aria-labelledby="friends-title">
    <div class="lobby-panel-heading"><div><p class="prep-kicker">行动中心 · 社交</p><h2 id="friends-title">好友</h2></div>
      <span class="lobby-panel-meta" id="friends-meta">在线档 · 正在读取好友…</span></div>
    <div id="friends-browser" class="friends-browser" data-friends-mode="invite">
      <nav class="friends-categories" aria-label="好友功能">
        <span class="friends-categories-label">社交档案</span>
        <button type="button" data-friends-mode-option="invite" aria-pressed="true"><small>01</small><b>邀请<br>管理</b></button>
        <button type="button" data-friends-mode-option="friends" aria-pressed="false"><small>02</small><b>好友<br>列表</b><span id="friends-nav-count" class="friends-nav-count" hidden>0</span></button>
        <span class="friends-spine" aria-hidden="true">思源 · 好友记录</span>
      </nav>
      <div class="friends-workspace" aria-label="好友与私聊">
        <section class="friends-screen friends-invitations" data-friends-screen="invite" aria-labelledby="friends-operations-title">
          <header class="friends-screen-heading"><span>01 / SOCIAL INVITATION</span><h3 id="friends-operations-title">邀请管理</h3><p>账号标识与好友申请</p></header>
        <div class="friends-self">
          <div class="friends-self-text"><span>我的 UID（给好友添加用）</span><code id="friends-self-uid" title="账号唯一标识，32 位十六进制">—</code></div>
          <button id="friends-copy-uid" class="secondary friends-action" type="button">复制 UID</button>
        </div>
        <form id="friends-apply-form" class="friends-apply" novalidate>
          <label class="field-label" for="friends-uid">对方 UID（32 位十六进制）</label>
          <div class="friends-apply-row">
            <input id="friends-uid" maxlength="32" autocomplete="off" spellcheck="false" placeholder="例如 3f2a9c…" />
            <button id="friends-apply" class="primary" type="submit">发送申请</button>
          </div>
        </form>
        <p id="friends-status" class="friends-status" role="status" aria-live="polite">输入 UID 发送好友申请。</p>
        <div id="friends-requests" class="friends-block friends-requests" hidden>
          <h3>待处理</h3>
          <ul id="friends-requests-list" class="friends-list" role="list"></ul>
        </div>
        </section>
        <section class="friends-screen friends-communication" data-friends-screen="friends" hidden aria-labelledby="friends-directory-title">
          <section class="friends-directory" aria-labelledby="friends-directory-title">
            <header class="friends-screen-heading"><span>02 / CONTACTS</span><h3 id="friends-directory-title">好友列表</h3><p>已建立联系</p></header>
            <div class="friends-block friends-roster">
              <h3>好友 <span id="friends-count" class="friends-count">0</span></h3>
              <ul id="friends-list" class="friends-list" role="list"></ul>
              <p id="friends-empty" class="friends-empty">还没有好友。前往邀请管理发送申请。</p>
            </div>
            <details id="friends-blocked" class="friends-blocked" hidden>
              <summary>屏蔽名单 <span id="friends-blocked-count">0</span></summary>
              <ul id="friends-blocked-list" class="friends-list" role="list"></ul>
            </details>
          </section>
          <section id="friends-chat" class="friends-chat" aria-label="私聊">
            <header id="friends-chat-head" class="friends-chat-head" hidden>
              <div><b id="friends-chat-name"></b><span id="friends-chat-uid"></span></div>
              <button id="friends-chat-close" class="text-button" type="button">收起</button>
            </header>
            <ol id="friends-messages" class="friends-messages" aria-live="polite" hidden></ol>
            <p id="friends-chat-empty" class="friends-chat-placeholder" hidden></p>
            <form id="friends-send-form" class="friends-send" novalidate hidden>
              <input id="friends-text" maxlength="${MESSAGE_MAX_LENGTH}" autocomplete="off" aria-label="消息内容" placeholder="输入消息（1—${MESSAGE_MAX_LENGTH} 字符）" />
              <button id="friends-send" class="primary" type="submit">发送</button>
            </form>
            <p id="friends-chat-status" class="friends-status" role="status" aria-live="polite" hidden></p>
          </section>
        </section>
      </section>
    </div>
  </section>`;
}

export interface FriendsPanelOptions {
  readonly client: SocialClient;
  readonly self: SocialSelf;
  readonly notify: (message: string) => void;
}

export class FriendsPanel {
  private roster: SocialRoster | null = null;
  private peer: SocialSelf | null = null;
  private cursor = 0;
  private messages: ChatMessage[] = [];
  private polling: number | undefined;
  private busy = false;

  constructor(private readonly options: FriendsPanelOptions) {}

  mount(): void {
    this.showSelfUid();
    this.byId('friends-browser').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
        '[data-friends-mode-option]',
      );
      const mode = button?.dataset.friendsModeOption;
      if (mode === 'invite' || mode === 'friends') this.setMode(mode);
    });
    this.byId<HTMLFormElement>('friends-apply-form').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.apply();
    });
    this.byId<HTMLFormElement>('friends-send-form').addEventListener('submit', (event) => {
      event.preventDefault();
      void this.send();
    });
    this.byId('friends-chat-close').addEventListener('click', () => this.closeChat());
    this.byId('friends-copy-uid').addEventListener('click', () => void this.copyUid());
    this.byId('friends-list').addEventListener(
      'click',
      (event) => void this.handleListClick(event),
    );
    this.byId('friends-requests-list').addEventListener(
      'click',
      (event) => void this.handleListClick(event),
    );
    this.byId('friends-blocked-list').addEventListener(
      'click',
      (event) => void this.handleListClick(event),
    );
    document.addEventListener('lobby:tab', (event) => {
      const detail = (event as CustomEvent<string>).detail;
      this.togglePolling(detail === 'friends');
      if (detail === 'friends') void this.refresh();
    });
    // 首屏先取一次名册，好让导航上的未读角标立即正确。
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const roster = await this.options.client.roster();
      this.roster = roster;
      this.renderRoster();
      if (this.peer) await this.loadMessages(this.peer.uid);
    } catch (error) {
      // 404/0 通常意味着本地后端还是旧版本（没有 /api/social），直接给出可执行的提示。
      const hint =
        error instanceof SocialError && (error.status === 404 || error.status === 0)
          ? '若刚更新过代码，请重启本地后端（dotnet run）后刷新页面。'
          : '';
      const message = error instanceof Error ? error.message : '好友服务暂时不可用。';
      this.byId('friends-meta').textContent = '好友服务未连接';
      this.setStatus(this.friendsStatus(), hint ? `${message} ${hint}` : message);
    } finally {
      this.busy = false;
    }
  }

  // ── 名册渲染 ────────────────────────────────────────────────────────
  private renderRoster(): void {
    const roster = this.roster;
    if (!roster) return;
    const unreadTotal = roster.friends.reduce((sum, friend) => sum + friend.unread, 0);
    this.byId('friends-meta').textContent =
      `在线档 · ${roster.friends.length} 位好友 · ${describeUnread(unreadTotal)}`;
    this.byId('friends-count').textContent = String(roster.friends.length);
    const navCount = this.byId('friends-nav-count');
    navCount.textContent = String(roster.friends.length);
    navCount.hidden = roster.friends.length === 0;
    this.updateNavBadge(unreadTotal);
    // 自己的 UID 必须可见：好友申请按 UID 发起，玩家需要能把它发给对方。
    const selfUid = this.byId('friends-self-uid');
    selfUid.textContent = roster.self.uid;
    selfUid.title = `账号唯一标识：${roster.self.uid}（点击“复制 UID”发给好友）`;

    const list = this.byId<HTMLElement>('friends-list');
    list.replaceChildren();
    for (const friend of roster.friends) list.append(this.friendRow(friend));
    this.byId('friends-empty').hidden = roster.friends.length > 0;

    const requests = this.byId<HTMLElement>('friends-requests');
    const requestList = this.byId<HTMLElement>('friends-requests-list');
    requestList.replaceChildren();
    for (const request of roster.incoming)
      requestList.append(this.incomingRow(request.uid, request.displayName));
    for (const request of roster.outgoing)
      requestList.append(this.outgoingRow(request.uid, request.displayName));
    requests.hidden = roster.incoming.length === 0 && roster.outgoing.length === 0;
    if (!requests.hidden) {
      requests.querySelector('h3')!.textContent =
        `待处理（收到 ${roster.incoming.length} · 发出 ${roster.outgoing.length}）`;
    }

    const blocked = this.byId<HTMLDetailsElement>('friends-blocked');
    const blockedList = this.byId<HTMLElement>('friends-blocked-list');
    blockedList.replaceChildren();
    for (const entry of roster.blocked)
      blockedList.append(this.blockedRow(entry.uid, entry.displayName));
    blocked.hidden = roster.blocked.length === 0;
    this.byId('friends-blocked-count').textContent = String(roster.blocked.length);

    if (this.peer) {
      const current = roster.friends.find((friend) => friend.uid === this.peer?.uid);
      if (!current) this.closeChat();
      else this.renderChatHead(current);
    }
  }

  private friendRow(friend: FriendSummary): HTMLElement {
    const row = this.row(friend.displayName, friend.uid);
    if (friend.unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'friends-unread';
      badge.textContent = String(friend.unread);
      badge.title = `${friend.unread} 条未读`;
      row.querySelector('.friends-row-main')!.append(badge);
    }
    if (friend.blockedByMe) {
      const tag = document.createElement('span');
      tag.className = 'friends-tag';
      tag.textContent = '已屏蔽';
      row.querySelector('.friends-row-main')!.append(tag);
    }
    row.append(
      this.action('聊天', 'chat', friend.uid, 'primary'),
      this.action(
        friend.blockedByMe ? '取消屏蔽' : '屏蔽',
        friend.blockedByMe ? 'unblock' : 'block',
        friend.uid,
      ),
      this.action('删除', 'remove', friend.uid),
    );
    return row;
  }

  private incomingRow(uid: string, displayName: string): HTMLElement {
    const row = this.row(displayName, uid);
    row.append(this.action('接受', 'accept', uid, 'primary'), this.action('拒绝', 'reject', uid));
    return row;
  }

  private outgoingRow(uid: string, displayName: string): HTMLElement {
    const row = this.row(displayName, uid);
    const tag = document.createElement('span');
    tag.className = 'friends-tag';
    tag.textContent = '等待对方处理';
    row.querySelector('.friends-row-main')!.append(tag);
    row.append(this.action('取消', 'cancel', uid));
    return row;
  }

  private blockedRow(uid: string, displayName: string): HTMLElement {
    const row = this.row(displayName, uid);
    row.append(this.action('取消屏蔽', 'unblock', uid));
    return row;
  }

  private row(displayName: string, uid: string): HTMLElement {
    const row = document.createElement('li');
    row.className = 'friends-row';
    const main = document.createElement('div');
    main.className = 'friends-row-main';
    const name = document.createElement('b');
    name.textContent = displayName;
    const id = document.createElement('small');
    id.textContent = uid;
    main.append(name, id);
    row.append(main);
    return row;
  }

  private action(label: string, action: string, uid: string, tone?: 'primary'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = tone === 'primary' ? 'primary friends-action' : 'secondary friends-action';
    button.textContent = label;
    button.dataset.friendAction = action;
    button.dataset.uid = uid;
    return button;
  }

  // ── 交互 ────────────────────────────────────────────────────────────
  private async handleListClick(event: Event): Promise<void> {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-friend-action]');
    if (!button) return;
    const uid = button.dataset.uid;
    const action = button.dataset.friendAction;
    if (!uid || !action) return;
    button.disabled = true;
    try {
      const client = this.options.client;
      if (action === 'chat') {
        const friend = this.roster?.friends.find((entry) => entry.uid === uid);
        if (friend) await this.openChat({ uid: friend.uid, displayName: friend.displayName });
        return;
      }
      let message = '';
      if (action === 'accept') message = await client.respond(uid, 'accept');
      else if (action === 'reject') message = await client.respond(uid, 'reject');
      else if (action === 'cancel' || action === 'remove') message = await client.remove(uid);
      else if (action === 'block') message = await client.block(uid, true);
      else if (action === 'unblock') message = await client.block(uid, false);
      this.setStatus(this.friendsStatus(), message, 'ok');
      this.options.notify(message);
      if (action === 'remove' || action === 'block' || action === 'unblock') {
        if (this.peer?.uid === uid && action !== 'unblock') this.closeChat();
      }
      if (action === 'cancel' || action === 'reject' || action === 'remove' || action === 'block') {
        if (this.peer?.uid === uid) this.closeChat();
      }
      await this.refresh();
    } catch (error) {
      this.setStatus(this.friendsStatus(), error);
    } finally {
      button.disabled = false;
    }
  }

  private async apply(): Promise<void> {
    const input = this.byId<HTMLInputElement>('friends-uid');
    const uid = input.value.trim().toLowerCase();
    if (!UID_PATTERN.test(uid)) {
      this.setStatus(
        this.friendsStatus(),
        'UID 需为 32 位十六进制：点上方「复制 UID」把自己的发给对方，或让对方在好友页把他的 UID 发给你。',
      );
      return;
    }
    if (uid === this.options.self.uid) {
      this.setStatus(this.friendsStatus(), '不能添加自己为好友。');
      return;
    }
    const button = this.byId<HTMLButtonElement>('friends-apply');
    button.disabled = true;
    this.setStatus(this.friendsStatus(), '正在发送好友申请…');
    try {
      const target = await this.options.client.lookup(uid);
      this.setStatus(this.friendsStatus(), `已找到「${target.displayName}」，正在发送申请…`);
      const message = await this.options.client.apply(uid);
      this.setStatus(this.friendsStatus(), message, 'ok');
      input.value = '';
      await this.refresh();
    } catch (error) {
      this.setStatus(this.friendsStatus(), error);
    } finally {
      button.disabled = false;
    }
  }

  /** 复制自己的 UID：剪贴板不可用时退化为选中文本，保证仍能手动复制。 */
  private async copyUid(): Promise<void> {
    // 优先用名册里的 UID；名册请求失败时回退到登录会话里的 UID，避免“尚未加载”。
    const uid = this.roster?.self.uid ?? this.options.self.uid;
    if (!uid) {
      this.setStatus(this.friendsStatus(), '暂时取不到 UID，请刷新页面后重试。');
      return;
    }
    try {
      await navigator.clipboard.writeText(uid);
      this.setStatus(this.friendsStatus(), '已复制你的 UID，发给对方即可添加好友。', 'ok');
    } catch {
      const code = this.byId('friends-self-uid');
      const range = document.createRange();
      range.selectNodeContents(code);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      this.setStatus(this.friendsStatus(), '浏览器未授权剪贴板，已选中 UID，按 Ctrl+C 复制。');
    }
  }

  /** 登录会话已带 UID，先填上；名册返回后再以服务端值为准。 */
  private showSelfUid(): void {
    const uid = this.options.self.uid;
    if (!uid) return;
    const code = this.byId('friends-self-uid');
    code.textContent = uid;
    code.title = `账号唯一标识：${uid}（点“复制 UID”发给好友）`;
  }

  private async openChat(peer: SocialSelf): Promise<void> {
    this.peer = peer;
    this.cursor = 0;
    this.messages = [];
    this.setMode('friends');
    this.byId('friends-chat-head').hidden = false;
    this.byId('friends-messages').hidden = false;
    this.byId('friends-send-form').hidden = false;
    this.byId('friends-chat-empty').hidden = false;
    this.byId('friends-chat-status').hidden = false;
    this.byId('friends-chat-empty').textContent = '还没有消息。打个招呼，约一局校园夜巡。';
    this.renderChatHead(peer);
    await this.loadMessages(peer.uid);
    this.byId<HTMLInputElement>('friends-text').focus();
  }

  private closeChat(): void {
    this.peer = null;
    this.messages = [];
    this.cursor = 0;
    this.byId('friends-chat-head').hidden = true;
    this.byId<HTMLElement>('friends-messages').replaceChildren();
    this.byId('friends-messages').hidden = true;
    this.byId('friends-send-form').hidden = true;
    this.byId('friends-chat-empty').hidden = true;
    this.byId('friends-chat-empty').textContent = '';
    const status = this.byId('friends-chat-status');
    status.hidden = true;
    status.textContent = '';
  }

  private renderChatHead(peer: SocialSelf): void {
    this.byId('friends-chat-name').textContent = peer.displayName;
    this.byId('friends-chat-uid').textContent = peer.uid;
  }

  private setMode(mode: 'invite' | 'friends'): void {
    const browser = this.byId('friends-browser');
    browser.dataset.friendsMode = mode;
    for (const button of browser.querySelectorAll<HTMLButtonElement>(
      '[data-friends-mode-option]',
    )) {
      button.setAttribute('aria-pressed', String(button.dataset.friendsModeOption === mode));
    }
    for (const screen of browser.querySelectorAll<HTMLElement>('[data-friends-screen]')) {
      screen.hidden = screen.dataset.friendsScreen !== mode;
    }
  }

  private async loadMessages(peerUid: string): Promise<void> {
    const status = this.byId('friends-chat-status');
    try {
      const page = await this.options.client.messages(peerUid, this.cursor);
      if (this.peer?.uid !== peerUid) return;
      this.renderChatHead(page.peer);
      if (page.messages.length > 0) {
        this.messages.push(...page.messages);
        this.cursor = page.nextCursor;
        this.renderMessages();
        await this.options.client.markRead(peerUid, this.cursor);
      }
      this.byId('friends-chat-empty').hidden = this.messages.length > 0;
      status.textContent = '';
    } catch (error) {
      this.setStatus(status, error);
    }
  }

  private renderMessages(): void {
    const list = this.byId<HTMLElement>('friends-messages');
    list.replaceChildren();
    for (const message of this.messages) {
      const item = document.createElement('li');
      item.className =
        message.senderUid === this.options.self.uid ? 'friends-msg is-mine' : 'friends-msg';
      const body = document.createElement('p');
      body.textContent = message.body;
      const meta = document.createElement('small');
      meta.textContent = formatClock(message.createdMs);
      item.append(body, meta);
      list.append(item);
    }
    list.scrollTop = list.scrollHeight;
  }

  private async send(): Promise<void> {
    const peer = this.peer;
    if (!peer) return;
    const input = this.byId<HTMLInputElement>('friends-text');
    const status = this.byId('friends-chat-status');
    const error = validateMessage(input.value);
    if (error) {
      this.setStatus(status, error);
      return;
    }
    if (!this.options.client.canSendNow()) {
      this.setStatus(status, '发送过快：每 10 秒最多 5 条，请稍后再试。');
      return;
    }
    const button = this.byId<HTMLButtonElement>('friends-send');
    button.disabled = true;
    // 同一条消息重试时复用 messageId，服务端据此去重。
    const messageId = createMessageId();
    const text = input.value.replace(/\r\n/g, '\n').trim();
    try {
      const message = await this.options.client.send(peer.uid, text, messageId);
      this.options.client.noteSent();
      this.messages.push(message);
      this.cursor = Math.max(this.cursor, message.id);
      this.renderMessages();
      this.byId('friends-chat-empty').hidden = true;
      input.value = '';
      this.setStatus(status, '', 'ok');
    } catch (exception) {
      this.setStatus(status, exception);
    } finally {
      button.disabled = false;
      input.focus();
    }
  }

  // ── 工具 ────────────────────────────────────────────────────────────
  private togglePolling(active: boolean): void {
    window.clearInterval(this.polling);
    this.polling = undefined;
    if (!active) return;
    this.polling = window.setInterval(() => {
      const panel = document.querySelector<HTMLElement>('[data-lobby-panel="friends"]');
      if (panel && !panel.hidden) void this.refresh();
    }, POLL_INTERVAL_MS);
  }

  private updateNavBadge(unread: number): void {
    const badge = document.getElementById('friends-nav-badge');
    if (!badge) return;
    badge.textContent = unread > 0 ? String(unread) : '';
    badge.hidden = unread <= 0;
  }

  private friendsStatus(): HTMLElement {
    return this.byId<HTMLElement>('friends-status');
  }

  private setStatus(element: HTMLElement, message: unknown, tone?: 'ok'): void {
    const text =
      typeof message === 'string'
        ? message
        : message instanceof SocialError
          ? message.message
          : message instanceof Error
            ? message.message
            : '操作失败，请稍后重试。';
    element.textContent = text;
    element.dataset.tone =
      tone ?? (message instanceof Error || typeof message !== 'string' ? 'error' : 'info');
  }

  private byId<T extends HTMLElement = HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`好友面板缺少 #${id}`);
    return element as T;
  }
}

export function createFriendsPanel(options: FriendsPanelOptions): FriendsPanel {
  return new FriendsPanel(options);
}
