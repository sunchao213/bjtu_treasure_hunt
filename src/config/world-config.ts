import type { Rect } from '../shared/types/game';

const buildings = [
  { x: 62, y: 224, width: 360, height: 348, name: '北京交通大学', sub: 'SIYUAN', color: 0xa4b3bc },
  { x: 505, y: 220, width: 300, height: 110, name: '北区教学楼', sub: 'TEACHING', color: 0xbb9c87 },
  { x: 502, y: 354, width: 310, height: 164, name: '思源东楼', sub: 'TEACHING', color: 0xbaab91 },
  { x: 526, y: 690, width: 268, height: 160, name: '教学楼', sub: 'TEACHING', color: 0xbb9c87 },
  { x: 448, y: 1334, width: 362, height: 286, name: '教学楼', sub: 'TEACHING', color: 0xbaab91 },
  { x: 970, y: 1362, width: 260, height: 188, name: '教学楼', sub: 'TEACHING', color: 0xbb9c87 },
];

const lake = { x: 934, y: 252, width: 280, height: 294 };
const sportsFields = [
  { x: 72, y: 610, width: 350, height: 615, name: '西侧草坪' },
  { x: 476, y: 900, width: 390, height: 390, name: '中心广场' },
  { x: 914, y: 620, width: 318, height: 570, name: '芳华园' },
];

// Approximate tree trunks/canopies from the supplied map. These blockers keep
// the playable lanes open while preventing the player and enemies from walking
// through the visible tree clusters.
const treeObstacles = [
  { x: 18, y: 18, width: 30, height: 34 },
  { x: 112, y: 18, width: 30, height: 34 },
  { x: 212, y: 18, width: 30, height: 34 },
  { x: 312, y: 18, width: 30, height: 34 },
  { x: 412, y: 18, width: 30, height: 34 },
  { x: 730, y: 18, width: 30, height: 34 },
  { x: 830, y: 18, width: 30, height: 34 },
  { x: 930, y: 18, width: 30, height: 34 },
  { x: 1030, y: 18, width: 30, height: 34 },
  { x: 1130, y: 18, width: 30, height: 34 },
  { x: 1208, y: 18, width: 30, height: 34 },
  { x: 95, y: 180, width: 32, height: 26 },
  { x: 190, y: 180, width: 32, height: 26 },
  { x: 285, y: 180, width: 32, height: 26 },
  { x: 540, y: 180, width: 32, height: 26 },
  { x: 650, y: 180, width: 32, height: 26 },
  { x: 760, y: 180, width: 32, height: 26 },
  { x: 970, y: 180, width: 32, height: 26 },
  { x: 1080, y: 180, width: 32, height: 26 },
  { x: 1180, y: 180, width: 32, height: 26 },
  { x: 100, y: 690, width: 34, height: 38 },
  { x: 300, y: 690, width: 34, height: 38 },
  { x: 970, y: 690, width: 34, height: 38 },
  { x: 1160, y: 690, width: 34, height: 38 },
  { x: 100, y: 1150, width: 34, height: 38 },
  { x: 300, y: 1150, width: 34, height: 38 },
  { x: 970, y: 1150, width: 34, height: 38 },
  { x: 1160, y: 1150, width: 34, height: 38 },
  { x: 90, y: 1330, width: 34, height: 38 },
  { x: 320, y: 1330, width: 34, height: 38 },
  { x: 970, y: 1330, width: 34, height: 38 },
  { x: 1160, y: 1330, width: 34, height: 38 },
];

const landmarkBaseObstacles = [
  { x: 222, y: 820, width: 80, height: 68 },
  { x: 584, y: 1132, width: 114, height: 112 },
  { x: 204, y: 1142, width: 130, height: 48 },
];

