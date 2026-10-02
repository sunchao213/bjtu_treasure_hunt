import type { ItemDefinition, ItemInstance, RaidRules } from '../../shared/types/game';

/** Pure calculation from authoritative carried instances and a per-raid rule snapshot. */
export function calculateExtractionValue(
  items: readonly ItemInstance[],
  raidId: string,
  definitions: Readonly<Record<string, ItemDefinition>>,
  values: RaidRules['values'],
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const item of items) {
    if (seen.has(item.instanceId)) {
      continue;
    }
    seen.add(item.instanceId);
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
