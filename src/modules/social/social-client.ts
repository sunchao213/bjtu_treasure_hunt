/**
 * R15 好友与私聊客户端（需求分析 R15、详细设计 D10.1）。
 *
 * 客户端只发送「申请 / 接受 / 拒绝 / 删除 / 屏蔽 / 发消息 / 已读」意图，
 * 关系状态、未读数与已读游标一律由服务端计算，本地不自行推断，避免自报数据。
 */

export interface SocialSelf {
  readonly uid: string;
  readonly displayName: string;
}

export interface FriendSummary {
  readonly uid: string;
  readonly displayName: string;
  readonly unread: number;
  readonly lastMessageMs: number;
  readonly blockedByMe: boolean;
}

export interface FriendRequestSummary {
  readonly uid: string;
  readonly displayName: string;
  readonly updatedAt: string;
}

export interface SocialRoster {
  readonly self: SocialSelf;
  readonly friends: readonly FriendSummary[];
  readonly incoming: readonly FriendRequestSummary[];
  readonly outgoing: readonly FriendRequestSummary[];
  readonly blocked: readonly SocialSelf[];
}

export interface ChatMessage {
  readonly id: number;
  readonly messageId: string;
  readonly senderUid: string;
  readonly body: string;
  readonly createdMs: number;
}

export interface ChatPage {
  readonly peer: SocialSelf;
  readonly messages: readonly ChatMessage[];
  readonly nextCursor: number;
}

/** 与需求一致：1—200 字符、每 10 秒最多 5 条。 */
export const MESSAGE_MAX_LENGTH = 200;
export const RATE_LIMIT = 5;
export const RATE_WINDOW_MS = 10_000;
export const UID_PATTERN = /^[a-f0-9]{32}$/;

export class SocialError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SocialError';
  }
}

/** 按 Unicode 码点计数，emoji 不会被算成两个字符。 */
export function countCharacters(text: string): number {
  return Array.from(text).length;
}

/** 返回错误文案；合法时返回 null。纯函数，便于单元测试。 */
export function validateMessage(text: string): string | null {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return '消息不能为空。';
  const length = countCharacters(normalized);
  if (length > MESSAGE_MAX_LENGTH)
    return `消息最多 ${MESSAGE_MAX_LENGTH} 个字符（当前 ${length}）。`;
  if (normalized.includes('\0')) return '消息包含无法保存的字符。';
  return null;
}

/** messageId 用于「失败重试不重复投递」，同一 ID 重发由服务端返回原消息。 */
export function createMessageId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  cryptoApi?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—';
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function describeUnread(total: number): string {
  if (total <= 0) return '暂无未读';
  return `${total} 条未读`;
}

/** 列表里用短 UID 省空间；完整值保留在好友面板的「我的 UID」与 title 上。 */
export function shortenUid(uid: string): string {
  if (uid.length <= 14) return uid;
  return `${uid.slice(0, 8)}…${uid.slice(-4)}`;
}

const FALLBACK_MESSAGES: Readonly<Record<number, string>> = {
  0: '无法连接好友服务，请确认已登录并稍后重试。',
  401: '登录已失效，请重新登录后再使用好友功能。',
  403: '没有权限执行该操作。',
  404: '目标不存在，请刷新后重试。',
  429: '操作过于频繁，请稍后再试。',
  500: '好友服务暂时不可用，请稍后重试。',
  503: '好友服务暂时不可用，请稍后重试。',
};

export class SocialClient {
  private sentAt: number[] = [];

