import { ROOM_CHAT_LIMIT, type RoomChatTransport } from '../network/realtime-transport';
import type { RoomSession, RoomSessionState } from '../network/room-session';

const connectionNames: Record<RoomSessionState, string> = {
  idle: '未连接',
  connecting: '连接中',
  connected: '已连接',
  'in-room': '房间中',
  started: '已开始',
  closed: '已关闭',
  error: '连接异常',
};

export function bindLobbyRoom(
  root: HTMLElement,
  room: RoomSession,
  chat: RoomChatTransport,
  guest = false,
): () => void {
  const get = <T extends HTMLElement>(id: string): T => root.querySelector<T>(`#${id}`)!;
  const dialog = get<HTMLDialogElement>('room-panel');
  const connection = get('room-connection');
  const status = get('room-status');
  const code = get<HTMLInputElement>('room-code');
  const name = get<HTMLInputElement>('room-name');
  const create = get<HTMLButtonElement>('room-create');
  const join = get<HTMLButtonElement>('room-join');
  const controls = get('room-controls');
  const members = get('room-members');
  const ready = get<HTMLButtonElement>('room-ready');
  const start = get<HTMLButtonElement>('room-start');
  const form = get<HTMLFormElement>('lobby-chat');
  const input = get<HTMLInputElement>('lobby-chat-input');
  const latest = get('lobby-chat-latest');
  const openers = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-open-room]'));
  let roomId: string | null = null;
  let editing = false;

  const syncHint = () => {
    input.placeholder = latest.textContent || editing ? '' : '和朋友聊天...';
    latest.classList.toggle('is-obscured', editing || Boolean(input.value));
  };
  const render = () => {
    const snapshot = room.snapshot;
    if ((snapshot?.roomId ?? null) !== roomId) {
      if (roomId) input.value = '';
      roomId = snapshot?.roomId ?? null;
      latest.textContent = '';
      syncHint();
    }
    connection.textContent = connectionNames[room.state];
    status.textContent =
      room.error ??
      (snapshot
        ? `房间 ${snapshot.roomId} · ${snapshot.members.length}/${snapshot.maxPlayers} 人`
        : '输入房间号加入，或创建一个房间。');
    const canJoin = chat.state === 'open' && Boolean(room.playerId) && !snapshot;
    create.disabled = !canJoin || guest;
    join.disabled = !canJoin;
    name.disabled = Boolean(snapshot);
    code.readOnly = Boolean(snapshot);
    controls.hidden = !snapshot;
    members.hidden = !snapshot;
    members.replaceChildren();
    if (!snapshot) return;
    code.value = snapshot.roomId;
    for (const member of snapshot.members) {
      const row = document.createElement('div');
      row.className = 'room-member';
      const label = document.createElement('span');
      label.textContent = `${member.displayName}${member.playerId === snapshot.hostId ? ' · 房主' : ''}`;
      const state = document.createElement('span');
      state.textContent = member.connected ? (member.ready ? '已准备' : '未准备') : '已断线';
      row.append(label, state);
      members.append(row);
    }
    const own = snapshot.members.find((member) => member.playerId === room.playerId);
    ready.textContent = own?.ready ? '取消准备' : '准备';
    ready.disabled = !own || snapshot.status !== 'lobby';
    start.disabled = snapshot.hostId !== room.playerId || snapshot.status !== 'lobby';
  };
  const unsubscribe = room.subscribe(render);
  const unsubscribeChat = chat.onChat((message) => {
    if (message.roomId !== roomId) return;
    editing = false;
    latest.textContent = `${message.displayName}：${message.text}`;
    syncHint();
  });
  for (const opener of openers) opener.onclick = () => dialog.showModal();
  create.hidden = guest;
  create.onclick = () => {
    room.createRoom(
      name.value.trim() || '探险者',
      `BJTU-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    );
  };
  join.onclick = () => {
    const id = code.value.trim().toUpperCase();
    if (id) room.joinRoom(name.value.trim() || '探险者', id);
    else {
      status.textContent = '请输入房间号。';
      code.focus();
    }
  };
  ready.onclick = () => {
    const own = room.snapshot?.members.find((member) => member.playerId === room.playerId);
    if (own) room.setReady(!own.ready);
  };
  start.onclick = () => room.startRoom();
  get('room-leave').onclick = () => room.leaveRoom();
  input.maxLength = ROOM_CHAT_LIMIT;
  input.onfocus = () => {
    editing = true;
    syncHint();
  };
  input.onblur = () => {
    editing = false;
    syncHint();
  };
  input.oninput = syncHint;
  form.onsubmit = (event) => {
    event.preventDefault();
    const draft = input.value.trim();
    if (!draft) return;
    let sent = false;
    if (roomId) {
      try {
        sent = chat.sendChat(roomId, draft);
      } catch {
        // The connection may close between checking its state and sending.
      }
    }
    if (!roomId) {
      latest.textContent = '创建或加入房间后即可发送。';
    } else if (sent) {
      input.value = '';
      syncHint();
      return;
    } else {
      latest.textContent = '消息未发送，请确认房间仍然连接。';
    }
    editing = false;
    input.blur();
    syncHint();
  };
  render();
  void room.connect().catch(render);
  return () => {
    unsubscribe();
    unsubscribeChat();
  };
}
