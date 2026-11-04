export const NETWORK_PROTOCOL_VERSION = 1 as const;
export const ROOM_CAPACITY = 10;
export const isRoomCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9]{6}$/.test(value);

export interface NetworkPoint {
  readonly x: number;
  readonly y: number;
}

export interface PlayerSnapshot {
  readonly playerId: string;
  readonly displayName: string;
  readonly position: NetworkPoint;
  readonly aim: number;
  readonly health: number;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly finished: boolean;
}

export type ClientMessage =
  | {
      readonly type: 'hello';
      readonly protocol: typeof NETWORK_PROTOCOL_VERSION;
      readonly sessionId: string;
      readonly displayName: string;
    }
  | { readonly type: 'join-room'; readonly roomId: string }
  | { readonly type: 'create-room' }
  | { readonly type: 'set-ready'; readonly ready: boolean }
  | { readonly type: 'start-game' }
  | { readonly type: 'finish-game'; readonly roundId: string }
  | { readonly type: 'leave-room' }
  | {
      readonly type: 'player-input';
      readonly sequence: number;
      readonly roundId: string;
      readonly movement: NetworkPoint;
      readonly aim: number;
      readonly actions: readonly ('interact' | 'attack' | 'hug')[];
    }
  | { readonly type: 'ping'; readonly sentAt: number };

export type ServerMessage =
  | {
      readonly type: 'welcome';
      readonly protocol: typeof NETWORK_PROTOCOL_VERSION;
      readonly playerId: string;
      readonly serverTime: number;
    }
  | {
      readonly type: 'room-state';
      readonly roomId: string;
      readonly tick: number;
      readonly hostId: string;
      readonly maxPlayers: number;
      readonly started: boolean;
      readonly roundId: string | null;
      readonly players: readonly PlayerSnapshot[];
    }
  | { readonly type: 'player-left'; readonly playerId: string }
  | { readonly type: 'pong'; readonly sentAt: number; readonly serverTime: number }
  | { readonly type: 'error'; readonly code: string; readonly message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isPoint = (value: unknown): value is NetworkPoint =>
  isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || !nonEmpty(value.type)) return false;
  if (value.type === 'hello') {
    return (
      value.protocol === NETWORK_PROTOCOL_VERSION &&
      nonEmpty(value.sessionId) &&
      nonEmpty(value.displayName)
    );
  }
  if (value.type === 'join-room') return isRoomCode(value.roomId);
  if (value.type === 'create-room' || value.type === 'start-game') return true;
  if (value.type === 'set-ready') return typeof value.ready === 'boolean';
  if (value.type === 'finish-game') return nonEmpty(value.roundId);
  if (value.type === 'leave-room') return true;
  if (value.type === 'ping') return Number.isFinite(value.sentAt);
  return (
    value.type === 'player-input' &&
    nonEmpty(value.roundId) &&
    typeof value.sequence === 'number' &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    isPoint(value.movement) &&
    Number.isFinite(value.aim) &&
    Array.isArray(value.actions) &&
    value.actions.every(
      (action) => action === 'interact' || action === 'attack' || action === 'hug',
    )
  );
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || !nonEmpty(value.type)) return false;
  if (value.type === 'welcome') {
    return (
      value.protocol === NETWORK_PROTOCOL_VERSION &&
      nonEmpty(value.playerId) &&
      Number.isFinite(value.serverTime)
    );
  }
  if (value.type === 'player-left') return nonEmpty(value.playerId);
  if (value.type === 'pong')
    return Number.isFinite(value.sentAt) && Number.isFinite(value.serverTime);
  if (value.type === 'error') return nonEmpty(value.code) && nonEmpty(value.message);
  return (
    value.type === 'room-state' &&
    isRoomCode(value.roomId) &&
    Number.isSafeInteger(value.tick) &&
    nonEmpty(value.hostId) &&
    value.maxPlayers === ROOM_CAPACITY &&
    typeof value.started === 'boolean' &&
    (value.started ? nonEmpty(value.roundId) : value.roundId === null) &&
    Array.isArray(value.players) &&
    value.players.length <= ROOM_CAPACITY &&
    value.players.every(
      (player) =>
        isRecord(player) &&
        nonEmpty(player.playerId) &&
        nonEmpty(player.displayName) &&
        isPoint(player.position) &&
        Number.isFinite(player.aim) &&
        Number.isFinite(player.health) &&
        typeof player.connected === 'boolean' &&
        typeof player.ready === 'boolean' &&
        typeof player.finished === 'boolean',
    )
  );
}

export type RoomState = Extract<ServerMessage, { type: 'room-state' }>;

export function encodeClientMessage(message: ClientMessage): string {
  if (!isClientMessage(message)) throw new Error('Invalid client network message');
  return JSON.stringify(message);
}

export function decodeServerMessage(raw: string): ServerMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Malformed server network message');
  }
  if (!isServerMessage(value)) throw new Error('Invalid server network message');
  return value;
}
