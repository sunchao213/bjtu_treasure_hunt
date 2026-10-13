import type { ItemDefinition, RaidRules } from '../shared/types/game';

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
    ['torn-notebook', '残缺手记', 'uncommon', 'quest'],
    ['window-seat', '靠窗座凭证', 'uncommon', 'collectible'],
    ['morning-coffee', '早八不困咖啡', 'uncommon', 'healing'],
    ['school-badge', '校训徽章', 'uncommon', 'collectible'],
    ['anomalous-feather', '异常羽毛', 'epic', 'quest'],
    ['gpa-charm', 'GPA 4.0 护符', 'epic', 'collectible'],
    ['siyuan-key', '思源楼金钥匙', 'legendary', 'collectible'],
    ['training-bat', '训练棍', 'common', 'weapon'],
    ['stun-baton', '电击器', 'uncommon', 'weapon'],
  ].map(([itemId, name, rarity, kind]) => {
    // Static configuration; the satisfies check belongs on the typed object below.
    const definition: ItemDefinition = {
      itemId: itemId ?? '',
      name: name ?? '',
      rarity: rarity as ItemDefinition['rarity'],
      kind: kind as ItemDefinition['kind'],
    };
    return [definition.itemId, definition];
  }),
);
