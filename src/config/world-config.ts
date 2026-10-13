import type { Rect } from '../shared/types/game';
import { assertKnownItemId } from './game-config';

// Based on the team's hand-drawn Haidian main-campus map; footprints are simplified for play.
const buildings = [
  { x: 370, y: 280, width: 220, height: 145, name: '图书馆', sub: 'LIBRARY', color: 0xb1bec4 },
  { x: 695, y: 630, width: 230, height: 115, name: '思源楼', sub: 'SIYUAN', color: 0xa4b3bc },
  { x: 130, y: 445, width: 145, height: 95, name: '教学楼群', sub: 'TEACHING', color: 0xbb9c87 },
  { x: 310, y: 600, width: 170, height: 100, name: '教学楼群', sub: 'TEACHING', color: 0xbaab91 },
  { x: 885, y: 170, width: 150, height: 90, name: '实验楼群', sub: 'LABS', color: 0xb1b3a1 },
  { x: 1030, y: 440, width: 150, height: 110, name: '教学楼群', sub: 'TEACHING', color: 0xb99f90 },
];
const lake = { x: 710, y: 315, width: 130, height: 125 };
const sports = { x: 120, y: 110, width: 200, height: 215 };

export const WORLD = {
  width: 1280,
  height: 900,
  playerRadius: 13,
  playerSpeed: 220,
  spawn: { x: 625, y: 800 },
  extraction: { x: 535, y: 780, width: 180, height: 80 },
  buildings,
  lake,
  sports,
  obstacles: [...buildings, lake] satisfies Rect[],
  roads: [
    { x: 55, y: 350, width: 300, height: 55 },
    { x: 325, y: 80, width: 45, height: 675 },
    { x: 600, y: 205, width: 70, height: 640 },
    { x: 85, y: 550, width: 925, height: 45 },
    { x: 275, y: 750, width: 760, height: 45 },
    { x: 610, y: 265, width: 555, height: 40 },
    { x: 850, y: 270, width: 55, height: 360 },
    { x: 945, y: 590, width: 55, height: 205 },
    { x: 950, y: 375, width: 245, height: 40 },
  ] satisfies Rect[],
  gates: [
    { x: 625, y: 837, name: '南门 · 撤离点', role: 'extraction' as const },
    { x: 85, y: 375, name: '西门 · 地标', role: 'landmark' as const },
    { x: 1130, y: 285, name: '东门 · 地标', role: 'landmark' as const },
    { x: 1165, y: 395, name: '东南门 · 地标', role: 'landmark' as const },
  ],
  lamps: [
    { x: 625, y: 710, radius: 165 },
    { x: 335, y: 555, radius: 130 },
    { x: 875, y: 330, radius: 120 },
  ],
  enemyRoutes: [
    {
      id: 'west',
      kind: 'patrol' as const,
      route: [
        { x: 300, y: 500 },
        { x: 340, y: 450 },
      ],
    },
    {
      id: 'east',
      kind: 'patrol' as const,
      route: [
        { x: 1030, y: 370 },
        { x: 1160, y: 370 },
      ],
    },
    {
      id: 'south',
      kind: 'patrol' as const,
      route: [
        { x: 1030, y: 660 },
        { x: 1150, y: 700 },
      ],
    },
    { id: 'hug', kind: 'hug' as const, route: [{ x: 640, y: 470 }] },
  ],
  searchPoints: [
    { id: 'library-west', x: 335, y: 300, itemId: 'window-seat' },
    { id: 'library-east', x: 555, y: 470, itemId: 'torn-notebook' },
    { id: 'lake-west', x: 665, y: 360, itemId: 'morning-coffee' },
    { id: 'lake-east', x: 875, y: 425, itemId: 'school-badge' },
    { id: 'lake-clue', x: 790, y: 480, itemId: 'anomalous-feather' },
    { id: 'siyuan-south', x: 805, y: 775, itemId: 'window-seat' },
    { id: 'siyuan-east', x: 965, y: 690, itemId: 'school-badge' },
    { id: 'garden-west', x: 250, y: 740, itemId: 'morning-coffee' },
    { id: 'garden-east', x: 1120, y: 615, itemId: 'school-badge' },
  ],
};

for (const point of WORLD.searchPoints) {
  assertKnownItemId(point.itemId);
}
