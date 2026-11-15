import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { ALL_ITEM_IDS } from '../../src/config/game-config';
import {
  areWarehouseIconsUnique,
  warehouseItemDetails,
  warehouseItemIcon,
  warehouseItemIconIds,
  warehouseItemIconAssetPath,
} from '../../src/modules/ui/warehouse-items';

describe('warehouse item tiles', () => {
  it('defines a distinct icon for every known item', () => {
    expect(warehouseItemIconIds()).toHaveLength(ALL_ITEM_IDS.length);
    expect(areWarehouseIconsUnique()).toBe(true);
    for (const itemId of warehouseItemIconIds()) expect(warehouseItemIcon(itemId)).not.toBeNull();
  });

  it('ships exactly one PNG for every supported item', () => {
    const files = readdirSync(new URL('../../public/assets/items/icons/', import.meta.url))
      .filter((file) => file.endsWith('.png') && file !== 'item-icons-overview.png')
      .sort();
    expect(files).toEqual(
      warehouseItemIconIds()
        .map((id) => `${id}.png`)
        .sort(),
    );
    for (const id of warehouseItemIconIds()) {
      expect(warehouseItemIconAssetPath(id)).toBe(`/assets/items/icons/${id}.png`);
    }
    expect(warehouseItemIconAssetPath('campus-map')).toBeNull();
  });

  it('provides useful item attributes for the details dialog', () => {
    expect(warehouseItemDetails('morning-coffee')).toMatchObject({
      name: '早八不困咖啡',
      category: '恢复道具',
      rarity: '稀有',
      value: 25,
      bagSlots: 1,
    });
    expect(warehouseItemDetails('yellow-bike')).toMatchObject({
      name: '小黄车',
      category: '辅助道具',
      value: 10,
      bagSlots: 2,
    });
    expect(warehouseItemDetails('unknown')).toBeNull();
  });
});
