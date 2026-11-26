import { describe, expect, it } from 'vitest';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import {
  RAID_INVENTORY_CAPACITIES,
  occupiedSlots,
  sectionCanFit,
} from '../../src/modules/inventory/inventory-sections';
import { calculateExtractionValue } from '../../src/modules/inventory/extraction-value';
import { EventBus } from '../../src/shared/events/game-events';
import type { ItemInstance } from '../../src/shared/types/game';

const tool = (id: string, itemId = 'bandage'): ItemInstance => ({
  instanceId: id,
  itemId,
  origin: { kind: 'carry-in' },
});
const loot = (id: string, itemId = 'school-badge'): ItemInstance => ({
  instanceId: id,
  itemId,
  origin: { kind: 'raid-loot', obtainedInRaidId: 'raid' },
});
const setup = (tools: ItemInstance[] = []) => {
  const inventory = new ReferenceInventory(
    new EventBus(),
    6,
    ITEM_DEFINITIONS,
    RAID_INVENTORY_CAPACITIES,
  );
  inventory.begin('raid', tools);
  return inventory;
};

describe('2D raid inventory sections', () => {
  it('counts main equipped weapons in the tool section and can repick them with a full discovery bag', () => {
    const inventory = setup();
    const weapon = tool('weapon', 'training-bat');
    inventory.begin(
      'raid',
      Array.from({ length: 5 }, (_, i) => tool(`tool-${i}`)),
      { primary: weapon },
    );
    for (let i = 0; i < 6; i++) expect(inventory.addLoot(loot(`loot-${i}`)).ok).toBe(true);
    expect(occupiedSlots(inventory.getCarriedItems(), ITEM_DEFINITIONS, 'tools')).toBe(6);
    const removed = inventory.remove('weapon');
    expect(removed.ok && inventory.addLoot(removed.value).ok).toBe(true);
    expect(inventory.equip('weapon', 'primary').ok).toBe(true);
    expect(inventory.unequip('primary').ok).toBe(true);
    expect(occupiedSlots(inventory.getCarriedItems(), ITEM_DEFINITIONS, 'tools')).toBe(6);
  });
  it('carries six tools and six discoveries independently, refusing only the full section', () => {
    const tools = Array.from({ length: 6 }, (_, i) => tool(`tool-${i}`));
    const inventory = setup(tools);
    for (let i = 0; i < 6; i++) expect(inventory.addLoot(loot(`loot-${i}`)).ok).toBe(true);
    expect(inventory.getCarriedItems()).toHaveLength(12);
    expect(inventory.addLoot(loot('extra'))).toEqual({ ok: false, error: 'INVENTORY_FULL' });
    inventory.remove('tool-0');
    expect(
      sectionCanFit(
        inventory.getCarriedItems(),
        tools[0]!,
        ITEM_DEFINITIONS,
        RAID_INVENTORY_CAPACITIES,
      ),
    ).toBe(true);
    expect(inventory.addLoot(tools[0]!).ok).toBe(true);
    expect(
      calculateExtractionValue(
        inventory.getCarriedItems(),
        'raid',
        ITEM_DEFINITIONS,
        RAID_RULES.values,
      ),
    ).toBe(150);
  });

  it('counts bicycle and initial weapon slots, retaining the correct section after dropping', () => {
    const tools = [
      tool('bike', 'yellow-bike'),
      tool('weapon', 'training-bat'),
      tool('a'),
      tool('b'),
      tool('c'),
    ];
    const inventory = setup(tools);
    expect(occupiedSlots(inventory.getCarriedItems(), ITEM_DEFINITIONS, 'tools')).toBe(6);
    inventory.addLoot(loot('coffee', 'morning-coffee'));
    expect(inventory.consumeHealing('coffee', () => false).ok).toBe(false);
    expect(inventory.consumeHealing('coffee', () => true).ok).toBe(true);
    const removed = inventory.remove('bike');
    expect(removed.ok && inventory.addLoot(removed.value).ok).toBe(true);
    expect(occupiedSlots(inventory.getCarriedItems(), ITEM_DEFINITIONS, 'bag')).toBe(0);
    expect(() => setup([...tools, tool('extra')])).toThrow('capacity');
  });

  it('recomputes value on discard, repickup, and consumption without farming value', () => {
    const inventory = setup([tool('valuable', 'siyuan-key')]);
    const coffee = loot('coffee', 'morning-coffee');
    inventory.addLoot(coffee);
    const value = () =>
      calculateExtractionValue(
        inventory.getCarriedItems(),
        'raid',
        ITEM_DEFINITIONS,
        RAID_RULES.values,
      );
    expect(value()).toBe(25);
    inventory.remove('coffee');
    expect(value()).toBe(0);
    inventory.addLoot(coffee);
    expect(value()).toBe(25);
    inventory.consumeHealing('coffee', () => true);
    expect(value()).toBe(0);
  });
});
