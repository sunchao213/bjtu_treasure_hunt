import type { ItemDefinition, ItemInstance, RaidRules } from '../shared/types/game';

export const RAID_RULES: RaidRules = {
  threshold: 100,
  durationMs: 600_000,
  extractionDurationMs: 5_000,
  searchDurationMs: 2_000,
  maxHealth: 100,
  bagCapacity: 6,
  values: { pending: 0, common: 10, uncommon: 25, epic: 60, legendary: 150 },
};

export const ITEM_DEFINITIONS: Readonly<Record<string, ItemDefinition>> = Object.fromEntries(
  [
    ['scratch-paper', '草稿纸', 'common', 'collectible'],
    ['half-eraser', '半块橡皮', 'common', 'collectible'],
    ['portable-medkit', '随身急救包', 'common', 'healing', undefined, undefined, 15],
    ['torn-notebook', '残缺手记', 'uncommon', 'quest'],
    ['window-seat', '靠窗座凭证', 'uncommon', 'collectible'],
    ['morning-coffee', '早八不困咖啡', 'uncommon', 'healing'],
    ['school-badge', '校训徽章', 'uncommon', 'collectible'],
    ['anomalous-feather', '异常羽毛', 'epic', 'collectible', undefined, undefined, 60],
    ['gpa-charm', 'GPA 4.0 护符', 'epic', 'collectible', undefined, undefined, 50],
    ['library-reward-ticket', '图书馆占座券', 'epic', 'collectible', undefined, undefined, 50],
    ['siyuan-key', '思源楼金钥匙', 'legendary', 'collectible'],
    ['strange-veined-ginkgo-leaf', '叶脉奇怪的银杏叶', 'legendary', 'collectible'],
    ['hunter-binoculars', '猎手望远镜', 'epic', 'collectible'],
    ['roller-skates', '轮滑鞋', 'common', 'utility', undefined, undefined, 15],
    ['marked-campus-map', '被涂改的校园地图', 'common', 'quest'],
    ['soothe-charm', '安抚护符', 'epic', 'quest'],
    ['complete-record', '完整记录', 'legendary', 'quest'],
    ['electric-bike-helmet', '电瓶车头盔', 'common', 'utility', undefined, undefined, 15],
    ['david-head-statue', '大卫头雕像', 'epic', 'collectible', undefined, undefined, 80],
    ['silver-watch', '银色手表', 'legendary', 'collectible', undefined, undefined, 100],
    ['training-bat', '训练棍', 'common', 'weapon'],
    ['stun-baton', '电击器', 'uncommon', 'weapon'],
    ['bandage', '创可贴', 'common', 'healing', 1, 10],
    ['yellow-bike', '小黄车', 'uncommon', 'utility', 2, 50, 30],
    ['thick-down-jacket', '超厚羽绒服', 'uncommon', 'utility', 1, 100, 30],
  ].map(([itemId, name, rarity, kind, bagSlots, price, value]) => {
    // Static configuration; the satisfies check belongs on the typed object below.
    const definition: ItemDefinition = {
      itemId: String(itemId ?? ''),
      name: String(name ?? ''),
      rarity: rarity as ItemDefinition['rarity'],
      kind: kind as ItemDefinition['kind'],
      ...(typeof bagSlots === 'number' ? { bagSlots } : {}),
      ...(typeof price === 'number' ? { price } : {}),
      ...(typeof value === 'number' || value === null ? { value } : {}),
    };
    return [definition.itemId, definition];
  }),
);

export function itemValueFor(
  definition: Pick<ItemDefinition, 'rarity' | 'value'>,
  values: RaidRules['values'] = RAID_RULES.values,
): number | null {
  return definition.value === null ? null : (definition.value ?? values[definition.rarity]);
}

/** Exploration discoveries that can be permanently recorded in the gallery. */
export const ITEM_CATALOG_IDS = [
  'scratch-paper',
  'half-eraser',
  'portable-medkit',
  'morning-coffee',
  'torn-notebook',
  'window-seat',
  'school-badge',
  'anomalous-feather',
  'gpa-charm',
  'library-reward-ticket',
  'siyuan-key',
  'strange-veined-ginkgo-leaf',
  'hunter-binoculars',
  'roller-skates',
  'marked-campus-map',
  'soothe-charm',
  'complete-record',
  'electric-bike-helmet',
  'david-head-statue',
  'silver-watch',
] as const;

/** All known item IDs, including shop-only supplies, for save/config validation. */
export const ALL_ITEM_IDS = Object.keys(ITEM_DEFINITIONS) as readonly string[];

/** Items created by the shop are functional supplies, not exploration discoveries. */
export const PURCHASE_ITEM_IDS = ['bandage', 'yellow-bike', 'thick-down-jacket'] as const;

/** Quest evidence belongs to its chapter's current raid and cannot be brought in. */
export function isCarryInAllowed(itemId: string): boolean {
  const kind = ITEM_DEFINITIONS[itemId]?.kind;
  return kind !== undefined && kind !== 'collectible' && kind !== 'quest';
}

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
  'portable-medkit': 15,
  'morning-coffee': 25,
  bandage: 10,
};

export const UTILITY_EFFECTS: Readonly<
  Record<string, { speedMultiplier?: number; shield?: number; durationMs: number }>
> = {
  'yellow-bike': { speedMultiplier: 1.3, durationMs: 5_000 },
  'roller-skates': { speedMultiplier: 1.15, durationMs: 5_000 },
  'thick-down-jacket': { shield: 30, durationMs: 5_000 },
  'electric-bike-helmet': { shield: 15, durationMs: 5_000 },
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