export const WORLD = {
  width: 1280,
  height: 1824,
  playerRadius: 8,
  playerSpeed: 145,
  spawn: { x: 235, y: 1682 },
  extraction: { x: 154, y: 1646, width: 164, height: 94 },
  buildings,
  lake,
  sportsFields,
  stone: { x: 1092, y: 970 },
  garden: { x: 940, y: 820, width: 286, height: 360, name: '芳华园' },
  treeObstacles,
  obstacles: [
    ...buildings,
    lake,
    ...treeObstacles,
    ...landmarkBaseObstacles,
    { x: 598, y: 970, width: 92, height: 274 },
    { x: 1070, y: 918, width: 50, height: 88 },
  ] satisfies Rect[],
  roads: [
    { x: 0, y: 78, width: 1280, height: 64 },
    { x: 0, y: 572, width: 1280, height: 66 },
    { x: 0, y: 1230, width: 1280, height: 64 },
    { x: 0, y: 1640, width: 1280, height: 78 },
    { x: 20, y: 140, width: 44, height: 1480 },
    { x: 422, y: 142, width: 46, height: 1494 },
    { x: 864, y: 142, width: 48, height: 1492 },
    { x: 1214, y: 142, width: 48, height: 1490 },
  ] satisfies Rect[],
  gates: [
    { x: 235, y: 1690, name: '南门 · 撤离点', role: 'extraction' as const },
    { x: 640, y: 90, name: '北门 · 地标', role: 'landmark' as const },
    { x: 232, y: 632, name: '校旗广场 · 地标', role: 'landmark' as const },
    { x: 646, y: 1080, name: '中心广场 · 地标', role: 'landmark' as const },
  ],
  lamps: [
    { x: 486, y: 296, radius: 58 },
    { x: 844, y: 296, radius: 58 },
    { x: 1096, y: 230, radius: 58 },
    { x: 486, y: 522, radius: 58 },
    { x: 844, y: 522, radius: 58 },
    { x: 70, y: 1200, radius: 58 },
    { x: 486, y: 1200, radius: 58 },
    { x: 844, y: 1200, radius: 58 },
    { x: 1228, y: 1200, radius: 58 },
    { x: 70, y: 1570, radius: 58 },
    { x: 420, y: 1570, radius: 58 },
    { x: 844, y: 1570, radius: 58 },
    { x: 1228, y: 1570, radius: 58 },
  ],
  enemyRoutes: [
    {
      id: 'west-lawn',
      kind: 'patrol' as const,
      route: [
        { x: 190, y: 790 },
        { x: 360, y: 790 },
        { x: 360, y: 1090 },
        { x: 300, y: 1090 },
        { x: 160, y: 1090 },
      ],
    },
    {
      id: 'north-road',
      kind: 'patrol' as const,
      route: [
        { x: 490, y: 610 },
        { x: 820, y: 610 },
      ],
    },
    {
      id: 'lake-path',
      kind: 'patrol' as const,
      route: [
        { x: 914, y: 570 },
        { x: 1220, y: 570 },
        { x: 1220, y: 800 },
      ],
    },
    {
      id: 'central-lawn',
      kind: 'patrol' as const,
      route: [
        { x: 560, y: 940 },
        { x: 720, y: 940 },
        { x: 720, y: 1260 },
        { x: 560, y: 1260 },
      ],
    },
    {
      id: 'south-road',
      kind: 'patrol' as const,
      route: [
        { x: 474, y: 1300 },
        { x: 850, y: 1300 },
      ],
    },
    { id: 'southwest', kind: 'patrol' as const, route: [{ x: 150, y: 1470 }] },
    { id: 'south-east', kind: 'patrol' as const, route: [{ x: 1090, y: 1280 }] },
    { id: 'west-hug', kind: 'hug' as const, route: [{ x: 320, y: 900 }] },
    { id: 'garden-hug', kind: 'hug' as const, route: [{ x: 1000, y: 760 }] },
    { id: 'statue-hug', kind: 'hug' as const, route: [{ x: 746, y: 1120 }] },
  ],
  lootZones: [
    { id: 'west-lawn', x: 82, y: 680, width: 310, height: 500 },
    { id: 'flag-lawn', x: 82, y: 1300, width: 310, height: 280 },
    { id: 'library', x: 478, y: 530, width: 360, height: 130 },
    { id: 'lake', x: 930, y: 560, width: 280, height: 80 },
    { id: 'central-lawn', x: 478, y: 880, width: 360, height: 350 },
    { id: 'east-garden', x: 930, y: 620, width: 280, height: 550 },
  ],
};
