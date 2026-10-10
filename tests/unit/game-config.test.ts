import { describe, expect, it } from 'vitest';
import {
  ITEM_CATALOG_IDS,
  ITEM_DEFINITIONS,
  assertKnownItemId,
  isCatalogItemId,
  isKnownItemId,
} from '../../src/config/game-config';
import { WORLD } from '../../src/config/world-config';

describe('product item catalog configuration', () => {
  it('contains 12 unique known codex definitions', () => {
    expect(ITEM_CATALOG_IDS).toHaveLength(12);
    expect(new Set(ITEM_CATALOG_IDS).size).toBe(12);
    for (const itemId of ITEM_CATALOG_IDS) {
      expect(isKnownItemId(itemId)).toBe(true);
      expect(isCatalogItemId(itemId)).toBe(true);
      expect(ITEM_DEFINITIONS[itemId]?.itemId).toBe(itemId);
    }
  });

  it('keeps support and weapon definitions outside the 12-item codex', () => {
    expect(isCatalogItemId('morning-coffee')).toBe(false);
    expect(isCatalogItemId('training-bat')).toBe(false);
    expect(isKnownItemId('morning-coffee')).toBe(true);
    expect(isKnownItemId('training-bat')).toBe(true);
  });

  it('rejects unknown definitions and accepts every configured search-point item', () => {
    expect(() => assertKnownItemId('missing-item')).toThrow('Unknown item definition');
    for (const point of WORLD.searchPoints) {
      expect(() => assertKnownItemId(point.itemId)).not.toThrow();
    }
  });
});
