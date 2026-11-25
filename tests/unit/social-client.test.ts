import { describe, expect, it, vi } from 'vitest';
import {
  MESSAGE_MAX_LENGTH,
  SocialClient,
  SocialError,
  countCharacters,
  createMessageId,
  describeUnread,
  shortenUid,
  validateMessage,
} from '../../src/modules/social/social-client';
import { friendsPanelMarkup } from '../../src/modules/ui/friends-panel';

describe('好友私聊的输入校验', () => {
  it('拒绝空消息与纯空白', () => {
    expect(validateMessage('')).toBe('消息不能为空。');
    expect(validateMessage('   \n  ')).toBe('消息不能为空。');
  });

  it('接受 1—200 个字符并保留换行', () => {
    expect(validateMessage('今晚一起夜巡')).toBeNull();
    expect(validateMessage('a\nb')).toBeNull();
    expect(validateMessage('字'.repeat(MESSAGE_MAX_LENGTH))).toBeNull();
  });

  it('超过 200 个字符时给出带当前长度的提示', () => {
    const message = validateMessage('字'.repeat(MESSAGE_MAX_LENGTH + 1));
    expect(message).toContain('最多 200 个字符');
    expect(message).toContain('201');
  });

  it('按 Unicode 码点计数，emoji 不算两个字符', () => {
    expect(countCharacters('😀')).toBe(1);
    expect(countCharacters('😀'.repeat(MESSAGE_MAX_LENGTH))).toBe(MESSAGE_MAX_LENGTH);
    expect(validateMessage('😀'.repeat(MESSAGE_MAX_LENGTH))).toBeNull();
    expect(validateMessage('😀'.repeat(MESSAGE_MAX_LENGTH + 1))).not.toBeNull();
  });

  it('拒绝 NUL 等无法保存的字符', () => {
    expect(validateMessage('bad\u0000text')).toContain('无法保存');
  });
});

describe('消息标识与文案', () => {
  it('生成可用于幂等重试的消息标识', () => {
    const id = createMessageId();
    expect(id).toMatch(/^[A-Za-z0-9-]{16,64}$/);
    expect(createMessageId()).not.toBe(id);
  });

  it('未读文案随数量变化', () => {
    expect(describeUnread(0)).toBe('暂无未读');
    expect(describeUnread(3)).toBe('3 条未读');
  });

  it('列表用短 UID，短于 14 位时原样返回', () => {
    expect(shortenUid('a'.repeat(32))).toBe(`${'a'.repeat(8)}…${'a'.repeat(4)}`);
    expect(shortenUid('abc-123')).toBe('abc-123');
  });
});

describe('好友面板结构', () => {
  it('面板提供「我的 UID」与复制按钮，否则无法按 UID 加好友', () => {
    const markup = friendsPanelMarkup();
    expect(markup).toContain('id="friends-self-uid"');
    expect(markup).toContain('id="friends-copy-uid"');
    expect(markup).toContain('我的 UID');
    expect(markup).toContain('data-lobby-panel="friends"');
  });

  it('把邀请管理与好友列表、私聊放在独立分区', () => {
    const markup = friendsPanelMarkup();
    expect(markup).toContain('aria-labelledby="friends-operations-title"');
    expect(markup).toContain('aria-labelledby="friends-directory-title"');
    expect(markup).toContain('aria-label="好友与私聊"');
    expect(markup).toContain('data-friends-mode-option="invite"');
    expect(markup).toContain('data-friends-mode-option="friends"');
    expect(markup).toContain('id="friends-requests-list"');
    expect(markup).toContain('id="friends-list"');
    expect(markup).toContain('id="friends-chat"');
    expect(markup).toContain('id="friends-chat-head" class="friends-chat-head" hidden');
    expect(markup).toContain(
      'id="friends-chat-status" class="friends-status" role="status" aria-live="polite" hidden',
    );
  });
});

describe('好友接口客户端', () => {
  it('本地节流与 5 条/10 秒一致', () => {
    const client = new SocialClient(vi.fn());
    for (let index = 0; index < 5; index += 1) {
      expect(client.canSendNow()).toBe(true);
      client.noteSent();
    }
    expect(client.canSendNow()).toBe(false);
  });

  it('发送时带上会话与同源头，并把服务端提示透出', async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json({ message: '发送过快：每 10 秒最多 5 条，请稍后再试。' }, { status: 429 }),
      );
    const client = new SocialClient(request);
    await expect(client.send('a'.repeat(32), '你好', 'msg-1234567890')).rejects.toMatchObject({
      message: expect.stringContaining('每 10 秒最多 5 条'),
      status: 429,
    });
    const [path, init] = request.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/social/messages');
    expect(init.credentials).toBe('same-origin');
    expect((init.headers as Record<string, string>)['X-Game-Request']).toBe('1');
  });

  it('名册响应缺字段时按异常处理，不静默接受', async () => {
    const client = new SocialClient(vi.fn().mockResolvedValue(Response.json({ self: null })));
    await expect(client.roster()).rejects.toBeInstanceOf(SocialError);
  });

  it('网络不可达时给出可读提示', async () => {
    const client = new SocialClient(vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    await expect(client.roster()).rejects.toThrow('无法连接好友服务');
  });

  it('404 区分“接口不存在”与“UID 不存在”，避免让人误以为输错了 UID', async () => {
    const missingRoute = new SocialClient(
      vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
    );
    await expect(missingRoute.lookup('a'.repeat(32))).rejects.toThrow('好友接口不存在');

    const missingUser = new SocialClient(
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: '该 UID 在本服务器没有对应账号。' }, { status: 404 }),
        ),
    );
    await expect(missingUser.lookup('a'.repeat(32))).rejects.toThrow(
      '该 UID 在本服务器没有对应账号',
    );
  });
});
