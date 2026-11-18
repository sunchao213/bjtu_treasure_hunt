import { ITEM_DEFINITIONS, itemValueFor } from '../../config/game-config';

interface WarehouseIcon {
  readonly path: string;
  readonly color: string;
}

// Legacy silhouette metadata identifies supported items. Runtime artwork uses
// shared artwork assets for warehouse tiles, details and the gallery.
const ICONS: Readonly<Record<string, WarehouseIcon>> = {
  'scratch-paper': {
    path: 'M15 8H42L50 16V56H15Z M42 8V17H50 M22 27H42 M22 35H42 M22 43H36 M19 51L27 43',
    color: '#d9d4b8',
  },
  'half-eraser': { path: 'M10 39L34 15L55 36L34 57H22Z M23 26L44 47 M34 57H54', color: '#e49a9a' },
  'portable-medkit': {
    path: 'M10 20H54V54H10Z M22 20V13H42V20 M27 28H37V35H44V43H37V50H27V43H20V35H27Z',
    color: '#e48d85',
  },
  'torn-notebook': {
    path: 'M16 8H45L50 15L46 21L51 27L47 34L52 41L48 56H16Z M25 9V16 M26 27H42 M26 36H39 M26 45H43',
    color: '#c5a5e8',
  },
  'window-seat': {
    path: 'M16 10H48V32H16Z M12 37H52L47 44H17Z M17 44V55 M47 44V55 M22 16V27 M32 16V27 M42 16V27',
    color: '#8ebdd6',
  },
  'morning-coffee': {
    path: 'M14 22H43V45Q43 54 34 54H23Q14 54 14 45Z M43 27H49Q57 27 53 37Q51 41 43 41 M22 10V16 M30 8V16 M38 11V16',
    color: '#d5a06e',
  },
  'school-badge': {
    path: 'M32 7L39 19L53 22L44 33L45 49L32 44L19 51L20 34L10 23L25 19Z M27 27L32 24L37 28V35L32 39L27 35Z M25 51L22 59 M39 50L42 59',
    color: '#e5c36b',
  },
  'anomalous-feather': {
    path: 'M12 55L47 13 M18 47Q8 29 31 13Q44 5 54 10Q59 26 42 43Q30 54 18 47Z M24 40L23 24 M32 32L47 27 M37 25L39 16',
    color: '#81c9c0',
  },
  'gpa-charm': {
    path: 'M32 8L52 20V44L32 56L12 44V20Z M22 40L27 29L32 40L37 24L42 40 M22 45H42',
    color: '#d4a3f2',
  },
  'library-reward-ticket': {
    path: 'M13 16H51V25Q44 32 51 39V49H13V39Q20 32 13 25Z M23 24H40 M23 32H36 M23 40H39 M46 21V25 M46 40V44',
    color: '#efbd79',
  },
  'siyuan-key': {
    path: 'M25 10A15 15 0 1 0 25 40A15 15 0 1 0 25 10Z M25 19A6 6 0 1 0 25 31A6 6 0 1 0 25 19Z M37 36L54 53 M45 44L51 38 M50 49L56 43',
    color: '#f0d784',
  },
  'training-bat': {
    path: 'M12 53L18 47L38 27Q44 16 50 12Q55 9 57 14Q59 20 52 25Q47 29 38 31L22 52L17 57Z M21 43L27 49 M27 37L33 43',
    color: '#c79c73',
  },
  'stun-baton': {
    path: 'M22 13H42V40L46 45V54H18V45L22 40Z M26 21H38 M27 29L37 25L29 35L38 32 M25 48H39',
    color: '#8ed0df',
  },
  bandage: {
    path: 'M12 32Q12 24 20 24H44Q52 24 52 32Q52 40 44 40H20Q12 40 12 32Z M22 27V37 M28 27V37 M34 27V37 M40 27V37',
    color: '#f0b8a1',
  },
  'yellow-bike': {
    path: 'M15 39A9 9 0 1 0 33 39A9 9 0 1 0 15 39Z M39 39A9 9 0 1 0 57 39A9 9 0 1 0 39 39Z M24 39L33 23L42 39H24L37 29 M30 23H36 M42 23H47',
    color: '#e5d36b',
  },
  'thick-down-jacket': {
    path: 'M23 12L32 18L41 12L52 21L47 34L43 31V54H21V31L17 34L12 21Z M23 12L26 22L32 18L38 22L41 12 M32 18V54 M22 34H27 M37 34H42 M22 43H27 M37 43H42',
    color: '#a8c7ed',
  },
  'strange-veined-ginkgo-leaf': {
    path: 'M32 56Q13 48 12 30Q25 9 43 19Q56 31 48 48Q42 57 32 56Z M32 56L32 25 M32 39L21 28 M32 45L44 34',
    color: '#f0c85f',
  },
  'hunter-binoculars': {
    path: 'M10 18H24L30 34H34L40 18H54V28L47 52H36L32 42L28 52H17L10 28Z M19 28A8 8 0 1 0 19 44A8 8 0 1 0 19 28Z M45 28A8 8 0 1 0 45 44A8 8 0 1 0 45 28Z',
    color: '#9cae9a',
  },
  'roller-skates': {
    path: 'M10 17H39L47 28V40H25L21 50H13L18 38H10Z M25 50H53 M28 50A4 4 0 1 0 28 58A4 4 0 1 0 28 50Z M45 50A4 4 0 1 0 45 58A4 4 0 1 0 45 50Z',
    color: '#d4d9e6',
  },
  'marked-campus-map': {
    path: 'M8 16L24 10L40 16L56 10V48L40 54L24 48L8 54Z M24 10V48 M40 16V54 M29 29L35 35 M35 29L29 35',
    color: '#d9d4b8',
  },
  'soothe-charm': {
    path: 'M24 8H40V16L48 24V53H16V24L24 16Z M24 8L32 3L40 8 M24 30Q24 24 32 30Q40 24 40 30Q40 36 32 42Q24 36 24 30 M32 53V60',
    color: '#c2a2ee',
  },
  'complete-record': {
    path: 'M10 12H28L32 16L36 12H54V52H36L32 56L28 52H10Z M32 16V56 M17 23H25 M17 31H25 M39 23H47 M39 31H47 M38 41L42 45L49 37',
    color: '#f3ce81',
  },
  'electric-bike-helmet': {
    path: 'M16 36L20 20H44L48 36V52H16Z M23 20V14H41V20 M22 36H42 M25 44H39',
    color: '#9aa69d',
  },
  'david-head-statue': {
    path: 'M23 10H41L46 18L43 31L48 40V54H16V40L21 31L18 18Z M25 22H39 M27 31H37 M24 44H40',
    color: '#9aa69d',
  },
  'silver-watch': {
    path: 'M25 8H39V18H45V46H39V56H25V46H19V18H25Z M24 22H40V42H24Z M28 27H36V37H28Z',
    color: '#9aa69d',
  },
};

