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
    expect(isServerMessage({ type: 'room-state', roomId: 'r', tick: 1, players: [] })).toBe(true);
    expect(() => decodeServerMessage('{bad')).toThrow('Malformed');
    expect(() => decodeServerMessage(JSON.stringify({ type: 'unknown' }))).toThrow('Invalid');
  });
});
