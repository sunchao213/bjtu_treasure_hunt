export const REALTIME_PROTOCOL_VERSION = 1 as const;

export type RoomStatus = 'lobby' | 'starting' | 'playing' | 'settling' | 'closed';

export type ConnectionState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface RoomMember {
  readonly playerId: string;
  readonly displayName: string;
  readonly ready: boolean;
  readonly connected: boolean;
}

export interface RoomSnapshot {
  readonly roomId: string;
  readonly hostId: string;
  readonly status: RoomStatus;
  readonly maxPlayers: number;
  readonly members: readonly RoomMember[];
  readonly serverTick: number;
}

export interface PlayerInput {
  readonly moveX: number;
  readonly moveY: number;
  readonly aimX: number;
  readonly aimY: number;
  readonly interact: boolean;
  readonly attack: boolean;
  readonly hug: boolean;
  readonly flashlight: boolean;
  readonly refill: boolean;
  readonly flare: boolean;
}

export interface RemotePlayerSnapshot {
  readonly playerId: string;
  readonly displayName: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly connected: boolean;
  readonly action: 'idle' | 'moving' | 'attacking' | 'hurt' | 'downed' | 'extracting';
}

export interface LocalPlayerSnapshot {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly value: number;
  readonly threshold: number;
  readonly remainingMs: number;
  readonly inExtractionZone: boolean;
  readonly extractionProgress: number;
  readonly phase: 'active' | 'extracting' | 'settling' | 'success' | 'failed';
  readonly carriedItems: readonly import('../types/game').ItemInstance[];
  readonly result?: import('../types/game').RaidResult | null;
}

export interface EnemySnapshot {
  readonly enemyId: string;
  readonly x: number;
  readonly y: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly state: string;
}

export interface LootSnapshot {
  readonly instanceId: string;
  readonly itemId: string;
  readonly x: number;
  readonly y: number;
  readonly visibleToPlayer: boolean;
}

export interface GameSnapshot {
  readonly roomId: string;
  readonly raidId: string;
  readonly serverTick: number;
  readonly ackInputSeq: number;
  readonly phase: LocalPlayerSnapshot['phase'];
  readonly remainingMs: number;
  readonly self: LocalPlayerSnapshot;
  readonly players: readonly RemotePlayerSnapshot[];
  readonly enemies: readonly EnemySnapshot[];
  readonly loot: readonly LootSnapshot[];
}

export type GameEventKind =
  | 'damage-taken'
  | 'enemy-defeated'
  | 'loot-picked'
  | 'search-started'
  | 'search-completed'
  | 'extraction-started'
  | 'extraction-cancelled'
  | 'raid-settled';

export interface GameEvent {
  readonly eventId: string;
  readonly serverTick: number;
  readonly kind: GameEventKind;
  readonly playerId?: string;
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
}

interface ClientMessageBase {
  readonly version: typeof REALTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly roomId: string | null;
}

export type ClientMessage =
  | (ClientMessageBase & {
      readonly type: 'room.create';
      readonly displayName: string;
      readonly maxPlayers?: number;
    })
  | (ClientMessageBase & {
      readonly type: 'room.join';
      readonly displayName: string;
    })
  | (ClientMessageBase & { readonly type: 'room.ready'; readonly ready: boolean })
  | (ClientMessageBase & { readonly type: 'room.start' })
  | (ClientMessageBase & { readonly type: 'room.leave' })
  | (ClientMessageBase & {
      readonly type: 'session.resume';
      readonly raidId: string;
      readonly reconnectToken: string;
    })
  | (ClientMessageBase & {
      readonly type: 'raid.action';
      readonly action:
        | 'start'
        | 'start-extraction'
        | 'abandon'
        | 'prepare-next'
        | 'retry-settlement'
        | 'drop-item'
        | 'use-item';
      readonly instanceId?: string;
    })
  | (ClientMessageBase & {
      readonly type: 'input';
      readonly inputSeq: number;
      readonly clientTick: number;
      readonly input: PlayerInput;
    });

export type ServerMessage =
  | {
      readonly version: typeof REALTIME_PROTOCOL_VERSION;
      readonly type: 'connection.ready';
      readonly playerId: string;
      readonly serverTick: number;
      readonly reconnectToken?: string;
    }
  | {
      readonly version: typeof REALTIME_PROTOCOL_VERSION;
      readonly type: 'room.snapshot';
      readonly requestId?: string;
      readonly snapshot: RoomSnapshot;
    }
  | {
      readonly version: typeof REALTIME_PROTOCOL_VERSION;
      readonly type: 'room.started';
      readonly requestId?: string;
      readonly snapshot: RoomSnapshot;
      readonly raidId: string;
    }
  | {
      readonly version: typeof REALTIME_PROTOCOL_VERSION;
      readonly type: 'game.snapshot';
      readonly snapshot: GameSnapshot;
    }
  | {
      readonly version: typeof REALTIME_PROTOCOL_VERSION;
      readonly type: 'game.event';
      readonly event: GameEvent;
    }
  | {
      readonly version: typeof REALTIME_PROTOCOL_VERSION;
      readonly type: 'session.resumed';
      readonly roomId: string;
      readonly raidId: string;
      readonly snapshot: GameSnapshot;
    }
  | {
      readonly version: typeof REALTIME_PROTOCOL_VERSION;
      readonly type: 'request.ack';
      readonly requestId: string;
      readonly serverTick: number;
      readonly inputSeq?: number;
    }
  | {
      readonly version: typeof REALTIME_PROTOCOL_VERSION;
      readonly type: 'error';
      readonly requestId?: string;
      readonly code:
        | 'INVALID_MESSAGE'
        | 'ROOM_NOT_FOUND'
        | 'ROOM_FULL'
        | 'ROOM_STARTED'
        | 'NOT_HOST'
        | 'INVALID_STATE'
        | 'CONNECTION_LOST';
      readonly message: string;
    };

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as { version?: unknown; type?: unknown };
  return message.version === REALTIME_PROTOCOL_VERSION && typeof message.type === 'string';
}

export function createRequestId(prefix = 'req'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
