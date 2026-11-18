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

  it('ships exactly one artwork asset for every supported item', () => {
    const files = readdirSync(new URL('../../public/assets/items/icons/', import.meta.url))
      .filter((file) => /\.(png|svg)$/.test(file) && file !== 'item-icons-overview.png')
      .sort();
    expect(files).toEqual(
      warehouseItemIconIds()
        .map((id) => warehouseItemIconAssetPath(id)!.split('/').at(-1))
        .sort(),
    );
    for (const id of warehouseItemIconIds()) {
      expect(warehouseItemIconAssetPath(id)).toMatch(
        new RegExp(`^/assets/items/icons/${id}\\.(png|svg)$`),
      );
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
      value: 30,
      bagSlots: 2,
    });
    expect(warehouseItemDetails('silver-watch')).toMatchObject({
      name: '银色手表',
      rarity: '传说',
      value: 100,
      description: '银色手表，传说收藏物；没有额外使用效果。',
    });
    expect(warehouseItemDetails('unknown')).toBeNull();
  });
});
