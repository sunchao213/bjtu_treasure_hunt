import { describe, expect, it } from 'vitest';
import { movePlayer, contains } from '../../src/modules/world/movement';

const bounds = { x: 0, y: 0, width: 100, height: 100 };
describe('A world movement', () => {
  it('normalizes diagonals to the same speed', () => {
    const straight = movePlayer({ x: 20, y: 20 }, { x: 1, y: 0 }, 100, 100, 5, bounds, []);
    const diagonal = movePlayer({ x: 20, y: 20 }, { x: 1, y: 1 }, 100, 100, 5, bounds, []);
    expect(Math.hypot(diagonal.x - 20, diagonal.y - 20)).toBeCloseTo(straight.x - 20);
  });
  it('stays inside map bounds and cannot tunnel through a thin wall', () => {
    expect(movePlayer({ x: 92, y: 50 }, { x: 1, y: 0 }, 100, 200, 5, bounds, []).x).toBe(95);
    const point = movePlayer({ x: 20, y: 30 }, { x: 1, y: 0 }, 10_000, 600, 5, bounds, [
      { x: 40, y: 0, width: 2, height: 100 },
    ]);
    expect(point.x).toBeLessThanOrEqual(35);
  });
  it('recognizes extraction boundary', () => {
    expect(contains(bounds, { x: 100, y: 100 })).toBe(true);
    expect(contains(bounds, { x: 101, y: 50 })).toBe(false);
  });
});
