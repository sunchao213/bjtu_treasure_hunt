import { ITEM_DEFINITIONS, RAID_RULES } from '../../config/game-config';
import type { ItemInstance, RaidResult, SavePort } from '../../shared/types/game';
import { SAVE_KEY, type SaveData, type StoragePort } from './reference-save';
import { chapterUnlockGranted, QUEST_CHAPTER_ID } from '../quests/quest-service';

// Keep the storage key stable so existing browsers can migrate in place.
export const FORMAL_SAVE_KEY = 'bjtu-treasure-hunt:save:v2';
export const FORMAL_SCHEMA_VERSION = 3 as const;

export interface FormalSaveData {
  schemaVersion: typeof FORMAL_SCHEMA_VERSION;
  warehouse: ItemInstance[];
  codexIds: string[];
  unlockedChapterIds: string[];
  activeRaid: { raidId: string; loadout: ItemInstance[] } | null;
  settledRaidIds: string[];
  lastResult: RaidResult | null;
}

type PreviousSaveData = Omit<FormalSaveData, 'schemaVersion' | 'activeRaid'> & {
  schemaVersion: 1 | 2;
  activeRaid: { raidId: string } | null;
};

export type SaveImportResult = {
  readonly sourceSchemaVersion: number;
  readonly targetSchemaVersion: typeof FORMAL_SCHEMA_VERSION;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
const uniqueStrings = (value: unknown): value is string[] =>
  strings(value) && new Set(value).size === value.length;
const failureReasons = new Set(['death', 'timeout', 'abandoned', 'interrupted']);

function validItem(value: unknown): value is ItemInstance {
  if (
    !record(value) ||
    typeof value.instanceId !== 'string' ||
    !value.instanceId ||
    typeof value.itemId !== 'string' ||
    !ITEM_DEFINITIONS[value.itemId] ||
    !record(value.origin)
  ) {
    return false;
  }
  return (
    value.origin.kind === 'carry-in' ||
    (value.origin.kind === 'raid-loot' &&
      typeof value.origin.obtainedInRaidId === 'string' &&
      value.origin.obtainedInRaidId.length > 0)
  );
}

function validResult(value: unknown): value is RaidResult {
  if (!record(value) || typeof value.raidId !== 'string' || !value.raidId) {
    return false;
  }
  const validOutcome =
    (value.outcome === 'success' && value.reason === null) ||
    (value.outcome === 'failed' &&
      typeof value.reason === 'string' &&
      failureReasons.has(value.reason));
  return (
    validOutcome &&
    Array.isArray(value.items) &&
    value.items.every(validItem) &&
    typeof value.value === 'number' &&
    Number.isSafeInteger(value.value) &&
    value.value >= 0 &&
    (value.questComplete === undefined || typeof value.questComplete === 'boolean')
  );
}

function validSettlementResult(result: RaidResult, loadout: readonly ItemInstance[]): boolean {
  if (!validResult(result)) {
    return false;
  }
  const ids = new Set(result.items.map((item) => item.instanceId));
  if (ids.size !== result.items.length) {
    return false;
  }
  if (result.outcome === 'failed') {
    return result.items.length === 0;
  }
  return result.items.every((item) =>
    item.origin.kind === 'carry-in'
      ? loadout.some(
          (entry) => entry.instanceId === item.instanceId && entry.itemId === item.itemId,
        )
      : item.origin.obtainedInRaidId === result.raidId &&
        !loadout.some((entry) => entry.instanceId === item.instanceId),
  );
}

function validData(value: unknown, version: 3): value is FormalSaveData;
function validData(value: unknown, version: 1 | 2): value is PreviousSaveData;
function validData(value: unknown, version: 1 | 2 | 3): value is FormalSaveData | PreviousSaveData {
  if (
    !record(value) ||
    value.schemaVersion !== version ||
    !Array.isArray(value.warehouse) ||
    !value.warehouse.every(validItem) ||
    !uniqueStrings(value.codexIds) ||
    !uniqueStrings(value.unlockedChapterIds) ||
    !uniqueStrings(value.settledRaidIds) ||
    !(
      value.activeRaid === null ||
      (record(value.activeRaid) &&
        typeof value.activeRaid.raidId === 'string' &&
        value.activeRaid.raidId.length > 0 &&
        !value.settledRaidIds.includes(value.activeRaid.raidId))
    ) ||
    !(value.lastResult === null || validResult(value.lastResult))
  ) {
    return false;
  }

  const warehouseIds = new Set(value.warehouse.map((item) => item.instanceId));
  if (warehouseIds.size !== value.warehouse.length) {
    return false;
  }
  if (version === 3 && value.activeRaid !== null) {
    const loadout = value.activeRaid.loadout;
    if (
      !Array.isArray(loadout) ||
      loadout.length > RAID_RULES.bagCapacity ||
      !loadout.every((item) => validItem(item) && item.origin.kind === 'carry-in') ||
      new Set(loadout.map((item) => item.instanceId)).size !== loadout.length ||
      loadout.some((item) => warehouseIds.has(item.instanceId))
    ) {
      return false;
    }
  }
  if (value.lastResult !== null && !value.settledRaidIds.includes(value.lastResult.raidId)) {
    return false;
  }
  if (value.lastResult !== null) {
    const lastResult = value.lastResult;
    const resultIds = new Set(lastResult.items.map((item) => item.instanceId));
    if (resultIds.size !== lastResult.items.length) {
      return false;
    }
    if (lastResult.outcome === 'failed' && lastResult.items.length > 0) {
      return false;
    }
    if (
      lastResult.outcome === 'success' &&
      !lastResult.items.every(
        (item) =>
          (version === 3 && item.origin.kind === 'carry-in') ||
          (item.origin.kind === 'raid-loot' && item.origin.obtainedInRaidId === lastResult.raidId),
      )
    ) {
      return false;
    }
  }
  return true;
}

function decodeFormal(raw: string): { data: FormalSaveData; sourceSchemaVersion: number } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Formal save is not valid JSON; preserve the original before recovery.');
  }
  if (validData(value, FORMAL_SCHEMA_VERSION)) {
    return { data: structuredClone(value), sourceSchemaVersion: FORMAL_SCHEMA_VERSION };
  }
  if (validData(value, 2)) {
    return { data: migratePrevious(value), sourceSchemaVersion: 2 };
  }
  throw new Error('Formal save is corrupt or uses an unsupported schema version.');
}

