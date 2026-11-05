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
