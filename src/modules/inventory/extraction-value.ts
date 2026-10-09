import type { ItemDefinition, ItemInstance, RaidRules } from '../../shared/types/game';

/** Pure calculation from authoritative carried instances and a per-raid rule snapshot. */
export function calculateExtractionValue(
  items: readonly ItemInstance[],
  raidId: string,
  definitions: Readonly<Record<string, ItemDefinition>>,
  values: RaidRules['values'],
): number {
  if (!raidId) {
    throw new Error('Raid ID is required');
  }
  const seen = new Map<string, ItemInstance>();
  let total = 0;
  for (const item of items) {
    const previous = seen.get(item.instanceId);
    if (previous) {
      if (!sameInstance(previous, item)) {
        throw new Error(`Conflicting item instance: ${item.instanceId}`);
      }
      continue;
    }
    seen.set(item.instanceId, item);
    if (item.origin.kind !== 'raid-loot' || item.origin.obtainedInRaidId !== raidId) {
      continue;
    }
    const definition = definitions[item.itemId];
    if (!definition) {
      throw new Error(`Unknown item definition: ${item.itemId}`);
    }
    const value = values[definition.rarity];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error('Invalid item value');
    }
    total += value;
  }
  return total;
}

function sameInstance(left: ItemInstance, right: ItemInstance): boolean {
  if (left.itemId !== right.itemId || left.origin.kind !== right.origin.kind) {
    return false;
  }
  if (left.origin.kind === 'carry-in') {
    return true;
  }
  return (
    right.origin.kind === 'raid-loot' &&
    left.origin.obtainedInRaidId === right.origin.obtainedInRaidId
  );
}
