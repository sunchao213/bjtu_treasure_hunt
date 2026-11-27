import { describe, expect, it } from 'vitest';
import {
  ALL_ITEM_IDS,
  ITEM_CATALOG_IDS,
  ITEM_DEFINITIONS,
  PURCHASE_ITEM_IDS,
  assertKnownItemId,
  HEALING_AMOUNTS,
  isCarryInAllowed,
  isCatalogItemId,
  isKnownItemId,
  isPurchasedItem,
} from '../../src/config/game-config';
import { generateLootSpawns, questSpawnPlan } from '../../src/modules/world/loot-spawns';
import { QUEST_CHAPTERS } from '../../src/modules/quests/quest-service';

describe('product item catalog configuration', () => {
  it('contains every known item exactly once in the gallery', () => {
    expect(ALL_ITEM_IDS).toHaveLength(Object.keys(ITEM_DEFINITIONS).length);
    expect(new Set(ITEM_CATALOG_IDS).size).toBe(ITEM_CATALOG_IDS.length);
    for (const itemId of ITEM_CATALOG_IDS) {
      expect(isKnownItemId(itemId)).toBe(true);
      expect(isCatalogItemId(itemId)).toBe(true);
      expect(ITEM_DEFINITIONS[itemId]?.itemId).toBe(itemId);
    }
  });

  it('includes support items and weapons that can enter the permanent warehouse', () => {
    expect(isCatalogItemId('morning-coffee')).toBe(true);
    expect(isCatalogItemId('training-bat')).toBe(false);
    expect(isKnownItemId('morning-coffee')).toBe(true);
    expect(isKnownItemId('training-bat')).toBe(true);
  });

  it('retires the unused campus-map collectible and retains the implemented medkit', () => {
    expect(isKnownItemId('campus-map')).toBe(false);
    expect(isCatalogItemId('campus-map')).toBe(false);
    expect(ITEM_DEFINITIONS['portable-medkit']?.kind).toBe('healing');
    expect(HEALING_AMOUNTS['portable-medkit']).toBe(15);
    expect(ITEM_DEFINITIONS['roller-skates']).toMatchObject({
      kind: 'utility',
      rarity: 'common',
      value: 15,
    });
    expect(ITEM_DEFINITIONS['electric-bike-helmet']).toMatchObject({
      kind: 'utility',
      rarity: 'common',
      value: 15,
    });
    expect(ITEM_DEFINITIONS['david-head-statue']).toMatchObject({ rarity: 'epic', value: 80 });
    expect(ITEM_DEFINITIONS['silver-watch']).toMatchObject({ rarity: 'legendary', value: 100 });
    expect(ITEM_DEFINITIONS['gpa-charm']).toMatchObject({ rarity: 'epic', value: 50 });
    expect(ITEM_DEFINITIONS['library-reward-ticket']).toMatchObject({ rarity: 'epic', value: 50 });
  });

  it('adds the seven functional discoveries to the shop at their item values', () => {
    const newShopItems = [
      ['portable-medkit', 15],
      ['morning-coffee', 25],
      ['roller-skates', 15],
      ['electric-bike-helmet', 15],
      ['star-compass', 150],
      ['silent-cloak', 60],
      ['reflective-filter', 30],
    ] as const;

    for (const [itemId, price] of newShopItems) {
      expect(PURCHASE_ITEM_IDS).toContain(itemId);
      expect(ITEM_DEFINITIONS[itemId]?.price).toBe(price);
    }
  });

  it('uses the current weapon extraction values from the item list', () => {
    expect(ITEM_DEFINITIONS['training-bat']?.value).toBe(10);
    expect(ITEM_DEFINITIONS['folding-ruler']?.value).toBe(20);
    expect(ITEM_DEFINITIONS['long-broom']?.value).toBe(25);
    expect(ITEM_DEFINITIONS['window-breaker']?.value).toBe(90);
    expect(ITEM_DEFINITIONS['night-watch-spear']?.value).toBe(200);
  });

  it('keeps newly shop-listed exploration items distinct from purchases when carried in', () => {
    const explorationItem = {
      instanceId: 'found-medkit',
      itemId: 'portable-medkit',
      origin: { kind: 'carry-in' as const, source: 'exploration' as const },
    };
    const purchaseItem = {
      instanceId: 'purchase:portable-medkit:one',
      itemId: 'portable-medkit',
      origin: { kind: 'carry-in' as const, source: 'purchase' as const },
    };

    expect(isPurchasedItem(explorationItem)).toBe(false);
    expect(isPurchasedItem(purchaseItem)).toBe(true);
  });

  it('keeps quest evidence in the warehouse but forbids bringing it into a raid', () => {
    expect(isCarryInAllowed('torn-notebook')).toBe(false);
    expect(isCarryInAllowed('complete-record')).toBe(false);
    expect(isCarryInAllowed('morning-coffee')).toBe(true);
    expect(isCarryInAllowed('missing-item')).toBe(false);
  });

  it('rejects unknown definitions and accepts every configured search-point item', () => {
    expect(() => assertKnownItemId('missing-item')).toThrow('Unknown item definition');
    for (const chapter of QUEST_CHAPTERS) {
      for (const point of generateLootSpawns(() => 0.5, questSpawnPlan(chapter.id))) {
        expect(() => assertKnownItemId(point.itemId)).not.toThrow();
      }
    }
  });
});