function decodeLegacy(raw: string): SaveData {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Reference save is not valid JSON; import was not performed.');
  }
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.warehouse) ||
    !value.warehouse.every(validItem) ||
    !uniqueStrings(value.codexIds) ||
    !uniqueStrings(value.unlockedChapterIds) ||
    !uniqueStrings(value.settledRaidIds) ||
    !(
      value.activeRaid === null ||
      (record(value.activeRaid) && typeof value.activeRaid.raidId === 'string')
    ) ||
    !(value.lastResult === null || validResult(value.lastResult))
  ) {
    throw new Error('Reference save is corrupt or not a supported v1 save.');
  }
  if (!validData(value, 1)) {
    throw new Error('Reference save violates formal save invariants; import was not performed.');
  }
  return value as unknown as SaveData;
}

function migratePrevious(legacy: PreviousSaveData): FormalSaveData {
  const migrated: FormalSaveData = {
    schemaVersion: FORMAL_SCHEMA_VERSION,
    warehouse: structuredClone(legacy.warehouse),
    codexIds: [...legacy.codexIds],
    unlockedChapterIds: [...legacy.unlockedChapterIds],
    activeRaid: null,
    settledRaidIds: [...legacy.settledRaidIds],
    lastResult: legacy.lastResult ? structuredClone(legacy.lastResult) : null,
  };
  // Old active raids have no trustworthy carry-in manifest; never guess returns.
  if (legacy.activeRaid) {
    migrated.settledRaidIds.push(legacy.activeRaid.raidId);
    migrated.lastResult = {
      raidId: legacy.activeRaid.raidId,
      outcome: 'failed',
      reason: 'interrupted',
      items: [],
      value: 0,
    };
  }
  return migrated;
}

/** Formal B persistence adapter. Writes are commit-after-storage and never mutate on failure. */
export class PersistentSave implements SavePort {
  private data: FormalSaveData;

  constructor(private readonly storage: StoragePort) {
    const raw = storage.getItem(FORMAL_SAVE_KEY);
    this.data = this.initial();
    if (raw !== null) {
      const decoded = decodeFormal(raw);
      if (decoded.sourceSchemaVersion !== FORMAL_SCHEMA_VERSION) {
        this.commit(decoded.data);
      } else {
        this.data = decoded.data;
      }
    }
  }

