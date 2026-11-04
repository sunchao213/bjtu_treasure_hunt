import type { Rect } from '../shared/types/game';

import geometry from './campus-geometry.json';

// Shared with the room server for collision, movement and spawn coordinates.
const { buildings, lake } = geometry;
const sportsFields = [
  { x: 380, y: 200, width: 360, height: 500, name: '西侧运动场' },
  { x: 2460, y: 870, width: 380, height: 300, name: '东侧运动场' },
];

export const WORLD = {
  ...geometry,
  extraction: { x: 1220, y: 2100, width: 200, height: 150 },
  buildings,
  lake,
  sportsFields,
  stone: { x: 1940, y: 1240 },
  garden: { x: 1940, y: 1390, width: 340, height: 230, name: '芳华园' },
  obstacles: [...buildings, lake] satisfies Rect[],
  roads: [
    { x: 160, y: 750, width: 3100, height: 85 },
    { x: 160, y: 1280, width: 3200, height: 85 },
    { x: 260, y: 1670, width: 3100, height: 85 },
    { x: 280, y: 2040, width: 3080, height: 70 },
    { x: 1130, y: 120, width: 90, height: 1960 },
    { x: 1275, y: 1365, width: 90, height: 880 },
    { x: 1600, y: 120, width: 80, height: 1190 },
    { x: 1760, y: 835, width: 60, height: 1210 },
    { x: 2060, y: 430, width: 50, height: 880 },
    { x: 2340, y: 1100, width: 80, height: 940 },
    { x: 2780, y: 1365, width: 80, height: 675 },
    { x: 3220, y: 750, width: 80, height: 1400 },
  ] satisfies Rect[],
  gates: [
    { x: 1320, y: 2230, name: '南门 · 撤离点', role: 'extraction' as const },
    { x: 170, y: 790, name: '西门 · 地标', role: 'landmark' as const },
    { x: 3280, y: 1320, name: '东门 · 地标', role: 'landmark' as const },
    { x: 3260, y: 2090, name: '东南门 · 地标', role: 'landmark' as const },
  ],
  lamps: [
    { x: 1320, y: 1970, radius: 170 },
    { x: 1170, y: 1300, radius: 145 },
    { x: 2070, y: 1200, radius: 145 },
    { x: 1170, y: 790, radius: 145 },
    { x: 2800, y: 1700, radius: 145 },
  ],
  enemyRoutes: [
    {
      id: 'west',
      kind: 'patrol' as const,
      route: [
        { x: 450, y: 790 },
        { x: 990, y: 790 },
      ],
    },
    {
      id: 'north',
      kind: 'patrol' as const,
      route: [
        { x: 1650, y: 790 },
        { x: 2760, y: 790 },
      ],
    },
    {
      id: 'lake',
      kind: 'patrol' as const,
      route: [
        { x: 1790, y: 860 },
        { x: 1790, y: 1210 },
        { x: 2070, y: 1210 },
        { x: 2070, y: 860 },
      ],
    },
    {
      id: 'east',
      kind: 'patrol' as const,
      route: [
        { x: 2800, y: 1470 },
        { x: 2800, y: 1970 },
      ],
    },
    {
      id: 'south',
      kind: 'patrol' as const,
      route: [
        { x: 1530, y: 1710 },
        { x: 2260, y: 1710 },
      ],
    },
    { id: 'west-dorm', kind: 'patrol' as const, route: [{ x: 720, y: 1320 }] },
    { id: 'north-teaching', kind: 'patrol' as const, route: [{ x: 1620, y: 450 }] },
    { id: 'east-labs', kind: 'patrol' as const, route: [{ x: 3000, y: 700 }] },
    { id: 'siyuan', kind: 'patrol' as const, route: [{ x: 1600, y: 1200 }] },
    { id: 'south-teaching', kind: 'patrol' as const, route: [{ x: 2000, y: 1800 }] },
    { id: 'hug', kind: 'hug' as const, route: [{ x: 1580, y: 1240 }] },
    { id: 'hug-west', kind: 'hug' as const, route: [{ x: 920, y: 880 }] },
    { id: 'hug-east', kind: 'hug' as const, route: [{ x: 2320, y: 1320 }] },
    { id: 'hug-south', kind: 'hug' as const, route: [{ x: 2450, y: 1200 }] },
  ],
  lootZones: [
    { id: 'south', x: 1110, y: 1790, width: 660, height: 220 },
    { id: 'dorm', x: 290, y: 1250, width: 770, height: 160 },
    { id: 'west-sports', x: 320, y: 200, width: 470, height: 530 },
    { id: 'gym', x: 780, y: 190, width: 320, height: 530 },
    { id: 'north', x: 1260, y: 150, width: 750, height: 570 },
    { id: 'labs', x: 2120, y: 150, width: 790, height: 580 },
    { id: 'siyuan', x: 1240, y: 820, width: 460, height: 420 },
    { id: 'library', x: 2090, y: 790, width: 350, height: 480 },
    { id: 'lake', x: 1825, y: 1190, width: 250, height: 70 },
    { id: 'east-sports', x: 2440, y: 840, width: 460, height: 410 },
    { id: 'garden', x: 1880, y: 1410, width: 400, height: 220 },
    { id: 'southeast', x: 2440, y: 1640, width: 730, height: 160 },
  ],
};
