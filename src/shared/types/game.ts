export type Rarity = 'common' | 'uncommon' | 'epic' | 'legendary';

export interface ItemDefinition {
  readonly itemId: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly kind: 'collectible' | 'healing' | 'quest' | 'weapon';
}

export type ItemOrigin =
  { readonly kind: 'carry-in' } | { readonly kind: 'raid-loot'; readonly obtainedInRaidId: string };

export interface ItemInstance {
  readonly instanceId: string;
  readonly itemId: string;
  readonly origin: ItemOrigin;
}

export interface RaidRules {
  readonly threshold: number;
  readonly durationMs: number;
  readonly extractionDurationMs: number;
  readonly searchDurationMs: number;
  readonly maxHealth: number;
  readonly bagCapacity: number;
  readonly values: Readonly<Record<Rarity, number>>;
}

export type RaidPhase = 'preparing' | 'active' | 'extracting' | 'settling' | 'success' | 'failed';
export type FailureReason = 'death' | 'timeout' | 'abandoned' | 'interrupted';
export type ErrorCode =
  | 'VALUE_TOO_LOW'
  | 'NOT_IN_RANGE'
  | 'INVALID_STATE'
  | 'INVENTORY_FULL'
  | 'ITEM_NOT_FOUND'
  | 'INVALID_ITEM'
  | 'SAVE_FAILED';
export type ActionResult<T = undefined> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ErrorCode };

export interface RaidResult {
  readonly raidId: string;
  readonly outcome: 'success' | 'failed';
  readonly reason: FailureReason | null;
  readonly items: readonly ItemInstance[];
  readonly value: number;
  readonly questComplete?: boolean;
}

export interface RaidView {
  readonly raidId: string | null;
  readonly phase: RaidPhase;
  readonly health: number;
  readonly remainingMs: number;
  readonly value: number;
  readonly threshold: number;
  readonly inExtractionZone: boolean;
  readonly extractionProgress: number;
  readonly isBusy: boolean;
  readonly saveError: boolean;
  readonly result: RaidResult | null;
}

/** B replaces the reference inventory behind this port; never expose mutable arrays. */
export interface InventoryPort {
  begin(raidId: string, loadout: readonly ItemInstance[]): void;
  getCarriedItems(): readonly ItemInstance[];
  addLoot(item: ItemInstance): ActionResult;
  remove(instanceId: string): ActionResult<ItemInstance>;
  clear(): void;
}

/** Persist begin before play, and acknowledge settlement before reporting success. */
export interface SavePort {
  beginRaid(raidId: string, loadoutIds: readonly string[]): Promise<readonly ItemInstance[]>;
  finalizeRaid(result: RaidResult): Promise<void>;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Rect extends Point {
  readonly width: number;
  readonly height: number;
}
