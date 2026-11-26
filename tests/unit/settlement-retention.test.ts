import { describe, expect, it } from 'vitest';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import { retainSettlementItems } from '../../src/modules/save/settlement-retention';
import { PersistentSave } from '../../src/modules/save/persistent-save';
import { ReferenceSave, type StoragePort } from '../../src/modules/save/reference-save';
import type { ItemInstance } from '../../src/shared/types/game';

const item = (instanceId: string, itemId: string): ItemInstance => ({
  instanceId,
  itemId,
  origin: { kind: 'raid-loot', obtainedInRaidId: 'raid' },
});

describe.each([ReferenceSave, PersistentSave])('%s settlement persistence', (Save) => {
  it('loads retired map items without losing currency, chapters or functional items', () => {
    const data = new Map<string, string>();
    const storage: StoragePort = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
    };
    const save = new Save(storage);
    save.reset();
    const [key, raw] = [...data.entries()][0]!;
    const legacy = JSON.parse(raw);
    legacy.currency = 87;
    legacy.warehouse = [
      item('map', 'campus-map'),
      item('kit', 'portable-medkit'),
      item('evidence-map', 'marked-campus-map'),
    ];
    legacy.codexIds = ['campus-map', 'portable-medkit', 'marked-campus-map'];
    legacy.unlockedChapterIds = ['siyuan-code'];
    legacy.settledRaidIds = ['raid'];
    legacy.lastResult = {
      raidId: 'raid',
      outcome: 'success',
      reason: null,
      items: legacy.warehouse,
      value: 20,
    };
    data.set(key, JSON.stringify(legacy));
    const restored = new Save(storage).view();
    const retained = [item('kit', 'portable-medkit'), item('evidence-map', 'marked-campus-map')];
    expect(restored.warehouse).toEqual(retained);
    expect(restored.codexIds).toEqual(['portable-medkit', 'marked-campus-map']);
    expect(restored.currency).toBe(87);
    expect(restored.unlockedChapterIds).toEqual(['siyuan-code']);
    expect(restored.lastResult?.items).toEqual(retained);
    expect(restored.lastResult?.value).toBe(20);
  });

  it('converts duplicates atomically and exactly once across raids, retries and reloads', async () => {
    const data = new Map<string, string>();
    let fail = false;
    const storage: StoragePort = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        if (fail) {
          throw new Error('QuotaExceeded');
        }
        data.set(key, value);
      },
    };
    const save = new Save(storage);
    const loot = (raidId: string, instanceId: string): ItemInstance => ({
      instanceId,
      itemId: 'school-badge',
      origin: { kind: 'raid-loot', obtainedInRaidId: raidId },
    });
    await save.beginRaid('first', []);
    await save.finalizeRaid({
      raidId: 'first',
      outcome: 'success',
      reason: null,
      items: [loot('first', 'old')],
      value: 25,
    });
    await save.beginRaid('second', []);
    const before = save.view();
    const storedBefore = [...data.entries()];
    const settlement = {
      raidId: 'second',
      outcome: 'success' as const,
      reason: null,
      items: [loot('second', 'new'), loot('second', 'newest')],
      value: 50,
    };
    fail = true;
    await expect(save.finalizeRaid(settlement)).rejects.toThrow('QuotaExceeded');
    expect(save.view()).toEqual(before);
    expect([...data.entries()]).toEqual(storedBefore);
    fail = false;
    await save.finalizeRaid(settlement);
    await save.finalizeRaid(settlement);
    const reloaded = new Save(storage);
    await reloaded.finalizeRaid(settlement);
    expect(reloaded.view()).toEqual(save.view());
    expect(reloaded.view().warehouse).toEqual([loot('second', 'newest')]);
    expect(reloaded.view().currency).toBe(2 * RAID_RULES.values.uncommon);
    expect(reloaded.view().settledRaidIds).toEqual(['first', 'second']);
  });
});

describe('settlement retention', () => {
  it('keeps the newest value-only item and converts duplicates to 交子', () => {
    const retained = retainSettlementItems(
      [item('old', 'school-badge')],
      [item('new', 'school-badge')],
      7,
      ITEM_DEFINITIONS,
      RAID_RULES.values,
    );
    expect(retained.warehouse.map((entry) => entry.instanceId)).toEqual(['new']);
    expect(retained.currency).toBe(7 + RAID_RULES.values.uncommon);
  });

  it('keeps functional items as separate instances', () => {
    const retained = retainSettlementItems(
      [item('old', 'morning-coffee')],
      [item('new', 'morning-coffee')],
      0,
      ITEM_DEFINITIONS,
      RAID_RULES.values,
    );
    expect(retained.warehouse.map((entry) => entry.instanceId)).toEqual(['old', 'new']);
    expect(retained.currency).toBe(0);
  });
});
