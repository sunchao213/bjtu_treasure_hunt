import { describe, expect, it } from 'vitest';
import { FORMAL_SAVE_KEY, PersistentSave } from '../../src/modules/save/persistent-save';
import { ReferenceSave, SAVE_KEY, type StoragePort } from '../../src/modules/save/reference-save';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { RaidController } from '../../src/modules/raid/raid-controller';
import { EventBus } from '../../src/shared/events/game-events';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import type { ItemInstance, RaidResult } from '../../src/shared/types/game';

class MemoryStorage implements StoragePort {
  private data = new Map<string, string>();
  fail = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.fail) {
      throw new Error('QuotaExceeded');
    }
    this.data.set(key, value);
  }
}

const result = (raidId: string): RaidResult => {
  const items: ItemInstance[] = Array.from({ length: 4 }, (_, index) => ({
    instanceId: `${raidId}-${index}`,
    itemId: 'school-badge',
    origin: { kind: 'raid-loot', obtainedInRaidId: raidId },
  }));
  return { raidId, outcome: 'success', reason: null, items, value: 100 };
};

describe('formal persistence and migration', () => {
  it('saves chapter unlocks atomically with evidence and keeps them after reload and failure', async () => {
    const storage = new MemoryStorage();
    const save = new PersistentSave(storage);
    await save.beginRaid('story', []);
    const storyResult: RaidResult = {
      ...result('story'),
      questComplete: true,
      items: ['torn-notebook', 'anomalous-feather'].map((itemId) => ({
        instanceId: `story:${itemId}`,
        itemId,
        origin: { kind: 'raid-loot', obtainedInRaidId: 'story' },
      })),
    };
    storage.fail = true;
    await expect(save.finalizeRaid(storyResult)).rejects.toThrow();
    expect(save.view().unlockedChapterIds).toEqual([]);
    expect(save.view().warehouse).toEqual([]);
    storage.fail = false;
    await save.finalizeRaid(storyResult);
    await save.finalizeRaid(storyResult);
    const reloaded = new PersistentSave(storage);
    expect(reloaded.view().unlockedChapterIds).toEqual(['siyuan-code']);
    expect(reloaded.view().warehouse).toHaveLength(2);
    await reloaded.beginRaid('failed', []);
    await reloaded.finalizeRaid({
      raidId: 'failed',
      outcome: 'failed',
      reason: 'death',
      items: [],
      value: 0,
    });
    expect(reloaded.view().unlockedChapterIds).toEqual(['siyuan-code']);
    expect(reloaded.view().warehouse).toHaveLength(2);
  });

  it('does not unlock a chapter without both current-raid evidence items and quest completion', async () => {
    for (const complete of [true, false]) {
      const save = new PersistentSave(new MemoryStorage());
      await save.beginRaid('story', []);
      const evidence = ['torn-notebook', 'anomalous-feather'].map((itemId) => ({
        instanceId: `story:${itemId}`,
        itemId,
        origin: { kind: 'raid-loot' as const, obtainedInRaidId: 'story' },
      }));
      await save.finalizeRaid({
        ...result('story'),
        questComplete: complete,
        items: complete ? evidence.slice(0, 1) : evidence,
      });
      expect(save.view().unlockedChapterIds).toEqual([]);
    }
  });

  it('imports v1 reference data into v2 without changing the legacy key', async () => {
    const storage = new MemoryStorage();
    const reference = new ReferenceSave(storage);
    await reference.beginRaid('legacy', []);
    await reference.finalizeRaid(result('legacy'));
    const legacyRaw = storage.getItem(SAVE_KEY);

    const formal = new PersistentSave(storage);
    expect(formal.importReference()).toEqual({ sourceSchemaVersion: 1, targetSchemaVersion: 2 });
    expect(storage.getItem(SAVE_KEY)).toBe(legacyRaw);
    expect(storage.getItem(FORMAL_SAVE_KEY)).not.toBeNull();
    expect(formal.view().schemaVersion).toBe(2);
    expect(formal.view().warehouse).toHaveLength(4);
    expect(new PersistentSave(storage).view().codexIds).toEqual(['school-badge']);
  });

  it('does not overwrite an existing formal save during reference import', async () => {
    const storage = new MemoryStorage();
    await new PersistentSave(storage).beginRaid('existing', []);
    expect(() => new PersistentSave(storage).importReference()).toThrow('already exists');
  });

  it('commits begin and finalize only after storage accepts the complete object', async () => {
    const storage = new MemoryStorage();
    const save = new PersistentSave(storage);
    storage.fail = true;
    await expect(save.beginRaid('blocked', [])).rejects.toThrow();
    expect(save.view().activeRaid).toBeNull();
    expect(storage.getItem(FORMAL_SAVE_KEY)).toBeNull();

    storage.fail = false;
    await save.beginRaid('raid', []);
    storage.fail = true;
    await expect(save.finalizeRaid(result('raid'))).rejects.toThrow();
    expect(save.view().activeRaid?.raidId).toBe('raid');
    expect(save.view().settledRaidIds).toEqual([]);
    storage.fail = false;
    await save.finalizeRaid(result('raid'));
    await save.finalizeRaid(result('raid'));
    expect(save.view().warehouse).toHaveLength(4);
    expect(save.view().settledRaidIds).toEqual(['raid']);
  });

  it('preserves the original formal raw data when importing corrupt or unsupported input', () => {
    const storage = new MemoryStorage();
    const save = new PersistentSave(storage);
    const original = save.exportRaw();
    expect(() => save.importRaw('{broken')).toThrow('not valid JSON');
    expect(save.exportRaw()).toBe(original);
    expect(() => save.importRaw(JSON.stringify({ schemaVersion: 99 }))).toThrow('unsupported');
    expect(save.exportRaw()).toBe(original);
  });

  it('recovers an interrupted raid transactionally and keeps untouched warehouse items', async () => {
    const storage = new MemoryStorage();
    const save = new PersistentSave(storage);
    await save.beginRaid('raid', []);
    expect(save.recoverInterrupted()).toBe(true);
    expect(save.recoverInterrupted()).toBe(false);
    const view = save.view();
    expect(view.activeRaid).toBeNull();
    expect(view.settledRaidIds).toEqual(['raid']);
    expect(view.lastResult?.reason).toBe('interrupted');
  });

  it('exports a reloadable backup and resets only the formal save', async () => {
    const storage = new MemoryStorage();
    const save = new PersistentSave(storage);
    await save.beginRaid('raid', []);
    const backup = save.exportRaw();

    save.reset();
    expect(save.view().activeRaid).toBeNull();
    expect(save.view().settledRaidIds).toEqual([]);

    save.importRaw(backup);
    expect(new PersistentSave(storage).view().activeRaid?.raidId).toBe('raid');
  });

  it('runs the controller against the formal save and settles one raid atomically', async () => {
    let now = 0;
    const storage = new MemoryStorage();
    const save = new PersistentSave(storage);
    const events = new EventBus();
    const inventory = new ReferenceInventory(events, RAID_RULES.bagCapacity, ITEM_DEFINITIONS);
    const controller = new RaidController(
      inventory,
      save,
      events,
      RAID_RULES,
      ITEM_DEFINITIONS,
      () => now,
      () => 'formal-raid',
    );

    await controller.start();
    for (let index = 0; index < 4; index += 1) {
      expect(
        inventory.addLoot({
          instanceId: `formal-raid:${index}`,
          itemId: 'school-badge',
          origin: { kind: 'raid-loot', obtainedInRaidId: 'formal-raid' },
        }),
      ).toMatchObject({ ok: true });
    }
    controller.setExtractionPresence(true);
    expect(controller.startExtraction()).toMatchObject({ ok: true });
    now = RAID_RULES.extractionDurationMs;
    controller.tick();
    await Promise.resolve();

    expect(controller.getView().phase).toBe('success');
    expect(save.view().warehouse).toHaveLength(4);
    expect(save.view().settledRaidIds).toEqual(['formal-raid']);
    expect(save.view().lastResult?.raidId).toBe('formal-raid');
    expect(new PersistentSave(storage).view().warehouse).toHaveLength(4);
  });
});
