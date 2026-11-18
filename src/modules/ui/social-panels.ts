type ApiRecord = Record<string, unknown>;
type Friend = { uid: string; displayName: string; status: string; incoming: boolean };

async function api(path: string, body?: object): Promise<ApiRecord> {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json', 'X-Game-Request': '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const value: unknown = await response.json().catch(() => ({}));
  const record = typeof value === 'object' && value !== null ? (value as ApiRecord) : {};
  if (!response.ok)
    throw new Error(typeof record.message === 'string' ? record.message : '请求失败，请重试。');
  return record;
}

function node<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing element: ${id}`);
  return result as T;
}

export function bindSocialPanels(): void {
  const profileStatus = node('profile-status');
  const history = node<HTMLOListElement>('profile-history');
  const friends = node<HTMLUListElement>('friend-list');
  let activeFriend: Friend | null = null;
  let cursor = 0;

  const loadProfile = async () => {
    profileStatus.textContent = '正在读取档案…';
    try {
      const profile = await api('/api/profile/self');
      node<HTMLInputElement>('profile-public').checked = profile.publicCollections === true;
      history.replaceChildren();
      const raids = Array.isArray(profile.raids) ? profile.raids : [];
      for (const entry of raids) {
        if (typeof entry !== 'object' || entry === null) continue;
        const wrapped = entry as ApiRecord;
        const result = wrapped.result as ApiRecord | undefined;
        if (!result) continue;
        const row = document.createElement('li');
        const summary = document.createElement('summary');
        const recordedAt = new Date(String(wrapped.recordedAt ?? '')).toLocaleString();
        summary.textContent = `收录于 ${recordedAt} · ${result.outcome === 'success' ? '撤离成功' : `行动失败（${String(result.reason ?? '未知原因')}）`} · 带出价值 ${String(result.value ?? 0)}`;
        const detail = document.createElement('details');
        detail.append(summary);
        const facts = document.createElement('p');
        const items = Array.isArray(result.items) ? result.items.length : 0;
        facts.textContent = `对局编号 ${String(result.raidId ?? '')}；结果 ${result.outcome === 'success' ? '成功' : '失败'}；原因 ${String(result.reason ?? '撤离成功')}；带出 ${items} 件物品；价值 ${String(result.value ?? 0)}。`;
        detail.append(facts);
        row.dataset.raidId = String(result.raidId ?? '');
        row.append(detail);
        history.append(row);
      }
      profileStatus.textContent = raids.length
        ? `共 ${raids.length} 局真实记录。`
        : '暂无对局记录。';
    } catch (error) {
      profileStatus.textContent = error instanceof Error ? error.message : '档案读取失败。';
    }
  };

  const loadFriends = async () => {
    const status = node('social-status');
    status.textContent = '正在读取好友…';
    try {
      const response = await api('/api/friends');
      const items = Array.isArray(response.friends) ? (response.friends as Friend[]) : [];
      friends.replaceChildren();
      node('social-unread').textContent = String(response.unread ?? 0);
      for (const friend of items) {
        const row = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = `${friend.displayName} · ${friend.uid}${friend.status === 'pending' ? ' · 待处理申请' : ''}`;
        row.append(label);
        if (friend.status === 'pending' && friend.incoming) {
          for (const [text, accept] of [
            ['接受', true],
            ['拒绝', false],
          ] as const) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'secondary';
            button.textContent = text;
            button.onclick = async () => {
              try {
                await api('/api/friends/respond', { targetUid: friend.uid, accept });
                await loadFriends();
              } catch (error) {
                status.textContent = error instanceof Error ? error.message : '申请处理失败。';
              }
            };
            row.append(button);
          }
        }
        if (friend.status === 'accepted') {
          const profile = document.createElement('button');
          profile.type = 'button';
          profile.className = 'secondary';
          profile.textContent = '公开档案';
          profile.onclick = () => void loadFriendProfile(friend);
          row.append(profile);
          const open = document.createElement('button');
          open.type = 'button';
          open.className = 'secondary';
          open.textContent = '打开私聊';
          open.onclick = () => void selectFriend(friend);
          row.append(open);
        }
        friends.append(row);
      }
      status.textContent = items.length ? `好友与待处理申请：${items.length}` : '好友列表为空。';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '好友读取失败。';
    }
  };

  const loadMessages = async () => {
    if (!activeFriend) return;
    const list = node<HTMLOListElement>('chat-messages');
    try {
      const query = new URLSearchParams({ with: activeFriend.uid, after: String(cursor) });
      const response = await api(`/api/messages?${query}`);
      const messages = Array.isArray(response.messages) ? (response.messages as ApiRecord[]) : [];
      for (const message of messages) {
        const row = document.createElement('li');
        row.textContent = `${message.senderId === activeFriend.uid ? activeFriend.displayName : '我'}：${String(message.text ?? '')}`;
        list.append(row);
        cursor = Math.max(cursor, Number(message.sequence) || 0);
      }
      if (cursor > 0)
        await api('/api/messages/read', { partnerUid: activeFriend.uid, sequence: cursor });
      node('social-unread').textContent = String(response.unread ?? 0);
      list.scrollTop = list.scrollHeight;
    } catch (error) {
      node('social-status').textContent = error instanceof Error ? error.message : '消息读取失败。';
    }
  };

  const selectFriend = async (friend: Friend) => {
    activeFriend = friend;
    cursor = 0;
    node('chat-messages').replaceChildren();
    node('chat-with').textContent = `正在与 ${friend.displayName} 私聊`;
    node<HTMLTextAreaElement>('chat-text').disabled = false;
    node<HTMLButtonElement>('chat-send').disabled = false;
    await loadMessages();
  };

  const loadFriendProfile = async (friend: Friend) => {
    const container = node('friend-profile');
    const status = node('friend-profile-status');
    const list = node<HTMLOListElement>('friend-profile-history');
    container.hidden = false;
    list.replaceChildren();
    try {
      const profile = await api(`/api/profile/${encodeURIComponent(friend.uid)}/public`);
      const collections = Array.isArray(profile.collections) ? profile.collections.map(String) : [];
      status.textContent = `${String(profile.displayName)} · 展示藏品：${collections.length ? collections.join('、') : '暂无'}`;
      const raids = Array.isArray(profile.recentRaids) ? profile.recentRaids : [];
      for (const entry of raids) {
        if (typeof entry !== 'object' || entry === null) continue;
        const wrapped = entry as ApiRecord;
        const result = wrapped.result as ApiRecord | undefined;
        if (!result) continue;
        const row = document.createElement('li');
        row.textContent = `收录于 ${new Date(String(wrapped.recordedAt ?? '')).toLocaleString()} · ${result.outcome === 'success' ? '撤离成功' : '行动失败'} · 带出价值 ${String(result.value ?? 0)}`;
        list.append(row);
      }
      if (!raids.length) status.textContent += ' · 暂无对局记录';
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : '公开档案读取失败。';
    }
  };

  node<HTMLButtonElement>('profile-refresh').onclick = () => void loadProfile();
  node<HTMLInputElement>('profile-public').onchange = async (event) => {
    const publicCollections = (event.currentTarget as HTMLInputElement).checked;
    try {
      await api('/api/profile/privacy', { publicCollections });
      profileStatus.textContent = publicCollections
        ? '好友可查看展示藏品与最近 20 局摘要。'
        : '好友公开档案已关闭。';
    } catch (error) {
      (event.currentTarget as HTMLInputElement).checked = !publicCollections;
      profileStatus.textContent = error instanceof Error ? error.message : '隐私设置保存失败。';
    }
  };
  node<HTMLButtonElement>('social-refresh').onclick = () => void loadFriends();
  node<HTMLFormElement>('friend-request-form').onsubmit = async (event) => {
    event.preventDefault();
    const input = node<HTMLInputElement>('friend-uid');
    try {
      const response = await api('/api/friends/request', {
        targetUid: input.value.trim(),
        requestId: crypto.randomUUID(),
      });
      node('social-status').textContent =
        response.status === 'accepted' ? '你们已经是好友。' : '好友申请已发送。';
      input.value = '';
      await loadFriends();
    } catch (error) {
      node('social-status').textContent =
        error instanceof Error ? error.message : '好友申请发送失败。';
    }
  };
  node<HTMLFormElement>('chat-form').onsubmit = async (event) => {
    event.preventDefault();
    if (!activeFriend) return;
    const input = node<HTMLTextAreaElement>('chat-text');
    const button = node<HTMLButtonElement>('chat-send');
    const text = input.value.trim();
    if (!text) return;
    button.disabled = true;
    node('social-status').textContent = '消息发送中…';
    try {
      await api('/api/messages', { messageId: crypto.randomUUID(), toUid: activeFriend.uid, text });
      input.value = '';
      node('social-status').textContent = '消息已保存并发送。';
      await loadMessages();
    } catch (error) {
      node('social-status').textContent =
        error instanceof Error ? error.message : '消息发送失败，可重试。';
    } finally {
      button.disabled = false;
    }
  };
  node<HTMLButtonElement>('social-refresh').click();
  node<HTMLButtonElement>('profile-refresh').click();
  window.setInterval(() => void loadMessages(), 5000);
}
