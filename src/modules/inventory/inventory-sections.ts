import type { ItemDefinition, ItemInstance } from '../../shared/types/game';

export type InventorySection = 'bag' | 'tools';
export interface InventoryCapacities {
  readonly bag: number;
  readonly tools: number;
}
export const RAID_INVENTORY_CAPACITIES: InventoryCapacities = { bag: 6, tools: 6 };

export function inventorySection(item: ItemInstance): InventorySection {
  return item.origin.kind === 'carry-in' ? 'tools' : 'bag';
}

export function occupiedSlots(
  items: readonly ItemInstance[],
  definitions: Readonly<Record<string, ItemDefinition>>,
  section?: InventorySection,
): number {
  return items.reduce(
    (total, item) =>
      total +
      (section && inventorySection(item) !== section
        ? 0
        : (definitions[item.itemId]?.bagSlots ?? 1)),
    0,
  );
}

export function sectionCanFit(
  items: readonly ItemInstance[],
  item: ItemInstance,
  definitions: Readonly<Record<string, ItemDefinition>>,
  capacities: InventoryCapacities,
): boolean {
  const section = inventorySection(item);
  return (
    occupiedSlots(items, definitions, section) + (definitions[item.itemId]?.bagSlots ?? 1) <=
    capacities[section]
  );
}
