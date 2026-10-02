import { describe, expect, it } from 'vitest';
import { ReferenceSave, SAVE_KEY } from '../../src/modules/save/reference-save';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { RaidController } from '../../src/modules/raid/raid-controller';
import { EventBus } from '../../src/shared/events/game-events';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import type { StoragePort } from '../../src/modules/save/reference-save';
import type { ItemInstance, RaidResult } from '../../src/shared/types/game';

class MemoryStorage implements StoragePort {
  private data = new Map<string, string>();
  fail = false;
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    if (this.fail) {
      throw new Error('QuotaExceeded');
    }
    this.data.set(key, value);
  }
}
function result(raidId: string): RaidResult {
  const items: ItemInstance[] = Array.from({ length: 4 }, (_, index) => ({
    instanceId: `${raidId}-${index}`,
    itemId: 'school-badge',
    origin: { kind: 'raid-loot', obtainedInRaidId: raidId },
  }));
  return { raidId, outcome: 'success', reason: null, items, value: 100 };
}

describe('A to B reference persistence integration', () => {
  it('persists success across reload; duplicate settlement cannot duplicate items', async () => {
    const storage = new MemoryStorage();
    const save = new ReferenceSave(storage);
    await save.beginRaid('1', []);
    await save.finalizeRaid(result('1'));
    await save.finalizeRaid(result('1'));
    const reloaded = new ReferenceSave(storage);
    expect(reloaded.view().warehouse).toHaveLength(4);
    expect(reloaded.view().codexIds).toEqual(['school-badge']);
    expect(reloaded.view().activeRaid).toBeNull();
  });
  it('deducts carried loadout before play and loses it on interruption; untouched warehouse stays', async () => {
    const storage = new MemoryStorage();
    const save = new ReferenceSave(storage);
    await save.beginRaid('1', []);
    await save.finalizeRaid(result('1'));
    const items = await save.beginRaid('2', ['1-0']);
    expect(items[0]?.origin.kind).toBe('carry-in');
    expect(save.view().warehouse).toHaveLength(3);
    const reloaded = new ReferenceSave(storage);
    expect(reloaded.recoverInterrupted()).toBe(true);
    expect(reloaded.recoverInterrupted()).toBe(false);
    expect(reloaded.view().warehouse).toHaveLength(3);
    expect(reloaded.view().codexIds).toHaveLength(1);
    expect(reloaded.view().lastResult?.reason).toBe('interrupted');
  });
  it('storage failure cannot advance memory or silently overwrite a corrupt save', async () => {
    const storage = new MemoryStorage();
    const save = new ReferenceSave(storage);
    storage.fail = true;
    await expect(save.beginRaid('1', [])).rejects.toThrow();
    expect(save.view().activeRaid).toBeNull();
    storage.fail = false;
    storage.setItem(SAVE_KEY, '{broken');
    expect(() => new ReferenceSave(storage)).toThrow();
    expect(storage.getItem(SAVE_KEY)).toBe('{broken');
  });
  it('rejects unknown schema and item definitions', () => {
    const storage = new MemoryStorage();
    storage.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 99 }));
    expect(() => new ReferenceSave(storage)).toThrow();
  });
  it('search/value/extraction acknowledges saved result then allows a new raid', async () => {
    let now = 0;
    const storage = new MemoryStorage();
    const save = new ReferenceSave(storage);
    const bus = new EventBus();
    const inventory = new ReferenceInventory(bus, 6, ITEM_DEFINITIONS);
    const controller = new RaidController(
      inventory,
      save,
      bus,
      RAID_RULES,
      ITEM_DEFINITIONS,
      () => now,
      () => 'integrated',
    );
    await controller.start();
    for (const item of result('integrated').items) {
      inventory.addLoot(item);
    }
    controller.setExtractionPresence(true);
    controller.startExtraction();
    now = 5_000;
    controller.tick();
    await Promise.resolve();
    expect(controller.getView().phase).toBe('success');
    expect(save.view().warehouse).toHaveLength(4);
    expect(controller.prepareNext()).toBe(true);
    expect(inventory.getCarriedItems()).toHaveLength(0);
  });
});