  constructor(private readonly request: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  /** 本地节流：与服务端 5 条/10 秒一致，避免不必要的 429。 */
  canSendNow(): boolean {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    this.sentAt = this.sentAt.filter((at) => at > cutoff);
    return this.sentAt.length < RATE_LIMIT;
  }

  noteSent(): void {
    this.sentAt.push(Date.now());
  }

  async roster(): Promise<SocialRoster> {
    const payload = await this.call('/api/social/roster');
    const roster = payload as Partial<SocialRoster> | null;
    if (!roster || typeof roster.self?.uid !== 'string' || !Array.isArray(roster.friends)) {
      throw new SocialError('好友名册格式异常，请刷新后重试。', 500);
    }
    return {
      self: roster.self,
      friends: roster.friends,
      incoming: roster.incoming ?? [],
      outgoing: roster.outgoing ?? [],
      blocked: roster.blocked ?? [],
    };
  }

  async lookup(uid: string): Promise<SocialSelf> {
    const payload = await this.call(`/api/social/lookup?uid=${encodeURIComponent(uid)}`);
    const found = payload as Partial<SocialSelf> | null;
    if (!found || typeof found.uid !== 'string' || typeof found.displayName !== 'string') {
      throw new SocialError('未找到该 UID。', 404);
    }
    return { uid: found.uid, displayName: found.displayName };
  }

  async apply(uid: string): Promise<string> {
    return this.message('/api/social/apply', { targetUid: uid, requestId: createMessageId() });
  }

  async respond(uid: string, action: 'accept' | 'reject'): Promise<string> {
    return this.message('/api/social/respond', { peerUid: uid, action });
  }

  async remove(uid: string): Promise<string> {
    return this.message('/api/social/remove', { peerUid: uid });
  }

  async block(uid: string, blocked: boolean): Promise<string> {
    return this.message('/api/social/block', { peerUid: uid, blocked });
  }

  async messages(peerUid: string, after = 0): Promise<ChatPage> {
    const payload = await this.call(
      `/api/social/messages?peer=${encodeURIComponent(peerUid)}&after=${Math.max(0, after)}`,
    );
    const page = payload as Partial<ChatPage> | null;
    if (!page || !page.peer || !Array.isArray(page.messages)) {
      throw new SocialError('消息拉取失败，请稍后重试。', 500);
    }
    return {
      peer: page.peer,
      messages: page.messages,
      nextCursor: typeof page.nextCursor === 'number' ? page.nextCursor : after,
    };
  }

  async send(peerUid: string, text: string, messageId: string): Promise<ChatMessage> {
    const payload = (await this.call('/api/social/messages', {
      peerUid,
      text,
      messageId,
    })) as { message?: ChatMessage } | null;
    if (!payload?.message || typeof payload.message.body !== 'string') {
      throw new SocialError('消息发送结果异常，请刷新后确认。', 500);
    }
    return payload.message;
  }

  async markRead(peerUid: string, cursor: number): Promise<void> {
    await this.call('/api/social/read', { peerUid, cursor: Math.max(0, cursor) });
  }

  private async message(path: string, body: object): Promise<string> {
    const payload = (await this.call(path, body)) as { message?: unknown } | null;
    return typeof payload?.message === 'string' ? payload.message : '操作已完成。';
  }

  private async call(path: string, body?: object): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(path, {
        method: body ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body ? { 'Content-Type': 'application/json', 'X-Game-Request': '1' } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new SocialError(FALLBACK_MESSAGES[0]!, 0);
    }
    if (response.status === 204) return null;
    const payload = (await response.json().catch(() => null)) as { message?: unknown } | null;
    if (!response.ok) {
      // 404 分两种：路由不存在（后端还是旧版本，响应体为空）与目标不存在（服务端带 message）。
      // 混在一起会让人误以为“UID 错了”，所以这里按响应体是否可读来区分。
      if (response.status === 404 && typeof payload?.message !== 'string') {
        throw new SocialError(
          '好友接口不存在（HTTP 404）：后端可能还是旧版本，请重启本地 OnlineHost 后再试。',
          404,
        );
      }
      const fallback = FALLBACK_MESSAGES[response.status] ?? '好友服务暂时不可用，请稍后重试。';
      throw new SocialError(
        typeof payload?.message === 'string' ? payload.message : fallback,
        response.status,
      );
    }
    return payload;
  }
}
