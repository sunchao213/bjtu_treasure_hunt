import { describe, expect, it } from 'vitest';
import {
  validateInventoryModel,
  type InventoryModel,
} from '../../src/modules/inventory/inventory-model';
import type { ItemInstance } from '../../src/shared/types/game';

const item = (instanceId: string): ItemInstance => ({
  instanceId,
  itemId: 'training-bat',
  origin: { kind: 'carry-in' },
});

const model = (
  items: readonly ItemInstance[],
  placements: InventoryModel['placementByInstanceId'],
): InventoryModel => ({
  itemsByInstanceId: Object.fromEntries(items.map((instance) => [instance.instanceId, instance])),
  placementByInstanceId: placements,
});

describe('normalized inventory model invariants', () => {
  it('allows a bag instance and equipment references without duplicating the entity', () => {
    expect(
      validateInventoryModel(
        model([item('bag-1'), item('weapon-1')], {
          'bag-1': { kind: 'bag', index: 0 },
          'weapon-1': { kind: 'equipment', slotId: 'weapon' },
        }),
        6,
      ),
    ).toBeNull();
  });

  it('rejects missing or orphan placements', () => {
    expect(validateInventoryModel(model([item('one')], {}), 6)).toBe('MISSING_PLACEMENT');
    expect(
      validateInventoryModel(model([], { ghost: { kind: 'equipment', slotId: 'weapon' } }), 6),
    ).toBe('ORPHAN_PLACEMENT');
  });

  it('rejects duplicate bag indexes, equipment slots, and capacity overflow', () => {
    expect(
      validateInventoryModel(
        model([item('one'), item('two')], {
          one: { kind: 'bag', index: 0 },
          two: { kind: 'bag', index: 0 },
        }),
        6,
      ),
    ).toBe('DUPLICATE_BAG_INDEX');
    expect(
      validateInventoryModel(
        model([item('one'), item('two')], {
          one: { kind: 'equipment', slotId: 'weapon' },
          two: { kind: 'equipment', slotId: 'weapon' },
        }),
        6,
      ),
    ).toBe('DUPLICATE_EQUIPMENT_SLOT');
    expect(
      validateInventoryModel(
        model([item('one'), item('two')], {
          one: { kind: 'bag', index: 0 },
          two: { kind: 'bag', index: 1 },
        }),
        1,
      ),
    ).toBe('BAG_CAPACITY_EXCEEDED');
  });

  it('rejects mismatched instance keys and invalid placement values', () => {
    expect(
      validateInventoryModel(
        {
          ...model([item('one')], { one: { kind: 'bag', index: 0 } }),
          itemsByInstanceId: { wrong: item('one') },
        },
        6,
      ),
    ).toBe('INSTANCE_KEY_MISMATCH');
    expect(
      validateInventoryModel(model([item('one')], { one: { kind: 'bag', index: -1 } }), 6),
    ).toBe('INVALID_BAG_INDEX');
    expect(
      validateInventoryModel(model([item('one')], { one: { kind: 'equipment', slotId: ' ' } }), 6),
    ).toBe('INVALID_EQUIPMENT_SLOT');
  });
});
