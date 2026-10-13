import type { ItemInstance } from '../../shared/types/game';

/**
 * A logical placement reference. Equipment slot IDs are data-driven because the product
 * specification does not yet define a final slot list.
 */
export type InventoryPlacement =
  | { readonly kind: 'bag'; readonly index: number }
  | { readonly kind: 'equipment'; readonly slotId: string };

/**
 * Normalized inventory model: each item instance is stored once and bag/equipment locations
 * refer to its instanceId. This model is not yet wired into the reference adapter.
 */
export interface InventoryModel {
  readonly itemsByInstanceId: Readonly<Record<string, ItemInstance>>;
  readonly placementByInstanceId: Readonly<Record<string, InventoryPlacement>>;
}

export type InventoryInvariantError =
  | 'INSTANCE_KEY_MISMATCH'
  | 'MISSING_PLACEMENT'
  | 'ORPHAN_PLACEMENT'
  | 'DUPLICATE_BAG_INDEX'
  | 'INVALID_BAG_INDEX'
  | 'DUPLICATE_EQUIPMENT_SLOT'
  | 'INVALID_EQUIPMENT_SLOT'
  | 'BAG_CAPACITY_EXCEEDED';

/** Returns the first structural invariant violation, or null when the model is valid. */
export function validateInventoryModel(
  model: InventoryModel,
  bagCapacity: number,
): InventoryInvariantError | null {
  if (!Number.isSafeInteger(bagCapacity) || bagCapacity < 0) {
    return 'BAG_CAPACITY_EXCEEDED';
  }

  const instanceIds = Object.keys(model.itemsByInstanceId);
  if (instanceIds.length !== Object.keys(model.placementByInstanceId).length) {
    return instanceIds.some((id) => !Object.hasOwn(model.placementByInstanceId, id))
      ? 'MISSING_PLACEMENT'
      : 'ORPHAN_PLACEMENT';
  }

  const bagIndexes = new Set<number>();
  const equipmentSlots = new Set<string>();
  let bagCount = 0;
  for (const instanceId of instanceIds) {
    const item = model.itemsByInstanceId[instanceId];
    if (!item || item.instanceId !== instanceId) {
      return 'INSTANCE_KEY_MISMATCH';
    }

    const placement = model.placementByInstanceId[instanceId];
    if (!placement) {
      return 'MISSING_PLACEMENT';
    }

    if (placement.kind === 'bag') {
      if (!Number.isSafeInteger(placement.index) || placement.index < 0) {
        return 'INVALID_BAG_INDEX';
      }
      if (bagIndexes.has(placement.index)) {
        return 'DUPLICATE_BAG_INDEX';
      }
      bagIndexes.add(placement.index);
      bagCount += 1;
      continue;
    }

    if (!placement.slotId.trim()) {
      return 'INVALID_EQUIPMENT_SLOT';
    }
    if (equipmentSlots.has(placement.slotId)) {
      return 'DUPLICATE_EQUIPMENT_SLOT';
    }
    equipmentSlots.add(placement.slotId);
  }

  return bagCount > bagCapacity ? 'BAG_CAPACITY_EXCEEDED' : null;
}
