import { describe, expect, it } from 'vitest';
import { NetworkSession, type NetworkSocket } from '../../src/modules/network/network-session';

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
    expect(session.join('room-a')).toBe(true);
    expect(session.sendInput({ x: 1, y: 0 }, 0.5, ['interact'])).toBe(true);
    expect(socket.sent.map((entry) => JSON.parse(entry).type)).toEqual([
      'hello',
      'join-room',
      'player-input',
    ]);
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
