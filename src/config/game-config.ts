import type { ItemDefinition, ItemInstance, RaidRules } from '../shared/types/game';

export const RAID_RULES: RaidRules = {
  threshold: 100,
  durationMs: 600_000,
  extractionDurationMs: 5_000,
  searchDurationMs: 2_000,
  maxHealth: 100,
  bagCapacity: 6,
  values: { common: 10, uncommon: 25, epic: 60, legendary: 150 },
};

export const ITEM_DEFINITIONS: Readonly<Record<string, ItemDefinition>> = Object.fromEntries(
  [
    ['scratch-paper', '草稿纸', 'common', 'collectible'],
    ['half-eraser', '半块橡皮', 'common', 'collectible'],
    ['campus-map', '校园地图线索', 'common', 'collectible'],
    ['portable-medkit', '随身恢复包', 'common', 'healing'],
    ['torn-notebook', '残缺手记', 'uncommon', 'quest'],
    ['window-seat', '靠窗座凭证', 'uncommon', 'collectible'],
    ['morning-coffee', '早八不困咖啡', 'uncommon', 'healing'],
    ['school-badge', '校训徽章', 'uncommon', 'collectible'],
    ['anomalous-feather', '异常羽毛', 'epic', 'collectible'],
    ['gpa-charm', 'GPA 4.0 护符', 'epic', 'collectible'],
    ['library-reward-ticket', '图书馆奖励券', 'epic', 'collectible'],
    ['siyuan-key', '思源楼金钥匙', 'legendary', 'collectible'],
    ['soothe-charm', '安抚护符', 'epic', 'quest'],
    ['complete-record', '完整记录', 'legendary', 'quest'],
    ['training-bat', '训练棍', 'common', 'weapon'],
    ['stun-baton', '电击器', 'uncommon', 'weapon'],
    ['bandage', '创可贴', 'common', 'healing', 1, 10],
    ['yellow-bike', '小黄车', 'common', 'utility', 2, 50],
    ['thick-down-jacket', '超厚羽绒服', 'common', 'utility', 1, 100],
  ].map(([itemId, name, rarity, kind, bagSlots, price]) => {
    // Static configuration; the satisfies check belongs on the typed object below.
    const definition: ItemDefinition = {
      itemId: String(itemId ?? ''),
      name: String(name ?? ''),
      rarity: rarity as ItemDefinition['rarity'],
      kind: kind as ItemDefinition['kind'],
      ...(typeof bagSlots === 'number' ? { bagSlots } : {}),
      ...(typeof price === 'number' ? { price } : {}),
    };
    return [definition.itemId, definition];
  }),
);

/** Exploration discoveries that can be permanently recorded in the gallery. */
export const ITEM_CATALOG_IDS = [
  'scratch-paper',
  'half-eraser',
  'campus-map',
  'portable-medkit',
  'morning-coffee',
  'torn-notebook',
  'window-seat',
  'school-badge',
  'anomalous-feather',
  'gpa-charm',
  'library-reward-ticket',
  'siyuan-key',
  'soothe-charm',
  'complete-record',
] as const;

/** All known item IDs, including shop-only supplies, for save/config validation. */
export const ALL_ITEM_IDS = Object.keys(ITEM_DEFINITIONS) as readonly string[];

/** Items created by the shop are functional supplies, not exploration discoveries. */
export const PURCHASE_ITEM_IDS = ['bandage', 'yellow-bike', 'thick-down-jacket'] as const;

/** The production gallery contains discoveries; shop supplies stay in the warehouse only. */
export const EXPLORATION_CATALOG_IDS = ITEM_CATALOG_IDS.filter(
  (itemId) => !(PURCHASE_ITEM_IDS as readonly string[]).includes(itemId),
);

export function isPurchasedItem(
  item: Pick<ItemInstance, 'itemId' | 'instanceId' | 'origin'>,
): boolean {
  return (
    (PURCHASE_ITEM_IDS as readonly string[]).includes(item.itemId) ||
    (item.origin.kind === 'carry-in' && item.origin.source === 'purchase') ||
    item.instanceId.startsWith('purchase:')
  );
}

export function isExplorationItem(
  item: Pick<ItemInstance, 'itemId' | 'instanceId' | 'origin'>,
): boolean {
  return !isPurchasedItem(item);
}

/** Healing amounts are effects, not extraction values; values reflect current product rules. */
export const HEALING_AMOUNTS: Readonly<Record<string, number>> = {
  'portable-medkit': 30,
  'morning-coffee': 25,
  bandage: 10,
};

export type CatalogItemId = (typeof ITEM_CATALOG_IDS)[number];

export function isKnownItemId(itemId: string): itemId is keyof typeof ITEM_DEFINITIONS {
  return Object.hasOwn(ITEM_DEFINITIONS, itemId);
}

export function isCatalogItemId(itemId: string): itemId is CatalogItemId {
  return (ITEM_CATALOG_IDS as readonly string[]).includes(itemId);
}

export function assertKnownItemId(itemId: string): void {
  if (!isKnownItemId(itemId)) {
    throw new Error(`Unknown item definition: ${itemId}`);
  }
}

if (new Set(ITEM_CATALOG_IDS).size !== ITEM_CATALOG_IDS.length) {
  throw new Error('Duplicate item in product catalog');
}
for (const itemId of ITEM_CATALOG_IDS) {
  assertKnownItemId(itemId);
}
