import {
  REALTIME_PROTOCOL_VERSION,
  createRequestId,
  type ConnectionState,
  type GameEvent,
  type GameSnapshot,
  type PlayerInput,
  type ServerMessage,
} from '../../shared/net/protocol';
import type { RealtimeTransport } from './realtime-transport';

export type GameSessionState =
  'idle' | 'playing' | 'reconnecting' | 'settling' | 'finished' | 'error';

export interface GameSessionCallbacks {
  readonly onSnapshot?: (snapshot: GameSnapshot) => void;
  readonly onEvent?: (event: GameEvent) => void;
  readonly onNotice?: (message: string) => void;
  readonly onStateChange?: (state: GameSessionState) => void;
}

const EMPTY_INPUT: PlayerInput = {
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: -1,
  interact: false,
  attack: false,
  hug: false,
  flashlight: false,
  refill: false,
  flare: false,
};

/** Client-only session: sends intent and consumes authoritative snapshots/events. */
export class GameSession {
  private sessionState: GameSessionState = 'idle';
  private roomIdValue: string | null = null;
  private raidIdValue: string | null = null;
  private reconnectTokenValue: string | null = null;
  private latestSnapshotValue: GameSnapshot | null = null;
  private inputSeq = 0;
  private lastAckInputSeq = 0;
  private lastInputSentAt = -Infinity;
  private lastInputSignature = '';
  private lastSentInputSeq = 0;
  private readonly seenEventIds = new Set<string>();
  private readonly disposeMessage: () => void;
  private readonly disposeTransport: () => void;

  constructor(
    private readonly transport: RealtimeTransport,
    private readonly callbacks: GameSessionCallbacks = {},
  ) {
    this.disposeMessage = transport.onMessage((message) => this.handleMessage(message));
    this.disposeTransport = transport.onStateChange((state) => this.handleTransportState(state));
  }

  get state(): GameSessionState {
    return this.sessionState;
  }
  get roomId(): string | null {
    return this.roomIdValue;
  }
  get raidId(): string | null {
    return this.raidIdValue;
  }
  get latestSnapshot(): GameSnapshot | null {
    return this.latestSnapshotValue ? structuredClone(this.latestSnapshotValue) : null;
  }
  get lastAckInputSeqValue(): number {
    return this.lastAckInputSeq;
  }

  get reconnectToken(): string | null {
    return this.reconnectTokenValue;
  }

  setContext(roomId: string | null, raidId: string | null): void {
    this.roomIdValue = roomId;
    this.raidIdValue = raidId;
    if (raidId) this.setState('playing');
  }

  sendInput(input: Partial<PlayerInput>): number | null {
    if (!this.roomIdValue || !this.raidIdValue || this.transport.state !== 'open') return null;
    const normalized: PlayerInput = { ...EMPTY_INPUT, ...input };
    const signature = JSON.stringify(normalized);
    const now = performance.now();
    if (now - this.lastInputSentAt < 50 && signature === this.lastInputSignature) {
      return this.lastSentInputSeq;
    }
    const inputSeq = ++this.inputSeq;
    try {
      this.transport.send({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'input',
        roomId: this.roomIdValue,
        requestId: createRequestId('input'),
        inputSeq,
        clientTick: Math.round(now),
        input: normalized,
      });
      this.lastInputSentAt = now;
      this.lastInputSignature = signature;
      this.lastSentInputSeq = inputSeq;
      return inputSeq;
    } catch {
      this.callbacks.onNotice?.('联机通道暂时不可用，正在等待重连。');
      return null;
    }
  }

  resume(): void {
    if (!this.roomIdValue || !this.raidIdValue || !this.reconnectTokenValue) return;
    try {
      this.transport.send({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'session.resume',
        roomId: this.roomIdValue,
        raidId: this.raidIdValue,
        reconnectToken: this.reconnectTokenValue,
        requestId: createRequestId('resume'),
      });
    } catch {
      this.callbacks.onNotice?.('重连状态尚未恢复，请稍候。');
    }
  }

  requestAction(
    action:
      | 'start'
      | 'start-extraction'
      | 'abandon'
      | 'prepare-next'
      | 'retry-settlement'
      | 'drop-item'
      | 'use-item',
    instanceId?: string,
  ): boolean {
    if (!this.roomIdValue || !this.raidIdValue || this.transport.state !== 'open') return false;
    try {
      this.transport.send({
        version: REALTIME_PROTOCOL_VERSION,
        type: 'raid.action',
        roomId: this.roomIdValue,
        requestId: createRequestId(`raid-${action}`),
        action,
        ...(instanceId ? { instanceId } : {}),
      });
      return true;
    } catch {
      this.callbacks.onNotice?.('联机操作未发送，正在等待重连。');
      return false;
    }
  }

  close(): void {
    this.disposeMessage();
    this.disposeTransport();
    this.setState('finished');
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === 'connection.ready') {
      this.reconnectTokenValue = message.reconnectToken ?? this.reconnectTokenValue;
      return;
    }
    if (message.type === 'game.snapshot') {
      this.roomIdValue = message.snapshot.roomId;
      this.raidIdValue = message.snapshot.raidId;
      this.latestSnapshotValue = structuredClone(message.snapshot);
      this.lastAckInputSeq = Math.max(this.lastAckInputSeq, message.snapshot.ackInputSeq);
      this.setState(
        message.snapshot.phase === 'settling'
          ? 'settling'
          : message.snapshot.phase === 'success' || message.snapshot.phase === 'failed'
            ? 'finished'
            : 'playing',
      );
      this.callbacks.onSnapshot?.(structuredClone(message.snapshot));
      return;
    }
    if (message.type === 'session.resumed') {
      this.roomIdValue = message.roomId;
      this.raidIdValue = message.raidId;
      this.latestSnapshotValue = structuredClone(message.snapshot);
      this.lastAckInputSeq = Math.max(this.lastAckInputSeq, message.snapshot.ackInputSeq);
      this.setState('playing');
      this.callbacks.onNotice?.('已恢复本局状态。');
      this.callbacks.onSnapshot?.(structuredClone(message.snapshot));
      return;
    }
    if (message.type === 'game.event') {
      if (this.seenEventIds.has(message.event.eventId)) return;
      this.seenEventIds.add(message.event.eventId);
      this.callbacks.onEvent?.(structuredClone(message.event));
      return;
    }
    if (message.type === 'request.ack') {
      if (message.inputSeq !== undefined) {
        this.lastAckInputSeq = Math.max(this.lastAckInputSeq, message.inputSeq);
      }
    }
    if (message.type === 'error') {
      this.setState('error');
      this.callbacks.onNotice?.(message.message);
    }
  }

  private handleTransportState(state: ConnectionState): void {
    if (state === 'reconnecting') {
      this.setState('reconnecting');
      this.callbacks.onNotice?.('连接已断开，正在重连；本地输入暂不提交。');
    } else if (state === 'open' && this.raidIdValue) {
      this.setState('playing');
      this.resume();
    } else if (state === 'closed') {
      this.setState('finished');
    }
  }

  private setState(state: GameSessionState): void {
    if (this.sessionState === state) return;
    this.sessionState = state;
    this.callbacks.onStateChange?.(state);
  }
}
