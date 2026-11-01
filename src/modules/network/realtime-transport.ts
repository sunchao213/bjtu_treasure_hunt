import {
  REALTIME_PROTOCOL_VERSION,
  type ClientMessage,
  type ConnectionState,
  type ServerMessage,
  isServerMessage,
} from '../../shared/net/protocol';

export interface RealtimeTransport {
  readonly state: ConnectionState;
  connect(): Promise<void>;
  send(message: ClientMessage): void;
  close(): void;
  onMessage(listener: (message: ServerMessage) => void): () => void;
  onStateChange(listener: (state: ConnectionState) => void): () => void;
}

type Listener<T> = (value: T) => void;

abstract class BaseTransport implements RealtimeTransport {
  private currentState: ConnectionState = 'idle';
  private readonly messageListeners = new Set<Listener<ServerMessage>>();
  private readonly stateListeners = new Set<Listener<ConnectionState>>();

  get state(): ConnectionState {
    return this.currentState;
  }

  abstract connect(): Promise<void>;
  abstract send(message: ClientMessage): void;
  abstract close(): void;

  onMessage(listener: Listener<ServerMessage>): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStateChange(listener: Listener<ConnectionState>): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  protected setState(state: ConnectionState): void {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const listener of this.stateListeners) listener(state);
  }

  protected emit(message: ServerMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

export class WebSocketTransport extends BaseTransport {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private manuallyClosed = false;
  private reconnectAttempt = 0;

  constructor(
    private readonly url: string,
    private readonly reconnect = true,
  ) {
    super();
  }

  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    this.manuallyClosed = false;
    this.setState(this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting');
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      let settled = false;
      socket.addEventListener('open', () => {
        this.reconnectAttempt = 0;
        this.setState('open');
        settled = true;
        resolve();
      });
      socket.addEventListener('message', (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          this.setState('error');
          return;
        }
        if (isServerMessage(parsed)) this.emit(parsed);
      });
      socket.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          reject(new Error('WebSocket 连接失败。'));
        }
        this.setState('error');
      });
      socket.addEventListener('close', () => {
        this.socket = null;
        if (!this.manuallyClosed && this.reconnect) this.scheduleReconnect();
        else this.setState('closed');
      });
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 尚未连接。');
    }
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.setState('closed');
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null) return;
    this.reconnectAttempt += 1;
    const delay = Math.min(10_000, 500 * 2 ** Math.min(this.reconnectAttempt - 1, 4));
    this.setState('reconnecting');
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }
}

interface DemoMember {
  playerId: string;
  displayName: string;
  ready: boolean;
  connected: boolean;
}

interface DemoWireMessage {
  readonly kind: 'bjtu-room-demo';
  readonly senderId: string;
  readonly action: 'create' | 'join' | 'ready' | 'start' | 'leave' | 'snapshot';
  readonly roomId: string;
  readonly member?: DemoMember;
  readonly ready?: boolean;
  readonly snapshot?: {
    hostId: string;
    status: 'lobby' | 'starting';
    members: DemoMember[];
  };
}

const DEMO_CHANNEL = 'bjtu-treasure-hunt:rooms:v1';

/** Development-only room adapter. It exercises the same protocol without a server. */
export class BroadcastRoomTransport extends BaseTransport {
  private readonly clientId = `demo-${crypto.randomUUID()}`;
  private readonly channel = new BroadcastChannel(DEMO_CHANNEL);
  private readonly rooms = new Map<
    string,
    { hostId: string; status: 'lobby' | 'starting'; members: DemoMember[] }
  >();
  private readonly onChannelMessage = (event: MessageEvent<DemoWireMessage>) => {
    const message = event.data;
    if (message?.kind !== 'bjtu-room-demo' || message.senderId === this.clientId) return;
    const room = this.rooms.get(message.roomId);
    if (message.action === 'create') {
      if (room) return;
      this.rooms.set(message.roomId, {
        hostId: message.senderId,
        status: 'lobby',
        members: message.member ? [message.member] : [],
      });
      return;
    }
    if (message.action === 'snapshot' && message.snapshot) {
      this.rooms.set(message.roomId, structuredClone(message.snapshot));
      this.emit({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'room.snapshot',
        snapshot: this.snapshot(message.roomId),
      });
      return;
    }
    if (!room) return;
    if (
      message.action === 'join' &&
      message.member &&
      !room.members.some((item) => item.playerId === message.member?.playerId)
    ) {
      if (room.members.length >= 4) return;
      room.members.push(message.member);
      this.broadcastSnapshot(message.roomId);
      return;
    }
    if (message.action === 'ready' && message.member) {
      const member = room.members.find((item) => item.playerId === message.member?.playerId);
      if (member) member.ready = message.ready === true;
      this.broadcastSnapshot(message.roomId);
      return;
    }
    if (message.action === 'start' && message.senderId === room.hostId) {
      room.status = 'starting';
      this.broadcastSnapshot(message.roomId);
      this.emit({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'room.started',
        snapshot: this.snapshot(message.roomId),
        raidId: `demo-raid-${message.roomId}`,
      });
      return;
    }
    if (message.action === 'leave') {
      room.members = room.members.filter((item) => item.playerId !== message.senderId);
      this.broadcastSnapshot(message.roomId);
    }
  };

