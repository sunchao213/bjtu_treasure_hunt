import {
  decodeServerMessage,
  encodeClientMessage,
  NETWORK_PROTOCOL_VERSION,
  isRoomCode,
  type ClientMessage,
  type PlayerSnapshot,
  type ServerMessage,
  type RoomState,
} from './network-protocol';

export type NetworkStatus = 'offline' | 'connecting' | 'connected' | 'reconnecting';

export interface NetworkSocket {
  readonly readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { readonly data: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface NetworkSocketFactory {
  (url: string): NetworkSocket;
}

export interface NetworkSessionOptions {
  readonly url: string;
  readonly sessionId: string;
  readonly displayName: string;
  readonly now?: () => number;
  readonly socketFactory?: NetworkSocketFactory;
  readonly reconnectDelayMs?: number;
}

const OPEN = 1;

/**
 * Small transport boundary for the online mode. The server remains authoritative:
 * this class only sends input and renders validated snapshots received from it.
 */
export class NetworkSession {
  private socket: NetworkSocket | null = null;
  private status: NetworkStatus = 'offline';
  private roomId: string | null = null;
  private inRoom = false;
  private membershipPending = false;
  private lastRoomTick = -1;
  private roomState: RoomState | null = null;
  private playerId: string | null = null;
  private sequence = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(message: ServerMessage) => void>();
  private readonly statusListeners = new Set<(status: NetworkStatus) => void>();
  private readonly now: () => number;
  private readonly socketFactory: NetworkSocketFactory;
  private readonly reconnectDelayMs: number;
  private displayName: string;

  constructor(private readonly options: NetworkSessionOptions) {
    this.now = options.now ?? Date.now;
    this.displayName = options.displayName;
    this.socketFactory =
      options.socketFactory ??
      ((url) => {
        const socket = new WebSocket(url);
        return {
          get readyState() {
            return socket.readyState;
          },
          get onopen() {
            return socket.onopen ? () => socket.onopen?.(new Event('open')) : null;
          },
          set onopen(handler) {
            socket.onopen = handler ? () => handler() : null;
          },
          get onclose() {
            return socket.onclose ? () => socket.onclose?.(new CloseEvent('close')) : null;
          },
          set onclose(handler) {
            socket.onclose = handler ? () => handler() : null;
          },
          get onerror() {
            return socket.onerror ? () => socket.onerror?.(new Event('error')) : null;
          },
          set onerror(handler) {
            socket.onerror = handler ? () => handler() : null;
          },
          get onmessage() {
            return socket.onmessage
              ? (event: { readonly data: string }) => socket.onmessage?.(event as MessageEvent)
              : null;
          },
          set onmessage(handler) {
            socket.onmessage = handler ? (event) => handler({ data: String(event.data) }) : null;
          },
          send(data: string) {
            socket.send(data);
          },
          close() {
            socket.close();
          },
        };
      });
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_500;
  }

  setDisplayName(displayName: string): void {
    const name = displayName.trim().slice(0, 18);
    if (name) this.displayName = name;
  }

  getStatus(): NetworkStatus {
    return this.status;
  }

  getPlayerId(): string | null {
    return this.playerId;
  }

  getRoomState(): RoomState | null {
    return this.roomState;
  }

  getLocalPlayer(): PlayerSnapshot | undefined {
    return this.roomState?.players.find((player) => player.playerId === this.playerId);
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: (status: NetworkStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  connect(): void {
    if (this.status === 'connecting' || this.status === 'connected') return;
    this.clearReconnectTimer();
    this.setStatus(this.status === 'offline' ? 'connecting' : 'reconnecting');
    const socket = this.socketFactory(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      this.setStatus('connected');
      this.send({
        type: 'hello',
        protocol: NETWORK_PROTOCOL_VERSION,
        sessionId: this.options.sessionId,
        displayName: this.displayName,
      });
      if (this.roomId) {
        this.membershipPending = true;
        this.send({ type: 'join-room', roomId: this.roomId });
      }
    };
    socket.onmessage = ({ data }) => {
      try {
        const message = decodeServerMessage(data);
        if (message.type === 'welcome') this.playerId = message.playerId;
        if (message.type === 'room-state') {
          if (this.roomId && message.roomId !== this.roomId) return;
          if (message.roomId === this.roomId && message.tick <= this.lastRoomTick) return;
          // Late snapshots from a room we explicitly left must not rejoin it.
          if (!this.membershipPending && !this.inRoom) return;
          this.lastRoomTick = message.tick;
          this.roomState = message;
          this.roomId = message.roomId;
          this.inRoom = true;
          this.membershipPending = false;
        }
        if (message.type === 'error' && this.membershipPending) {
          this.membershipPending = false;
          this.roomId = null;
          this.roomState = null;
          this.inRoom = false;
          this.lastRoomTick = -1;
        }
        for (const listener of [...this.listeners]) listener(message);
      } catch {
        // Invalid server data is ignored and cannot mutate the local game state.
      }
    };
    socket.onerror = () => this.scheduleReconnect();
    socket.onclose = () => this.scheduleReconnect();
  }

  join(roomId: string): boolean {
    const code = roomId.trim();
    if (!isRoomCode(code) || this.inRoom || this.membershipPending) return false;
    if (!this.send({ type: 'join-room', roomId: code })) return false;
    this.roomId = code;
    this.membershipPending = true;
    this.lastRoomTick = -1;
    return true;
  }

  createRoom(): boolean {
    if (this.inRoom || this.membershipPending || !this.send({ type: 'create-room' })) return false;
    this.membershipPending = true;
    this.lastRoomTick = -1;
    return true;
  }

  setReady(ready: boolean): boolean {
    return this.inRoom && this.send({ type: 'set-ready', ready });
  }

  startGame(): boolean {
    return this.inRoom && this.send({ type: 'start-game' });
  }

  finishGame(roundId: string): boolean {
    return this.inRoom && this.send({ type: 'finish-game', roundId });
  }

  leave(): boolean {
    this.roomId = null;
    this.roomState = null;
    this.inRoom = false;
    this.membershipPending = false;
    this.lastRoomTick = -1;
    return this.send({ type: 'leave-room' });
  }

  isInRoom(): boolean {
    return this.inRoom;
  }

  sendInput(
    movement: { readonly x: number; readonly y: number },
    aim: number,
    actions: readonly ('interact' | 'attack' | 'hug')[] = [],
  ): boolean {
    if (
      !this.inRoom ||
      !this.roomState?.started ||
      !this.roomState.roundId ||
      this.getLocalPlayer()?.finished ||
      !Number.isFinite(movement.x) ||
      !Number.isFinite(movement.y) ||
      !Number.isFinite(aim)
    )
      return false;
    const sent = this.send({
      type: 'player-input',
      sequence: this.sequence++,
      roundId: this.roomState.roundId,
      movement,
      aim,
      actions,
    });
    if (!sent) this.sequence = Math.max(0, this.sequence - 1);
    return sent;
  }

  ping(): boolean {
    return this.send({ type: 'ping', sentAt: this.now() });
  }

  close(): void {
    this.clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    this.playerId = null;
    this.setStatus('offline');
    socket?.close();
  }

  private send(message: ClientMessage): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(encodeClientMessage(message));
    return true;
  }

  private scheduleReconnect(): void {
    if (this.status === 'offline' || this.reconnectTimer !== null) return;
    this.setStatus('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.socket = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private setStatus(status: NetworkStatus): void {
    this.status = status;
    if (status !== 'connected') {
      this.inRoom = false;
      this.lastRoomTick = -1;
    }
    for (const listener of [...this.statusListeners]) listener(status);
  }
}

export type { PlayerSnapshot };
