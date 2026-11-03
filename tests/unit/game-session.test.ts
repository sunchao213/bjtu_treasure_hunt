import { describe, expect, it } from 'vitest';
import {
  REALTIME_PROTOCOL_VERSION,
  type ClientMessage,
  type ConnectionState,
  type ServerMessage,
} from '../../src/shared/net/protocol';
import { GameSession } from '../../src/modules/network/game-session';
import type { RealtimeTransport } from '../../src/modules/network/realtime-transport';

class TestTransport implements RealtimeTransport {
  state: ConnectionState = 'open';
  sent: ClientMessage[] = [];
  private readonly messages = new Set<(message: ServerMessage) => void>();
  private readonly states = new Set<(state: ConnectionState) => void>();

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(message: ClientMessage): void {
    this.sent.push(message);
  }

  close(): void {
    this.state = 'closed';
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.states.add(listener);
    return () => this.states.delete(listener);
  }

  emit(message: ServerMessage): void {
    for (const listener of this.messages) listener(message);
  }

  emitState(state: ConnectionState): void {
    this.state = state;
    for (const listener of this.states) listener(state);
  }
}

const snapshot = {
  roomId: 'BJTU-1234',
  raidId: 'raid-1',
  serverTick: 10,
  ackInputSeq: 3,
  phase: 'active' as const,
  remainingMs: 500_000,
  self: {
    playerId: 'player-a',
    x: 100,
    y: 120,
    health: 100,
    maxHealth: 100,
    value: 0,
    threshold: 100,
    remainingMs: 500_000,
    inExtractionZone: false,
    extractionProgress: 0,
    phase: 'active' as const,
    carriedItems: [],
    result: null,
  },
  players: [
    {
      playerId: 'player-a',
      displayName: '甲',
      x: 100,
      y: 120,
      health: 100,
      maxHealth: 100,
      connected: true,
      action: 'moving' as const,
    },
  ],
  enemies: [],
  loot: [],
};

describe('GameSession', () => {
  it('sends sequenced intent at a bounded rate and consumes authoritative snapshots', () => {
    const transport = new TestTransport();
    const snapshots: number[] = [];
    const session = new GameSession(transport, {
      onSnapshot: (value) => snapshots.push(value.serverTick),
    });
    session.setContext('BJTU-1234', 'raid-1');

    expect(session.sendInput({ moveX: 1 })).toBe(1);
    expect(session.sendInput({ moveX: 1 })).toBe(1);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'input',
      inputSeq: 1,
      roomId: 'BJTU-1234',
      input: { moveX: 1, moveY: 0 },
    });

    transport.emit({ version: REALTIME_PROTOCOL_VERSION, type: 'game.snapshot', snapshot });
    expect(session.state).toBe('playing');
    expect(session.latestSnapshot?.ackInputSeq).toBe(3);
    expect(snapshots).toEqual([10]);
  });

  it('deduplicates authoritative events and resumes after reconnect', () => {
    const transport = new TestTransport();
    const events: string[] = [];
    const session = new GameSession(transport, { onEvent: (event) => events.push(event.eventId) });
    session.setContext('BJTU-1234', 'raid-1');
    transport.emit({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'connection.ready',
      playerId: 'player-a',
      serverTick: 12,
      reconnectToken: 'token-1',
    });
    transport.emit({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'game.event',
      event: { eventId: 'evt-1', serverTick: 13, kind: 'loot-picked', payload: {} },
    });
    transport.emit({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'game.event',
      event: { eventId: 'evt-1', serverTick: 13, kind: 'loot-picked', payload: {} },
    });
    expect(events).toEqual(['evt-1']);

    transport.emitState('reconnecting');
    transport.emitState('open');
    expect(transport.sent.at(-1)).toMatchObject({
      type: 'session.resume',
      reconnectToken: 'token-1',
      raidId: 'raid-1',
    });
  });
});
