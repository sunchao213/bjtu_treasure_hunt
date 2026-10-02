import { describe, expect, it } from 'vitest';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import { calculateExtractionValue } from '../../src/modules/inventory/extraction-value';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { SearchInteraction } from '../../src/modules/world/search-interaction';
import { EventBus } from '../../src/shared/events/game-events';
import type { ItemInstance } from '../../src/shared/types/game';

const loot = (id: string, itemId = 'school-badge'): ItemInstance => ({
  instanceId: id,
  itemId,
  origin: { kind: 'raid-loot', obtainedInRaidId: 'current' },
});
const value = (items: readonly ItemInstance[]) =>
  calculateExtractionValue(items, 'current', ITEM_DEFINITIONS, RAID_RULES.values);

describe('B reference inventory contract', () => {
  it('deduplicates equipped/bag aliases and excludes carry-in and other raids', () => {
    const epic = loot('epic', 'gpa-charm');
    expect(
      value([
        epic,
        epic,
        loot('rare-1'),
        loot('rare-2'),
        { instanceId: 'carry', itemId: 'siyuan-key', origin: { kind: 'carry-in' } },
        {
          instanceId: 'old',
          itemId: 'siyuan-key',
          origin: { kind: 'raid-loot', obtainedInRaidId: 'old' },
        },
      ]),
    ).toBe(110);
  });
  it('uses the rules snapshot and rejects unknown loot instead of granting a fake value', () => {
    expect(
      calculateExtractionValue([loot('a')], 'current', ITEM_DEFINITIONS, {
        ...RAID_RULES.values,
        uncommon: 35,
      }),
    ).toBe(35);
    expect(() => value([loot('broken', 'unknown')])).toThrow('Unknown item');
  });
  it('six common items fill the bag but do not qualify; snapshots cannot mutate real inventory', () => {
    const inventory = new ReferenceInventory(new EventBus(), 6, ITEM_DEFINITIONS);
    inventory.begin('current', []);
    for (let i = 0; i < 6; i++) {
      inventory.addLoot(loot(String(i), 'scratch-paper'));
    }
    expect(value(inventory.getCarriedItems())).toBe(60);
    expect(inventory.addLoot(loot('extra')).ok).toBe(false);
    const copy = [...inventory.getCarriedItems()];
    copy.pop();
    expect(inventory.getCarriedItems()).toHaveLength(6);
  });
  it('drop and pickup preserve identity/provenance without farming value', () => {
    const inventory = new ReferenceInventory(new EventBus(), 6, ITEM_DEFINITIONS);
    const carry: ItemInstance = {
      instanceId: 'carry',
      itemId: 'siyuan-key',
      origin: { kind: 'carry-in' },
    };
    inventory.begin('current', [carry]);
    inventory.addLoot(loot('a'));
    for (let i = 0; i < 3; i++) {
      const removed = inventory.remove('a');
      if (removed.ok) {
        inventory.addLoot(removed.value);
      }
    }
    const removed = inventory.remove('carry');
    if (removed.ok) {
      inventory.addLoot(removed.value);
    }
    expect(value(inventory.getCarriedItems())).toBe(25);
  });
  it('full bag leaves the search point available; interruption never grants a reward', () => {
    let now = 0;
    const search = new SearchInteraction(2_000, () => now);
    const inventory = new ReferenceInventory(new EventBus(), 1, ITEM_DEFINITIONS);
    inventory.begin('current', []);
    inventory.addLoot(loot('existing'));
    search.begin('chest');
    now = 1_999;
    expect(search.finish(loot('new'), (item) => inventory.addLoot(item)).ok).toBe(false);
    search.cancel();
    now = 5_000;
    expect(search.isOpened('chest')).toBe(false);
    search.begin('chest');
    now += 2_000;
    expect(search.finish(loot('new'), (item) => inventory.addLoot(item)).ok).toBe(false);
    expect(search.isOpened('chest')).toBe(false);
    inventory.remove('existing');
    search.begin('chest');
    now += 2_000;
    expect(search.finish(loot('new'), (item) => inventory.addLoot(item)).ok).toBe(true);
    expect(search.begin('chest')).toBe(false);
  });
});
