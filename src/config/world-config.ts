import type { Rect } from '../shared/types/game';
import { assertKnownItemId } from './game-config';

export const WORLD = {
  width: 1280,
  height: 900,
  playerRadius: 13,
  playerSpeed: 220,
  spawn: { x: 625, y: 750 },
  extraction: { x: 540, y: 735, width: 180, height: 110 },
  obstacles: [
    { x: 135, y: 120, width: 280, height: 155 },
    { x: 880, y: 100, width: 265, height: 175 },
    { x: 535, y: 270, width: 235, height: 240 },
    { x: 145, y: 555, width: 235, height: 105 },
    { x: 900, y: 580, width: 220, height: 90 },
  ] satisfies Rect[],
  searchPoints: [
    { id: 'library-west', x: 140, y: 335, itemId: 'window-seat' },
    { id: 'library-east', x: 410, y: 340, itemId: 'torn-notebook' },
    { id: 'lake-west', x: 435, y: 465, itemId: 'morning-coffee' },
    { id: 'lake-east', x: 830, y: 440, itemId: 'school-badge' },
    { id: 'siyuan-south', x: 920, y: 340, itemId: 'window-seat' },
    { id: 'siyuan-east', x: 1175, y: 400, itemId: 'school-badge' },
    { id: 'garden-west', x: 270, y: 720, itemId: 'morning-coffee' },
    { id: 'garden-east', x: 1060, y: 740, itemId: 'school-badge' },
  ],
};

for (const point of WORLD.searchPoints) {
  assertKnownItemId(point.itemId);
}
