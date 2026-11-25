import type { Point, Rect } from '../shared/types/game';
import layout from '../../assets-source/campus-3d/south-gate-layout.json';
import siyuan from '../../assets-source/campus-3d/siyuan/layout.json';
import district from '../../assets-source/campus-3d/district/layout.json';

export const UNITS_PER_METRE = layout.unitsPerMetre;
export const IS_DISTRICT =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('area') === 'district';
export const IS_SIYUAN =
  typeof location !== 'undefined' && new URLSearchParams(location.search).get('area') === 'siyuan';
export const TRIAL_NAMESPACE = IS_DISTRICT
  ? 'bjtu-campus-3d:district:v1:'
  : IS_SIYUAN
    ? 'bjtu-campus-3d:siyuan:v1:'
    : 'bjtu-campus-3d:v1:';
export const TRIAL_LOCK = IS_DISTRICT
  ? 'bjtu-campus-3d:district:save'
  : IS_SIYUAN
    ? 'bjtu-campus-3d:siyuan:save'
    : 'bjtu-campus-3d:save';
export const TRIAL_AUDIO_KEY = `${TRIAL_NAMESPACE}audio`;

export const toWorld = (point: Point) => ({
  x: point.x / UNITS_PER_METRE,
  z: point.y / UNITS_PER_METRE,
});
export const toMap = (x: number, z: number): Point => ({
  x: x * UNITS_PER_METRE,
  y: z * UNITS_PER_METRE,
});

const SOUTH_GATE_TREES = [
  { x: 96, y: 320, variant: 0 },
  { x: 96, y: 512, variant: 1 },
  { x: 256, y: 448, variant: 0 },
  { x: 352, y: 512, variant: 1 },
  { x: 736, y: 128, variant: 0 },
  { x: 928, y: 224, variant: 1 },
  { x: 832, y: 448, variant: 0 },
  { x: 928, y: 576, variant: 1 },
  { x: 128, y: 672, variant: 0 },
  { x: 768, y: 672, variant: 1 },
] as const;

export const BUILDING: Rect = layout.building;
export const GATE = layout.gate;
export const GUARDHOUSE: Rect = layout.guardhouse;
export interface TrialMap {
  id: string;
  width: number;
  height: number;
  bounds: Rect;
  spawn: Point;
  extraction: Rect;
  playerRadius: number;
  playerSpeed: number;
  obstacles: readonly Rect[];
  trees?: readonly Point[];
  chests: readonly (Point & { id: string; itemId: string })[];
}
export const SOUTH_GATE_MAP = {
  id: 'south-gate-trial',
  trees: SOUTH_GATE_TREES,
  width: 1024,
  height: 768,
  bounds: { x: 16, y: 16, width: 992, height: 736 },
  spawn: { x: 512, y: 600 },
  extraction: { x: 432, y: 656, width: 160, height: 80 },
  playerRadius: 8,
  playerSpeed: 145,
  obstacles: [
    BUILDING,
    GUARDHOUSE,
    ...SOUTH_GATE_TREES.map(({ x, y }) => ({ x: x - 12, y: y - 12, width: 24, height: 24 })),
    ...[-1, 1].map((side) => ({
      x: GATE.x + (side * GATE.width) / 2 - GATE.pillarWidth / 2,
      y: GATE.y - GATE.depth / 2,
      width: GATE.pillarWidth,
      height: GATE.depth,
    })),
  ] satisfies Rect[],
  chests: [
    { x: 416, y: 560 },
    { x: 640, y: 560 },
    { x: 224, y: 592 },
    { x: 768, y: 352 },
    { x: 512, y: 352 },
    { x: 224, y: 320 },
    { x: 608, y: 160 },
    { x: 864, y: 128 },
  ].map((point, index) => ({
    ...point,
    id: `south-gate-chest-${index + 1}`,
    itemId: ['school-badge', 'window-seat', 'morning-coffee'][index % 3]!,
  })),
} as const;

