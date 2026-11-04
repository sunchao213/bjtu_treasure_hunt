import {
  createRequestId,
  REALTIME_PROTOCOL_VERSION,
  type ClientMessage,
  type ConnectionState,
  type RoomSnapshot,
  type ServerMessage,
} from '../../shared/net/protocol';
import type { RealtimeTransport } from './realtime-transport';

export type RoomSessionState =
  'idle' | 'connecting' | 'connected' | 'in-room' | 'started' | 'closed' | 'error';

export class RoomSession {
  private sessionState: RoomSessionState = 'idle';
  private snapshotValue: RoomSnapshot | null = null;
  private playerIdValue: string | null = null;
  private raidIdValue: string | null = null;
  private lastError: string | null = null;
  private readonly stateListeners = new Set<() => void>();
  private readonly disposeMessage: () => void;
  private readonly disposeTransport: () => void;

  constructor(private readonly transport: RealtimeTransport) {
    this.disposeMessage = transport.onMessage((message) => this.handle(message));
    this.disposeTransport = transport.onStateChange((state) => this.handleTransportState(state));
  }

  get state(): RoomSessionState {
    return this.sessionState;
  }
  get snapshot(): RoomSnapshot | null {
    return this.snapshotValue ? structuredClone(this.snapshotValue) : null;
  }
  get playerId(): string | null {
    return this.playerIdValue;
  }
  get raidId(): string | null {
    return this.raidIdValue;
  }
  get error(): string | null {
    return this.lastError;
  }

  subscribe(listener: () => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  async connect(): Promise<void> {
    this.sessionState = 'connecting';
    this.notify();
    try {
      await this.transport.connect();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : '联机连接失败。');
      throw error;
    }
  }

  createRoom(displayName: string, roomId: string): void {
    this.send({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'room.create',
      displayName,
      maxPlayers: 4,
      roomId,
      requestId: createRequestId('create'),
    });
  }

  joinRoom(displayName: string, roomId: string): void {
    this.send({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'room.join',
      displayName,
      roomId,
      requestId: createRequestId('join'),
    });
  }

  setReady(ready: boolean): void {
    this.send({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'room.ready',
      ready,
      roomId: this.requiredRoomId(),
      requestId: createRequestId('ready'),
    });
  }

  startRoom(): void {
    this.send({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'room.start',
      roomId: this.requiredRoomId(),
      requestId: createRequestId('start'),
    });
  }

  leaveRoom(): void {
    if (!this.snapshotValue) return;
    this.send({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'room.leave',
      roomId: this.snapshotValue.roomId,
      requestId: createRequestId('leave'),
    });
    this.snapshotValue = null;
    this.raidIdValue = null;
    this.sessionState = 'connected';
    this.notify();
  }

  close(): void {
    this.disposeMessage();
    this.disposeTransport();
    this.transport.close();
    this.sessionState = 'closed';
    this.notify();
  }

  private send(message: ClientMessage): void {
    if (this.transport.state !== 'open') {
      this.fail('联机通道尚未连接。');
      return;
    }
    try {
      this.transport.send(message);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : '联机操作失败。');
    }
  }

  private requiredRoomId(): string {
    if (!this.snapshotValue) throw new Error('当前不在房间中。');
    return this.snapshotValue.roomId;
  }

  private handle(message: ServerMessage): void {
    if (message.type === 'connection.ready') {
      this.playerIdValue = message.playerId;
      this.sessionState = 'connected';
    } else if (message.type === 'room.snapshot') {
      this.snapshotValue = message.snapshot;
      this.sessionState = 'in-room';
      this.lastError = null;
    } else if (message.type === 'room.started') {
      this.snapshotValue = message.snapshot;
      this.raidIdValue = message.raidId;
      this.sessionState = 'started';
    } else if (message.type === 'error') {
      this.fail(message.message);
    }
    this.notify();
  }

  private handleTransportState(state: ConnectionState): void {
    if (state === 'reconnecting') this.sessionState = 'connecting';
    if (state === 'closed') this.sessionState = 'closed';
    if (state === 'error') this.fail('联机连接异常，正在尝试重连。');
    this.notify();
  }

  private fail(message: string): void {
    this.lastError = message;
    this.sessionState = 'error';
    this.notify();
  }

  private notify(): void {
    for (const listener of this.stateListeners) listener();
  }
}
