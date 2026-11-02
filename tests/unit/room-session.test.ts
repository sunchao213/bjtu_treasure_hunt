import { describe, expect, it } from 'vitest';
import {
  REALTIME_PROTOCOL_VERSION,
  type ClientMessage,
  type ConnectionState,
  type ServerMessage,
} from '../../src/shared/net/protocol';
import { RoomSession } from '../../src/modules/network/room-session';
import type { RealtimeTransport } from '../../src/modules/network/realtime-transport';

class TestTransport implements RealtimeTransport {
  state: ConnectionState = 'idle';
  sent: ClientMessage[] = [];
  private readonly messageListeners = new Set<(message: ServerMessage) => void>();
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();

  async connect(): Promise<void> {
    this.state = 'open';
    for (const listener of this.stateListeners) listener('open');
    this.emit({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'connection.ready',
      playerId: 'player-a',
      serverTick: 1,
    });
  }

  send(message: ClientMessage): void {
    this.sent.push(message);
  }

  close(): void {
    this.state = 'closed';
  }

  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  emit(message: ServerMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

describe('RoomSession', () => {
  it('connects, creates a room, and exposes an immutable snapshot', async () => {
    const transport = new TestTransport();
    const session = new RoomSession(transport);
    await session.connect();

    expect(session.state).toBe('connected');
    expect(session.playerId).toBe('player-a');
    session.createRoom('甲', 'BJTU-1234');
    expect(transport.sent[0]).toMatchObject({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'room.create',
      roomId: 'BJTU-1234',
      displayName: '甲',
    });

    transport.emit({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'room.snapshot',
      snapshot: {
        roomId: 'BJTU-1234',
        hostId: 'player-a',
        status: 'lobby',
        maxPlayers: 4,
        serverTick: 10,
        members: [{ playerId: 'player-a', displayName: '甲', ready: false, connected: true }],
      },
    });
    const snapshot = session.snapshot;
    expect(session.state).toBe('in-room');
    expect(snapshot?.roomId).toBe('BJTU-1234');
    if (snapshot) {
      (
        snapshot.members as Array<{
          playerId: string;
          displayName: string;
          ready: boolean;
          connected: boolean;
        }>
      ).push({
        playerId: 'x',
        displayName: 'x',
        ready: false,
        connected: true,
      });
    }
    expect(session.snapshot?.members).toHaveLength(1);
  });

  it('sends ready and start requests using the active room', async () => {
    const transport = new TestTransport();
    const session = new RoomSession(transport);
    await session.connect();
    transport.emit({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'room.snapshot',
      snapshot: {
        roomId: 'BJTU-1234',
        hostId: 'player-a',
        status: 'lobby',
        maxPlayers: 4,
        serverTick: 10,
        members: [{ playerId: 'player-a', displayName: '甲', ready: false, connected: true }],
      },
    });
    session.setReady(true);
    session.startRoom();
    expect(transport.sent.map((message) => message.type)).toEqual(['room.ready', 'room.start']);
    expect(transport.sent.every((message) => message.version === REALTIME_PROTOCOL_VERSION)).toBe(
      true,
    );
  });

  it('surfaces server errors without mutating the last room snapshot', async () => {
    const transport = new TestTransport();
    const session = new RoomSession(transport);
    await session.connect();
    transport.emit({
      version: REALTIME_PROTOCOL_VERSION,
      type: 'error',
      code: 'ROOM_FULL',
      message: '房间已满。',
    });
    expect(session.state).toBe('error');
    expect(session.error).toBe('房间已满。');
    expect(session.snapshot).toBeNull();
  });
});
