import { describe, expect, it } from 'vitest';
import {
  decodeServerMessage,
  encodeClientMessage,
  isClientMessage,
  isServerMessage,
  NETWORK_PROTOCOL_VERSION,
} from '../../src/modules/network/network-protocol';

describe('online protocol boundary', () => {
  it('accepts versioned hello and input messages', () => {
    const hello = {
      type: 'hello' as const,
      protocol: NETWORK_PROTOCOL_VERSION,
      sessionId: 'session-1',
      displayName: '玩家',
    };
    expect(isClientMessage(hello)).toBe(true);
    expect(JSON.parse(encodeClientMessage(hello))).toEqual(hello);
    expect(
      isClientMessage({
        type: 'player-input',
        sequence: 1,
        roundId: 'shared-round',
        movement: { x: 1, y: 0 },
        aim: 0,
        actions: ['attack'],
      }),
    ).toBe(true);
  });

  it('rejects malformed or unsupported messages', () => {
    expect(isClientMessage({ type: 'hello', protocol: 2, sessionId: 'x', displayName: 'x' })).toBe(
      false,
    );
    expect(
      isClientMessage({
        type: 'player-input',
        sequence: -1,
        movement: { x: 0, y: 0 },
        aim: 0,
        actions: [],
      }),
    ).toBe(false);
    expect(
      isServerMessage({
        type: 'room-state',
        roomId: '123456',
        tick: 1,
        hostId: 'p1',
        maxPlayers: 10,
        started: false,
        roundId: null,
        players: [],
      }),
    ).toBe(true);
    expect(() => decodeServerMessage('{bad')).toThrow('Malformed');
    expect(() => decodeServerMessage(JSON.stringify({ type: 'unknown' }))).toThrow('Invalid');
  });

  it('requires six digit room codes and explicit room creation', () => {
    expect(isClientMessage({ type: 'create-room' })).toBe(true);
    expect(isClientMessage({ type: 'join-room', roomId: '123456' })).toBe(true);
    for (const roomId of ['room-a', '12345', '1234567', '１２３４５６', ' 123456']) {
      expect(isClientMessage({ type: 'join-room', roomId })).toBe(false);
    }
    expect(isClientMessage({ type: 'set-ready', ready: true })).toBe(true);
    expect(isClientMessage({ type: 'set-ready', ready: 'true' })).toBe(false);
    expect(isClientMessage({ type: 'start-game' })).toBe(true);
  });
});