export interface WarehouseItemDetails {
  readonly name: string;
  readonly category: string;
  readonly rarity: string;
  readonly value: number | null;
  readonly bagSlots: number;
  readonly description: string;
}

const CATEGORY_NAMES: Readonly<Record<string, string>> = {
  collectible: '价值收藏',
  healing: '恢复道具',
  quest: '任务线索',
  weapon: '武器装备',
  utility: '辅助道具',
};
const RARITY_NAMES: Readonly<Record<string, string>> = {
  pending: '待定',
  common: '普通',
  uncommon: '稀有',
  epic: '史诗',
  legendary: '传说',
};
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  'portable-medkit': '使用后恢复 15 点生命；满血时无法使用。',
  'torn-notebook': '思源楼前固定宝箱中的主线线索；调查明湖石碑后携带本局手记撤离可解锁第一章。',
  'morning-coffee': '使用后恢复 25 点生命；满血时无法使用。',
  'anomalous-feather': '第一章主线证据；与残缺手记共同构成明湖边的异常记录。',
  'marked-campus-map': '第二章任务证据；在中央教学楼公告栏调查后取得，再去寻找思源楼金钥匙。',
  'soothe-charm': '第三章任务证据；在芳华园发现，持有时可继续寻找完整记录。',
  'complete-record': '第三章任务证据；与本局安抚护符一起带回可解锁第三章。',
  'electric-bike-helmet': '使用后获得 15 点护盾，持续 5 秒。',
  'david-head-statue': '大卫头雕像，史诗收藏物；没有额外使用效果。',
  'silver-watch': '银色手表，传说收藏物；没有额外使用效果。',
  'training-bat': '近身攻击装备，携带时可以攻击敌人。',
  'stun-baton': '可使用 15 次，命中后短暂击晕敌人。',
  bandage: '使用后恢复 10 点生命。',
  'yellow-bike': '使用后移动速度提升 30%，持续 5 秒。',
  'thick-down-jacket': '使用后获得 30 点护盾，持续 5 秒。',
  'strange-veined-ginkgo-leaf': '叶脉纹路异常的校园传说收藏物，计入本局携带价值。',
  'hunter-binoculars': '留有探索痕迹的史诗收藏物，计入本局携带价值。',
  'roller-skates': '使用后移动速度提升 15%，持续 5 秒。',
};

export function warehouseItemIcon(itemId: string): WarehouseIcon | null {
  return ICONS[itemId] ?? null;
}

export function warehouseItemIconIds(): readonly string[] {
  return Object.keys(ICONS);
}

/** Public artwork used by warehouse tiles and the item detail dialog. */
export function warehouseItemIconAssetPath(itemId: string): string | null {
  if (!ICONS[itemId]) return null;
  return `/assets/items/icons/${encodeURIComponent(itemId)}.png`;
}

export function warehouseItemDetails(itemId: string): WarehouseItemDetails | null {
  const item = ITEM_DEFINITIONS[itemId];
  if (!item) return null;
  return {
    name: item.name,
    category: CATEGORY_NAMES[item.kind] ?? '道具',
    rarity: RARITY_NAMES[item.rarity] ?? item.rarity,
    value: itemValueFor(item),
    bagSlots: item.bagSlots ?? 1,
    description: DESCRIPTIONS[itemId] ?? '探索中发现并成功撤离后保存在仓库。',
  };
}

export function warehouseItemIconSvg(itemId: string): string {
  const src = warehouseItemIconAssetPath(itemId);
  if (!src) return '';
  return `<img src="${src}" alt="" aria-hidden="true" decoding="async" draggable="false" />`;
}

export function areWarehouseIconsUnique(
  itemIds: readonly string[] = warehouseItemIconIds(),
): boolean {
  const paths = itemIds.map((id) => ICONS[id]?.path);
  return paths.every(Boolean) && new Set(paths).size === paths.length;
}