export const SIYUAN_MAP: TrialMap = {
  id: 'siyuan-reference-trial',
  trees: siyuan.trees,
  width: siyuan.width,
  height: siyuan.height,
  bounds: { x: 16, y: 16, width: siyuan.width - 32, height: siyuan.height - 32 },
  spawn: siyuan.spawn,
  extraction: siyuan.extraction,
  playerRadius: 8,
  playerSpeed: 145,
  obstacles: [
    ...siyuan.parts.map(({ x, y, width, height }) => ({ x, y, width, height })),
    ...siyuan.trees.map(({ x, y }) => ({ x: x - 8, y: y - 8, width: 16, height: 16 })),
  ],
  chests: siyuan.chests.map((point, i) => ({
    ...point,
    id: `siyuan-chest-${i + 1}`,
    itemId: ['school-badge', 'window-seat', 'morning-coffee'][i % 3]!,
  })),
};

export const DISTRICT_MAP: TrialMap = {
  id: district.id,
  trees: district.trees,
  width: district.width,
  height: district.height,
  bounds: { x: 16, y: 16, width: district.width - 32, height: district.height - 32 },
  spawn: district.spawn,
  extraction: district.extraction,
  playerRadius: 8,
  playerSpeed: 145,
  obstacles: district.obstacles,
  chests: district.chests.map((point, i) => ({
    ...point,
    id: `district-chest-${i + 1}`,
    itemId: ['school-badge', 'window-seat', 'morning-coffee'][i % 3]!,
  })),
};
export const TRIAL_MAP: TrialMap = IS_DISTRICT
  ? DISTRICT_MAP
  : IS_SIYUAN
    ? SIYUAN_MAP
    : SOUTH_GATE_MAP;
export const TREES = IS_DISTRICT ? district.trees : IS_SIYUAN ? siyuan.trees : SOUTH_GATE_TREES;
export const DISTRICT_LAYOUT = district;
export const DETAILED_CAMPUS = IS_SIYUAN || IS_DISTRICT;
export const SIYUAN_LAYOUT = siyuan;
export const CONTEXT_LANDMARKS = IS_SIYUAN ? siyuan.contextLandmarks : [];
export const AREA_NAME = IS_DISTRICT ? '南部校园' : IS_SIYUAN ? '思源楼' : '南门';
export const EXTRACTION_NAME = IS_DISTRICT ? '南门集合点' : IS_SIYUAN ? '银杏大道集合点' : '南门';
export const MODEL_URL = IS_DISTRICT
  ? 'assets/models/bjtu-district/district.glb'
  : IS_SIYUAN
    ? 'assets/models/bjtu-siyuan/siyuan.glb'
    : 'assets/models/bjtu-south-gate/south-gate.glb';
export const MAP_BUILDINGS = IS_DISTRICT
  ? district.buildings.flatMap((building) => building.blocks)
  : IS_SIYUAN
    ? siyuan.parts
    : [BUILDING, GUARDHOUSE];
export const MAP_ROADS = IS_DISTRICT
  ? [...district.roads, ...district.paths]
  : IS_SIYUAN
    ? siyuan.roads
    : [
        {
          name: '',
          width: 106,
          points: [
            { x: 512, y: 32 },
            { x: 512, y: 720 },
          ],
        },
        {
          name: '',
          width: 86,
          points: [
            { x: 80, y: 410 },
            { x: 944, y: 410 },
          ],
        },
        {
          name: '',
          width: 62,
          points: [
            { x: 200, y: 600 },
            { x: 830, y: 600 },
          ],
        },
        {
          name: '',
          width: 98,
          points: [
            { x: 228, y: 280 },
            { x: 228, y: 600 },
          ],
        },
        {
          name: '',
          width: 62,
          points: [
            { x: 754, y: 128 },
            { x: 754, y: 560 },
          ],
        },
      ];
