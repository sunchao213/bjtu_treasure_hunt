import type { ItemInstance, RaidResult, SavePort } from '../../shared/types/game';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../config/game-config';

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SaveData {
  schemaVersion: 1;
  warehouse: ItemInstance[];
  codexIds: string[];
  unlockedChapterIds: string[];
  activeRaid: { raidId: string } | null;
  settledRaidIds: string[];
  lastResult: RaidResult | null;
}

export const SAVE_KEY = 'bjtu-treasure-hunt:a-framework:v1';
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

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
    (value.origin.kind === 'raid-loot' && typeof value.origin.obtainedInRaidId === 'string')
  );
}

function validResult(value: unknown): value is RaidResult {
  if (!record(value)) {
    return false;
  }
  return (
    typeof value.raidId === 'string' &&
    ((value.outcome === 'success' && value.reason === null) ||
      (value.outcome === 'failed' &&
        ['death', 'timeout', 'abandoned', 'interrupted'].includes(String(value.reason)))) &&
    Array.isArray(value.items) &&
    value.items.every(validItem) &&
    typeof value.value === 'number' &&
    Number.isSafeInteger(value.value) &&
    value.value >= 0
  );
}

function decode(raw: string): SaveData {
  const value: unknown = JSON.parse(raw);
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.warehouse) ||
    !value.warehouse.every(validItem) ||
    !strings(value.codexIds) ||
    !strings(value.unlockedChapterIds) ||
    !strings(value.settledRaidIds) ||
    !(
      value.activeRaid === null ||
      (record(value.activeRaid) && typeof value.activeRaid.raidId === 'string')
    ) ||
    !(value.lastResult === null || validResult(value.lastResult))
  ) {
    throw new Error('存档格式不受支持或已经损坏，请先备份，再确认重置。');
  }
  if (new Set(value.warehouse.map((item) => item.instanceId)).size !== value.warehouse.length) {
    throw new Error('存档中存在重复物品实例。');
  }
  return value as unknown as SaveData;
}

/** B reference adapter, deliberately isolated from the real game save namespace. */
export class ReferenceSave implements SavePort {
  private data: SaveData;

  constructor(private readonly storage: StoragePort) {
    const raw = storage.getItem(SAVE_KEY);
    this.data = raw === null ? this.initial() : decode(raw);
  }

  view(): SaveData {
    return structuredClone(this.data);
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
      this.data.activeRaid ||
      this.data.settledRaidIds.includes(raidId) ||
      !raidId ||
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
    next.activeRaid = { raidId };
    this.commit(next); // Set in-memory state only AFTER storage confirms the complete object write.
    return loadout;
  }

  async finalizeRaid(result: RaidResult): Promise<void> {
    if (this.data.settledRaidIds.includes(result.raidId)) {
      return;
    }
    if (this.data.activeRaid?.raidId !== result.raidId || !validResult(result)) {
      throw new Error('Invalid settlement');
    }
    const next = this.view();
    if (result.outcome === 'success') {
      const ids = new Set(next.warehouse.map((item) => item.instanceId));
      for (const item of result.items) {
        if (ids.has(item.instanceId)) {
          throw new Error('Duplicate instance in settlement');
        }
        ids.add(item.instanceId);
        next.warehouse.push(structuredClone(item));
        if (!next.codexIds.includes(item.itemId)) {
          next.codexIds.push(item.itemId);
        }
      }
    }
    // D owns chapter conditions: no automatic unlock merely because a demo chest contains evidence.
    next.activeRaid = null;
    next.settledRaidIds.push(result.raidId);
    next.lastResult = structuredClone(result);
    this.commit(next);
  }

  reset(): void {
    this.commit(this.initial());
  }
  private commit(next: SaveData): void {
    this.storage.setItem(SAVE_KEY, JSON.stringify(next));
    this.data = next;
  }
  private initial(): SaveData {
    return {
      schemaVersion: 1,
      warehouse: [],
      codexIds: [],
      unlockedChapterIds: [],
      activeRaid: null,
      settledRaidIds: [],
      lastResult: null,
    };
  }
}
