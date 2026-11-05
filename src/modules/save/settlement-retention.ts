import type { ItemDefinition, ItemInstance, RaidRules } from '../../shared/types/game';

export interface SettlementRetention {
  readonly warehouse: ItemInstance[];
  readonly currency: number;
}

/**
 * Keep the newest copy of value-only collectibles as a memorial. Every older
 * copy is converted to 交子; items with a gameplay effect remain stackable.
 */
export function retainSettlementItems(
  existing: readonly ItemInstance[],
  incoming: readonly ItemInstance[],
  currency: number,
  definitions: Readonly<Record<string, ItemDefinition>>,
  values: RaidRules['values'],
): SettlementRetention {
  const warehouse = [...existing];
  let nextCurrency = Number.isSafeInteger(currency) && currency >= 0 ? currency : 0;
  const collectibleIndexes = new Map<string, number>();

  const add = (item: ItemInstance): void => {
    const definition = definitions[item.itemId];
    if (!definition || definition.kind !== 'collectible') {
      warehouse.push(structuredClone(item));
      return;
    }
    const previousIndex = collectibleIndexes.get(item.itemId);
    if (previousIndex !== undefined) {
      const previous = warehouse[previousIndex];
      if (previous) {
        nextCurrency += values[definitions[previous.itemId]!.rarity];
        warehouse.splice(previousIndex, 1);
        for (const [id, index] of collectibleIndexes) {
          if (index > previousIndex) collectibleIndexes.set(id, index - 1);
        }
      }
    }
    collectibleIndexes.set(item.itemId, warehouse.length);
    warehouse.push(structuredClone(item));
  };

  // Existing saves may predate duplicate conversion; normalize them too.
  warehouse.length = 0;
  for (const item of existing) add(item);
  for (const item of incoming) add(item);

  return { warehouse, currency: nextCurrency };
}
