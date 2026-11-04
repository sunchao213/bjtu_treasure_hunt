import { describe, expect, it } from 'vitest';
import { NetworkSession, type NetworkSocket } from '../../src/modules/network/network-session';

const roomState = (tick = 1, started = false) =>
  JSON.stringify({
    type: 'room-state',
    roomId: '123456',
    tick,
    hostId: 'p1',
    maxPlayers: 10,
    started,
    roundId: started ? 'shared-round' : null,
    players: [
      {
        playerId: 'p1',
        displayName: '注册昵称',
        position: { x: 1, y: 2 },
        aim: 0,
        health: 100,
        connected: true,
        ready: false,
        finished: false,
      },
    ],
  });

class FakeSocket implements NetworkSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  readonly sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(data: string): void {
    this.onmessage?.({ data });
  }
}

describe('network session transport', () => {
  it('sends hello, joins a room and publishes local input', () => {
    const socket = new FakeSocket();
    const session = new NetworkSession({
      url: 'wss://example.test',
      sessionId: 'session',
      displayName: '玩家',
      socketFactory: () => socket,
    });
    session.connect();
    expect(session.getStatus()).toBe('connecting');
    socket.open();
    expect(session.getStatus()).toBe('connected');
    expect(session.join('123456')).toBe(true);
    expect(session.isInRoom()).toBe(false);
    expect(session.sendInput({ x: 1, y: 0 }, 0.5, ['interact'])).toBe(false);
    socket.message(roomState());
    expect(session.sendInput({ x: 1, y: 0 }, 0.5, ['interact'])).toBe(false);
    socket.message(roomState(2, true));
    expect(session.sendInput({ x: 1, y: 0 }, 0.5, ['interact'])).toBe(true);
    expect(JSON.parse(socket.sent.at(-1)!)).toMatchObject({ roundId: 'shared-round' });
    expect(session.getLocalPlayer()).toBeUndefined();
    expect(socket.sent.map((entry) => JSON.parse(entry).type)).toEqual([
      'hello',
      'join-room',
      'player-input',
    ]);
  });

  it('retains shared round and local server coordinates and rejects other-room snapshots', () => {
    const socket = new FakeSocket();
    const session = new NetworkSession({
      url: 'wss://example.test',
      sessionId: 's',
      displayName: '注册昵称',
      socketFactory: () => socket,
    });
    session.connect();
    socket.open();
    socket.message(
      JSON.stringify({ type: 'welcome', protocol: 1, playerId: 'p1', serverTime: 10 }),
    );
    session.createRoom();
    socket.message(roomState(1, true));
    expect(session.getLocalPlayer()?.position).toEqual({ x: 1, y: 2 });
    expect(session.getRoomState()?.roundId).toBe('shared-round');
    socket.message(JSON.stringify({ ...JSON.parse(roomState(10, true)), roomId: '654321' }));
    expect(session.getRoomState()?.roomId).toBe('123456');
    session.leave();
    expect(session.getRoomState()).toBeNull();
  });

  it('keeps failed joins outside the room and allows creating a new room', () => {
    const socket = new FakeSocket();
    const session = new NetworkSession({
      url: 'wss://example.test',
      sessionId: 's',
      displayName: '注册昵称',
      socketFactory: () => socket,
    });
    session.connect();
    socket.open();
    expect(session.join('room-a')).toBe(false);
    expect(session.join('123456')).toBe(true);
    socket.message(JSON.stringify({ type: 'error', code: 'ROOM_FULL', message: '房间已满' }));
    expect(session.isInRoom()).toBe(false);
    expect(session.createRoom()).toBe(true);
    socket.message(roomState());
    expect(session.isInRoom()).toBe(true);
    expect(session.setReady(true)).toBe(true);
    expect(session.startGame()).toBe(true);
  });

  it('ignores old snapshots and snapshots received after explicitly leaving', () => {
    const socket = new FakeSocket();
    const session = new NetworkSession({
      url: 'wss://example.test',
      sessionId: 's',
      displayName: '注册昵称',
      socketFactory: () => socket,
    });
    const ticks: number[] = [];
    session.onMessage((message) => {
      if (message.type === 'room-state') ticks.push(message.tick);
    });
    session.connect();
    socket.open();
    session.createRoom();
    socket.message(roomState(2));
    socket.message(roomState(1));
    session.leave();
    socket.message(roomState(3));
    expect(ticks).toEqual([2]);
    expect(session.isInRoom()).toBe(false);
  });

  it('ignores invalid server payloads and exposes validated state', () => {
    const socket = new FakeSocket();
    const messages: string[] = [];
    const session = new NetworkSession({
      url: 'wss://example.test',
      sessionId: 's',
      displayName: 'p',
      socketFactory: () => socket,
    });
    session.onMessage((message) => messages.push(message.type));
    session.connect();
    socket.open();
    socket.message(
      JSON.stringify({ type: 'welcome', protocol: 1, playerId: 'p1', serverTime: 10 }),
    );
    socket.message(JSON.stringify({ type: 'unknown' }));
    expect(session.getPlayerId()).toBe('p1');
    expect(messages).toEqual(['welcome']);
  });
});
