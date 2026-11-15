import { NetworkSession } from '../network/network-session';
import { ROOM_CAPACITY, type RoomState } from '../network/network-protocol';
import type { ConfirmHandle } from './confirm-dialog';

interface LobbyOptions {
  readonly network: NetworkSession;
  readonly confirm: ConfirmHandle;
  readonly canPrepare: () => boolean;
  readonly canEnter: () => boolean;
  readonly onChange: () => void;
  readonly onPlayers: (players: RoomState['players']) => void;
  readonly onPlayerLeft: (id: string) => void;
  readonly onStart: () => Promise<void>;
}

export function bindRoomLobby(options: LobbyOptions) {
  const { network } = options;
  const get = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const button = (id: string) => get<HTMLButtonElement>(id);
  const roomInput = get<HTMLInputElement>('network-room');
  let state: RoomState | null = null;
  let pending = false;
  let lastRoster = '';
  let lastTeam = '';
  let lastStartedRound = '';
  let lastFinishedRound = '';
  let message = '正在连接联机服务…';
  let pendingAction: 'create' | 'join' | 'ready' | 'start' | 'settings' | 'transfer' | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;

  const clearPending = () => {
    clearTimeout(pendingTimer);
    pending = false;
    pendingAction = null;
  };

  const render = () => {
    const connected = network.getStatus() === 'connected';
    const self = state?.players.find((player) => player.playerId === network.getPlayerId());
    const host = !!state && state.hostId === network.getPlayerId();
    const capacity = state?.maxPlayers ?? ROOM_CAPACITY;
    const latency = network.getLatencyMs();
    const quality = !connected
      ? network.getStatus() === 'reconnecting'
        ? '连接中断 · 正在重连'
        : '未连接'
      : latency === null
        ? '已连接 · 测量延迟中'
        : `${latency} ms · ${latency < 100 ? '流畅' : latency < 250 ? '一般' : '延迟较高'}`;
    for (const id of ['network-quality', 'team-connection']) {
      get(id).textContent = quality;
      get(id).dataset.quality = !connected
        ? 'offline'
        : latency !== null && latency >= 250
          ? 'slow'
          : 'good';
    }
    get('team-status').hidden = !state;
    const team = JSON.stringify([
      state?.started,
      state?.hostId,
      state?.players.map(({ playerId, displayName, connected, finished, ready }) => [
        playerId,
        displayName,
        connected,
        finished,
        ready,
      ]),
    ]);
    if (team !== lastTeam) {
      lastTeam = team;
      get('team-players').replaceChildren(
        ...(state?.players ?? []).map((player) => {
          const li = document.createElement('li');
          li.textContent = `${player.displayName}${player.playerId === network.getPlayerId() ? '（你）' : ''} · ${!player.connected ? '离线' : state?.started ? (player.finished ? '已结束' : '探索中') : player.playerId === state?.hostId ? '房主' : player.ready ? '已准备' : '未准备'}`;
          return li;
        }),
      );
    }
    const allReady =
      !!state &&
      state.players.every(
        (player) => player.connected && (player.playerId === state?.hostId || player.ready),
      );
    const canPrepare = options.canPrepare();
    get('room-entry').hidden = !!state;
    get('room-lobby').hidden = !state;
    get('network-status').textContent = message;
    button('network-connect').hidden = connected;
    button('network-connect').disabled =
      network.getStatus() === 'connecting' || network.getStatus() === 'reconnecting';
    button('network-create').disabled = !connected || pending || !options.canEnter();
    button('network-join').disabled = !connected || pending || !options.canEnter();
    roomInput.disabled = pending;
    button('network-leave').disabled = !connected || pending;
    button('network-ready').hidden = host;
    button('network-start').hidden = !host;
    button('network-ready').disabled =
      !connected || pending || !!state?.started || (!self?.ready && !canPrepare);
    button('network-ready').textContent = self?.ready ? '取消准备' : '准备';
    button('network-ready').setAttribute('aria-pressed', String(!!self?.ready));
    button('network-start').disabled =
      !connected || pending || !canPrepare || !allReady || !!state?.started;
    button('network-start').textContent = state?.started
      ? '游戏进行中'
      : pendingAction === 'start'
        ? '正在开始…'
        : '开始游戏 ↗';
    get('room-count').textContent = `${state?.players.length ?? 0} / ${capacity} 人`;
    get('room-readiness').textContent = state?.started
      ? `${state.players.filter((player) => player.finished).length} / ${state.players.length} 人已结束`
      : `${state?.players.filter((player) => player.ready || player.playerId === state?.hostId).length ?? 0} / ${state?.players.length ?? 0} 人就绪`;
    get<HTMLFieldSetElement>('room-settings').disabled =
      !host || !connected || pending || !!state?.started;
    get<HTMLSelectElement>('network-capacity').value = String(capacity);
    for (const option of get<HTMLSelectElement>('network-capacity').options) {
      option.disabled = Number(option.value) < (state?.players.length ?? 0);
    }
    get<HTMLSelectElement>('network-admission').value =
      state?.admissionOpen === false ? 'closed' : 'open';
    get('room-settings-hint').textContent = state?.started
      ? '本局规则已锁定，所有成员结束后可修改。'
      : host
        ? '仅房主可修改；规则变更后，队友需要重新准备。'
        : '房间规则由房主设置，修改后请重新确认装备并准备。';
    get('room-state-title').textContent = state?.roomId ?? '';
    get('room-prepare-title').textContent = state?.started ? '本局进行中' : '选择装备，等待出发';
    get('room-ready-hint').textContent = state?.started
      ? '本局进行中，所有成员结束后可准备下一局。'
      : !canPrepare && !self?.ready
        ? '请选择装备并勾选上方风险确认；本局已结束时，请先返回准备。'
        : host
          ? allReady
            ? '队友已全部准备，可以开始游戏。'
            : '等待所有队友准备后，即可开始游戏。'
          : self?.ready
            ? '已准备，等待房主开始游戏。'
            : '确认装备后点击准备，等待房主开始游戏。';
    const roster = JSON.stringify([
      capacity,
      state?.hostId,
      state?.started,
      pending,
      connected,
      state?.players.map(({ playerId, displayName, ready, finished, connected }) => [
        playerId,
        displayName,
        ready,
        finished,
        connected,
      ]),
    ]);
    if (roster !== lastRoster) {
      lastRoster = roster;
      const slots = Array.from({ length: capacity }, (_, index) => {
        const player = state?.players[index];
        const li = document.createElement('li');
        const name = document.createElement('span');
        const badge = document.createElement('small');
        li.className = player ? 'room-member' : 'room-member room-seat-empty';
        name.textContent = player
          ? `${player.displayName}${player.playerId === network.getPlayerId() ? '（你）' : ''}`
          : `空位 ${index + 1}`;
        badge.textContent = !player
          ? '等待加入'
          : !player.connected
            ? '离线'
            : state?.started
              ? player.finished
                ? '已结束'
                : '游戏中'
              : player.playerId === state?.hostId
                ? '房主'
                : player.ready
                  ? '已准备'
                  : '未准备';
        if (player?.playerId === state?.hostId && state?.started)
          badge.textContent = `房主 · ${badge.textContent}`;
        li.dataset.ready = String(!!player?.ready || player?.playerId === state?.hostId);
        li.append(name, badge);
        if (host && player && player.playerId !== state?.hostId && !state?.started) {
          const transfer = document.createElement('button');
          transfer.type = 'button';
          transfer.className = 'room-transfer rules-button';
          transfer.textContent = '转交房主';
          transfer.setAttribute('aria-label', `将房主转交给 ${player.displayName}`);
          transfer.disabled = pending || !connected || !player.connected;
          transfer.onclick = async () => {
            if (
              !(await options.confirm.ask({
                title: `转交给 ${player.displayName}？`,
                message: '转交后，你将成为普通队员，所有队友需要重新准备。',
                confirmText: '转交房主',
              }))
            )
              return;
            request('transfer', () => network.transferHost(player.playerId), '正在转交房主…');
          };
          li.append(transfer);
        }
        return li;
      });
      get('network-players').replaceChildren(...slots);
    }
  };
  const request = (action: typeof pendingAction, send: () => boolean, status: string) => {
    if (pending || !send()) return;
    pending = true;
    pendingAction = action;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      clearPending();
      message = '房间请求超时，请检查网络后重试。';
      options.onChange();
    }, 8000);
    message = status;
    options.onChange();
  };
  button('network-connect').onclick = () => network.connect();
  const changeSettings = () =>
    request(
      'settings',
      () =>
        network.setRoomSettings(
          Number(get<HTMLSelectElement>('network-capacity').value),
          get<HTMLSelectElement>('network-admission').value === 'open',
        ),
      '正在同步房间规则，队友将需要重新准备…',
    );
  get<HTMLSelectElement>('network-capacity').onchange = changeSettings;
  get<HTMLSelectElement>('network-admission').onchange = changeSettings;
  button('network-create').onclick = () => {
    if (!options.canEnter()) return;
    request('create', () => network.createRoom(), '正在创建房间…');
  };
  roomInput.oninput = () => roomInput.setCustomValidity('');
  get<HTMLFormElement>('network-form').onsubmit = (event) => {
    event.preventDefault();
    if (!options.canEnter()) return;
    roomInput.setCustomValidity(
      /^[0-9]{6}$/.test(roomInput.value) ? '' : '请输入 6 位数字房间号。',
    );
    if (!roomInput.reportValidity()) return;
    request('join', () => network.join(roomInput.value), '正在加入房间…');
  };
  button('network-ready').onclick = () => {
    const ready =
      state?.players.find((player) => player.playerId === network.getPlayerId())?.ready ?? false;
    if (!ready && !options.canPrepare()) return;
    request('ready', () => network.setReady(!ready), ready ? '正在取消准备…' : '正在准备…');
  };
  button('network-start').onclick = () => {
    if (!options.canPrepare()) return;
    request('start', () => network.startGame(), '正在通知队友进入校园…');
  };
  const leave = () => {
    if (!state) return;
    if (
      state.hostId === network.getPlayerId() &&
      state.players.length > 1 &&
      !confirm('退出后会将房主转交给下一位成员，确定退出房间吗？')
    )
      return;
    network.leave();
    state = null;
    clearPending();
    lastStartedRound = lastFinishedRound = '';
    message = '已退出房间，可以创建或加入其他房间。';
    options.onPlayers([]);
    options.onChange();
  };
  button('network-leave').onclick = leave;
  button('network-copy').onclick = async () => {
    if (!state) return;
    try {
      await navigator.clipboard.writeText(state.roomId);
      message = '房间号已复制，分享给同伴即可加入。';
    } catch {
      message = `请将房间号 ${state.roomId} 分享给同伴。`;
    }
    render();
  };
  const offStatus = network.onStatus((status) => {
    if (status !== 'connected') clearPending();
    message = {
      offline: '联机服务未连接，请重新连接。',
      connecting: '正在连接联机服务…',
      connected: '已连接，创建房间或输入房间号加入。',
      reconnecting: '连接中断，正在自动重连…',
    }[status];
    if (status !== 'connected') options.onPlayers([]);
    options.onChange();
    if (status === 'connected') network.ping();
  });
  const offMessage = network.onMessage((incoming) => {
    if (incoming.type === 'room-state') {
      const previous = state;
      state = incoming;
      clearPending();
      message = `房间 ${state.roomId} · ${state.players.length} / ${state.maxPlayers} 人${state.started ? ' · 游戏中' : state.admissionOpen === false ? ' · 已关闭加入' : ''}`;
      if (
        previous &&
        (previous.maxPlayers !== state.maxPlayers || previous.admissionOpen !== state.admissionOpen)
      )
        message += ' · 房间规则已更新，请重新准备';
      if (previous && previous.hostId !== state.hostId && state.hostId === network.getPlayerId())
        message += ' · 你已成为新房主';
      options.onPlayers(state.players);
      options.onChange();
      const self = state.players.find((player) => player.playerId === network.getPlayerId());
      if (state.started && state.roundId && state.roundId !== lastStartedRound && !self?.finished) {
        lastStartedRound = state.roundId;
        void options.onStart().catch(() => {
          message = '进入校园失败，请返回准备后重试。';
          if (state?.roundId) network.finishGame(state.roundId);
          options.onChange();
        });
      }
    } else if (incoming.type === 'pong') render();
    else if (incoming.type === 'player-left') options.onPlayerLeft(incoming.playerId);
    else if (incoming.type === 'error') {
      clearPending();
      message = incoming.message;
      if (!network.isInRoom()) state = null;
      options.onChange();
    }
  });
  const pingTimer = setInterval(() => {
    if (network.getStatus() === 'connected') network.ping();
  }, 3000);
  return {
    render,
    leave,
    connect: () => {
      if (network.getStatus() === 'offline') network.connect();
    },
    isJoined: () => !!state,
    isLocked: () =>
      !!state?.started ||
      !!state?.players.find((player) => player.playerId === network.getPlayerId())?.ready,
    finish: () => {
      if (
        state?.roundId &&
        state.roundId !== lastFinishedRound &&
        network.finishGame(state.roundId)
      )
        lastFinishedRound = state.roundId;
    },
    dispose: () => {
      clearInterval(pingTimer);
      clearPending();
      offStatus();
      offMessage();
    },
  };
}
