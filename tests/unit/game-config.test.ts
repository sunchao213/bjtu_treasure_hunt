import { describe, expect, it } from 'vitest';
import {
  ITEM_CATALOG_IDS,
  ITEM_DEFINITIONS,
  assertKnownItemId,
  isCatalogItemId,
  isKnownItemId,
} from '../../src/config/game-config';
import { generateLootSpawns } from '../../src/modules/world/loot-spawns';

describe('product item catalog configuration', () => {
  it('contains every known item exactly once in the gallery', () => {
    expect(ITEM_CATALOG_IDS).toHaveLength(Object.keys(ITEM_DEFINITIONS).length);
    expect(new Set(ITEM_CATALOG_IDS).size).toBe(ITEM_CATALOG_IDS.length);
    for (const itemId of ITEM_CATALOG_IDS) {
      expect(isKnownItemId(itemId)).toBe(true);
      expect(isCatalogItemId(itemId)).toBe(true);
      expect(ITEM_DEFINITIONS[itemId]?.itemId).toBe(itemId);
    }
  });

  it('includes support items and weapons that can enter the permanent warehouse', () => {
    expect(isCatalogItemId('morning-coffee')).toBe(true);
    expect(isCatalogItemId('training-bat')).toBe(true);
    expect(isKnownItemId('morning-coffee')).toBe(true);
    expect(isKnownItemId('training-bat')).toBe(true);
  });

  it('rejects unknown definitions and accepts every configured search-point item', () => {
    expect(() => assertKnownItemId('missing-item')).toThrow('Unknown item definition');
    for (const point of generateLootSpawns(() => 0.5)) {
      expect(() => assertKnownItemId(point.itemId)).not.toThrow();
    }
  });
});
