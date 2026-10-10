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
  it('covers 95/100/110 boundaries and excludes a valuable carry-in item', () => {
    expect(
      value([loot('epic-1', 'gpa-charm'), loot('rare-1'), loot('common', 'scratch-paper')]),
    ).toBe(95);
    expect(value([loot('rare-1'), loot('rare-2'), loot('rare-3'), loot('rare-4')])).toBe(100);
    expect(value([loot('epic-1', 'gpa-charm'), loot('rare-1'), loot('rare-2')])).toBe(110);
    expect(
      value([
        { instanceId: 'carry', itemId: 'siyuan-key', origin: { kind: 'carry-in' } },
        loot('rare-1'),
      ]),
    ).toBe(25);
  });
  it('rejects conflicting aliases that reuse one instanceId', () => {
    expect(() =>
      value([
        loot('same', 'school-badge'),
        { ...loot('same', 'gpa-charm'), origin: { kind: 'raid-loot', obtainedInRaidId: 'old' } },
      ]),
    ).toThrow('Conflicting item instance');
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

  it('equips weapons without consuming a bag slot and prevents duplicate slot occupancy', () => {
    const inventory = new ReferenceInventory(new EventBus(), 1, ITEM_DEFINITIONS);
    inventory.begin('current', [
      { instanceId: 'weapon', itemId: 'training-bat', origin: { kind: 'carry-in' } },
    ]);
    expect(inventory.equip('weapon', 'primary').ok).toBe(true);
    expect(inventory.equip('weapon', 'secondary')).toEqual({
      ok: false,
      error: 'ITEM_ALREADY_EQUIPPED',
    });
    expect(
      inventory.addLoot({
        instanceId: 'loot',
        itemId: 'reinforced-bat',
        origin: { kind: 'raid-loot', obtainedInRaidId: 'current' },
      }).ok,
    ).toBe(true);
    expect(inventory.equip('loot', 'primary')).toEqual({
      ok: false,
      error: 'EQUIPMENT_SLOT_OCCUPIED',
    });
    expect(inventory.getEquipment().primary?.instanceId).toBe('weapon');
  });

  it('consumes healing only after the effect is accepted', () => {
    const consumed: string[] = [];
    const bus = new EventBus();
    bus.on('ItemConsumed', ({ instanceId }) => consumed.push(instanceId));
    const inventory = new ReferenceInventory(bus, 6, ITEM_DEFINITIONS);
    inventory.begin('current', []);
    inventory.addLoot(loot('coffee', 'morning-coffee'));
    expect(inventory.consumeHealing('coffee', () => false)).toEqual({
      ok: false,
      error: 'INVALID_STATE',
    });
    expect(inventory.getCarriedItems()).toHaveLength(1);
    expect(inventory.consumeHealing('coffee', () => true).ok).toBe(true);
    expect(inventory.getCarriedItems()).toHaveLength(0);
    expect(consumed).toEqual(['coffee']);
  });

  it('rejects using a non-healing item and does not consume it', () => {
    const inventory = new ReferenceInventory(new EventBus(), 6, ITEM_DEFINITIONS);
    inventory.begin('current', []);
    inventory.addLoot(loot('badge'));
    expect(inventory.consumeHealing('badge', () => true)).toEqual({
      ok: false,
      error: 'ITEM_NOT_USABLE',
    });
    expect(inventory.getCarriedItems()).toHaveLength(1);
  });

  it('refuses to unequip into a full bag and allows it after freeing a slot', () => {
    const inventory = new ReferenceInventory(new EventBus(), 2, ITEM_DEFINITIONS);
    inventory.begin('current', [
      { instanceId: 'weapon', itemId: 'training-bat', origin: { kind: 'carry-in' } },
      { instanceId: 'badge', itemId: 'school-badge', origin: { kind: 'carry-in' } },
    ]);
    expect(inventory.equip('weapon', 'primary').ok).toBe(true);
    expect(inventory.addLoot(loot('new'))).toEqual({ ok: true, value: undefined });
    expect(inventory.unequip('primary')).toEqual({ ok: false, error: 'BAG_FULL' });
    inventory.remove('badge');
    expect(inventory.unequip('primary').ok).toBe(true);
    expect(inventory.getEquipment()).toEqual({});
  });
});