  constructor() {
    super();
    this.channel.addEventListener('message', this.onChannelMessage);
  }

  async connect(): Promise<void> {
    this.setState('connecting');
    await Promise.resolve();
    this.setState('open');
    this.emit({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'connection.ready',
      playerId: this.clientId,
      serverTick: 0,
    });
  }

  send(message: ClientMessage): void {
    if (this.state !== 'open') throw new Error('联机通道尚未连接。');
    const roomId = message.roomId ?? '';
    if (message.type === 'room.create') {
      const snapshot = {
        hostId: this.clientId,
        status: 'lobby' as const,
        members: [
          {
            playerId: this.clientId,
            displayName: message.displayName,
            ready: false,
            connected: true,
          },
        ],
      };
      this.rooms.set(roomId, snapshot);
      this.channel.postMessage({
        kind: 'bjtu-room-demo',
        senderId: this.clientId,
        action: 'create',
        roomId,
        member: snapshot.members[0],
      });
      this.emit({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'room.snapshot',
        requestId: message.requestId,
        snapshot: this.snapshot(roomId),
      });
      return;
    }
    const local = this.rooms.get(roomId);
    if (message.type === 'room.join') {
      const member = {
        playerId: this.clientId,
        displayName: message.displayName,
        ready: false,
        connected: true,
      };
      if (!local) {
        this.rooms.set(roomId, { hostId: '', status: 'lobby', members: [member] });
      } else if (!local.members.some((item) => item.playerId === this.clientId)) {
        local.members.push(member);
      }
      this.channel.postMessage({
        kind: 'bjtu-room-demo',
        senderId: this.clientId,
        action: 'join',
        roomId,
        member,
      });
      this.emit({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'room.snapshot',
        requestId: message.requestId,
        snapshot: this.snapshot(roomId),
      });
      return;
    }
    if (!local) {
      this.emit({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'error',
        requestId: message.requestId,
        code: 'ROOM_NOT_FOUND',
        message: '房间不存在或尚未同步。',
      });
      return;
    }
    if (message.type === 'room.ready') {
      const member = local.members.find((item) => item.playerId === this.clientId);
      if (member) member.ready = message.ready;
      this.channel.postMessage({
        kind: 'bjtu-room-demo',
        senderId: this.clientId,
        action: 'ready',
        roomId,
        member,
        ready: message.ready,
      });
      this.broadcastSnapshot(roomId, message.requestId);
    } else if (message.type === 'room.start') {
      if (local.hostId !== this.clientId) {
        this.emit({
          version: REALTIME_PROTOCOL_VERSION,
          type: 'error',
          requestId: message.requestId,
          code: 'NOT_HOST',
          message: '只有房主可以开始房间。',
        });
        return;
      }
      local.status = 'starting';
      this.channel.postMessage({
        kind: 'bjtu-room-demo',
        senderId: this.clientId,
        action: 'start',
        roomId,
      });
      this.emit({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'room.started',
        requestId: message.requestId,
        snapshot: this.snapshot(roomId),
        raidId: `demo-raid-${roomId}`,
      });
    } else if (message.type === 'room.leave') {
      this.channel.postMessage({
        kind: 'bjtu-room-demo',
        senderId: this.clientId,
        action: 'leave',
        roomId,
      });
      this.rooms.delete(roomId);
    }
  }

  close(): void {
    this.channel.close();
    this.setState('closed');
  }

  private snapshot(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error('房间不存在。');
    return {
      roomId,
      hostId: room.hostId,
      status: room.status,
      maxPlayers: 4,
      members: structuredClone(room.members),
      serverTick: Date.now(),
    };
  }

  private broadcastSnapshot(roomId: string, requestId?: string): void {
    this.emit({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'room.snapshot',
      requestId,
      snapshot: this.snapshot(roomId),
    });
    const room = this.rooms.get(roomId);
    if (!room) return;
    this.channel.postMessage({
      kind: 'bjtu-room-demo',
      senderId: this.clientId,
      action: 'snapshot',
      roomId,
      snapshot: structuredClone(room),
    });
  }
}