  view(): FormalSaveData {
    return structuredClone(this.data);
  }

  exportRaw(): string {
    return JSON.stringify(this.data);
  }

  importRaw(raw: string): SaveImportResult {
    const decoded = decodeFormal(raw);
    this.commit(decoded.data);
    return {
      sourceSchemaVersion: decoded.sourceSchemaVersion,
      targetSchemaVersion: FORMAL_SCHEMA_VERSION,
    };
  }

  /** Explicitly imports the legacy reference key and leaves that key untouched. */
  importReference(): SaveImportResult {
    if (this.storage.getItem(FORMAL_SAVE_KEY) !== null) {
      throw new Error('Formal save already exists; export or reset it before importing.');
    }
    const raw = this.storage.getItem(SAVE_KEY);
    if (raw === null) {
      throw new Error('No reference save exists to import.');
    }
    const migrated = migratePrevious(decodeLegacy(raw));
    this.commit(migrated);
    return { sourceSchemaVersion: 1, targetSchemaVersion: FORMAL_SCHEMA_VERSION };
  }

  recoverInterrupted(): boolean {
    const active = this.data.activeRaid;
    if (!active) {
      return false;
    }
    const next = this.view();
    next.activeRaid = null;
    next.settledRaidIds.push(active.raidId);
    next.lastResult = {
      raidId: active.raidId,
      outcome: 'failed',
      reason: 'interrupted',
      items: [],
      value: 0,
    };
    this.commit(next);
    return true;
  }

  async beginRaid(raidId: string, loadoutIds: readonly string[]): Promise<readonly ItemInstance[]> {
    if (
      !raidId ||
      this.data.activeRaid ||
      this.data.settledRaidIds.includes(raidId) ||
      loadoutIds.length > RAID_RULES.bagCapacity ||
      new Set(loadoutIds).size !== loadoutIds.length
    ) {
      throw new Error('Cannot begin raid');
    }
    const loadout = loadoutIds.map((id) => {
      const item = this.data.warehouse.find((entry) => entry.instanceId === id);
      if (!item) {
        throw new Error('Missing loadout item');
      }
      return { ...structuredClone(item), origin: { kind: 'carry-in' as const } };
    });
    const next = this.view();
    next.warehouse = next.warehouse.filter((item) => !loadoutIds.includes(item.instanceId));
    next.activeRaid = { raidId, loadout: structuredClone(loadout) };
    this.commit(next);
    return loadout;
  }

  async finalizeRaid(result: RaidResult): Promise<void> {
    if (this.data.settledRaidIds.includes(result.raidId)) {
      return;
    }
    if (
      this.data.activeRaid?.raidId !== result.raidId ||
      !validSettlementResult(result, this.data.activeRaid.loadout)
    ) {
      throw new Error('Invalid settlement');
    }
    const next = this.view();
    if (result.outcome === 'success') {
      const warehouseIds = new Set(next.warehouse.map((item) => item.instanceId));
      for (const item of result.items) {
        if (warehouseIds.has(item.instanceId)) {
          throw new Error('Duplicate instance in settlement');
        }
        warehouseIds.add(item.instanceId);
        next.warehouse.push(structuredClone(item));
        if (!next.codexIds.includes(item.itemId)) {
          next.codexIds.push(item.itemId);
        }
      }
      if (chapterUnlockGranted(result) && !next.unlockedChapterIds.includes(QUEST_CHAPTER_ID)) {
        next.unlockedChapterIds.push(QUEST_CHAPTER_ID);
      }
    }
    next.activeRaid = null;
    next.settledRaidIds.push(result.raidId);
    next.lastResult = structuredClone(result);
    this.commit(next);
  }

  reset(): void {
    this.commit(this.initial());
  }

  private commit(next: FormalSaveData): void {
    if (!validData(next, FORMAL_SCHEMA_VERSION)) {
      throw new Error('Refusing to commit invalid formal save data.');
    }
    this.storage.setItem(FORMAL_SAVE_KEY, JSON.stringify(next));
    this.data = structuredClone(next);
  }

  private initial(): FormalSaveData {
    return {
      schemaVersion: FORMAL_SCHEMA_VERSION,
      warehouse: [],
      codexIds: [],
      unlockedChapterIds: [],
      activeRaid: null,
      settledRaidIds: [],
      lastResult: null,
    };
  }
}
