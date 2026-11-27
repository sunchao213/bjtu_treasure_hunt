import { describe, expect, it } from 'vitest';
import { ITEM_DEFINITIONS, PURCHASE_ITEM_IDS } from '../../src/config/game-config';
import { warehouseItemDetails } from '../../src/modules/ui/warehouse-items';
import {
  SHOP_EFFECTS,
  SHOP_SUPPORT_ITEM_IDS,
  SHOP_WEAPON_ITEM_IDS,
  bindShopCategories,
  shopMarkup,
} from '../../src/modules/ui/shop';

describe('shop categories and ordering', () => {
  it('sorts weapons by purchase price from high to low', () => {
    const prices = SHOP_WEAPON_ITEM_IDS.map((itemId) => ITEM_DEFINITIONS[itemId]!.price!);

    expect(prices).toEqual([...prices].sort((left, right) => right - left));
    expect(SHOP_WEAPON_ITEM_IDS).toEqual([
      'night-watch-spear',
      'window-breaker',
      'folding-ruler',
      'stun-baton',
      'long-broom',
      'training-bat',
    ]);
  });

  it('shows the configured weapon damage, durability and values in item details', () => {
    const descriptions = [
      ['training-bat', 10, '100 次后报废', 10],
      ['folding-ruler', 20, '100 次后报废', 20],
      ['long-broom', 15, '100 次后报废', 25],
      ['stun-baton', 25, '100 次后报废', 25],
      ['window-breaker', 35, '100 次后报废', 90],
      ['night-watch-spear', 85, '100 次后报废', 200],
    ] as const;

    expect(ITEM_DEFINITIONS['long-broom']?.price).toBe(25);
    expect(ITEM_DEFINITIONS['stun-baton']).toMatchObject({ price: 40, rarity: 'uncommon' });

    for (const [itemId, damage, durability, value] of descriptions) {
      expect(SHOP_EFFECTS[itemId]).toContain(`伤害 ${damage}`);
      expect(SHOP_EFFECTS[itemId]).toContain(durability);
      expect(warehouseItemDetails(itemId)?.value).toBe(value);
      expect(warehouseItemDetails(itemId)?.description).toContain(`伤害 ${damage}`);
    }
  });

  it('puts every purchasable item in exactly one category and renders category buttons', () => {
    const markup = shopMarkup();
    const categorizedItems = [...SHOP_WEAPON_ITEM_IDS, ...SHOP_SUPPORT_ITEM_IDS];
    const renderedItems = [...markup.matchAll(/data-shop-item="([^"]+)"/g)].map(
      ([, itemId]) => itemId,
    );

    expect(new Set(categorizedItems).size).toBe(PURCHASE_ITEM_IDS.length);
    expect(categorizedItems).toHaveLength(PURCHASE_ITEM_IDS.length);
    expect(renderedItems).toEqual(categorizedItems);
    expect(markup).toContain('data-shop-category="weapons"');
    expect(markup).toContain('data-shop-category="support"');
    expect(markup).toContain('data-shop-category="skins"');
    expect(markup).toContain('id="shop-weapons"');
    expect(markup).toContain('data-shop-section="weapons"');
    expect(markup).toContain('id="shop-support"');
    expect(markup).toContain('data-shop-section="support" hidden');
    expect(markup).not.toContain('<p class="shop-effect">undefined</p>');
  });

  it('switches the visible section when a category button is activated', () => {
    const categories = ['weapons', 'support', 'skins'].map((shopCategory) => ({
      dataset: { shopCategory },
      attributes: new Map<string, string>(),
      onclick: null as ((event: MouseEvent) => unknown) | null,
      setAttribute(name: string, value: string) {
        this.attributes.set(name, value);
      },
    }));
    const sections = ['weapons', 'support', 'skins'].map((shopSection) => ({
      dataset: { shopSection },
      hidden: shopSection !== 'weapons',
    }));
    const status = { textContent: 'previous status' };
    const root = {
      querySelectorAll(selector: string) {
        return selector === '[data-shop-category]' ? categories : sections;
      },
      querySelector() {
        return status;
      },
    } as unknown as HTMLElement;

    bindShopCategories(root);
    categories[1]!.onclick?.({} as MouseEvent);

    expect(categories.map((category) => category.attributes.get('aria-pressed'))).toEqual([
      'false',
      'true',
      'false',
    ]);
    expect(sections.map((section) => section.hidden)).toEqual([true, false, true]);
    expect(status.textContent).toBe('');
  });
});
