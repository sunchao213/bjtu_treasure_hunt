import { describe, expect, it } from 'vitest';
import layout from '../../assets-source/campus-3d/district/layout.json';

type Point = { x: number; y: number };
function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function inside(p: Point, polygon: Point[]) {
  let result = false;
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      result = !result;
  });
  return result;
}

describe('photo-referenced campus landmarks', () => {
  it('keeps both basketball surfaces outside every road and its seven-unit curb', () => {
    for (const court of layout.courts) {
      const corners = [
        { x: court.x, y: court.y },
        { x: court.x + court.width, y: court.y },
        { x: court.x + court.width, y: court.y + court.height },
        { x: court.x, y: court.y + court.height },
      ];
      for (const road of layout.roads.filter((r) => r.kind === 'road')) {
        road.points.slice(1).forEach((b, i) => {
          const a = road.points[i]!;
          // Sample the entire road segment, including diagonal connectors. A road
          // crossing the rectangle is detected even when all four corners are clear.
          for (let s = 0; s <= 100; s++) {
            const p = { x: a.x + ((b.x - a.x) * s) / 100, y: a.y + ((b.y - a.y) * s) / 100 };
            const dx = Math.max(court.x - p.x, 0, p.x - court.x - court.width);
            const dy = Math.max(court.y - p.y, 0, p.y - court.y - court.height);
            expect(Math.hypot(dx, dy), `${court.id} overlaps ${road.name}`).toBeGreaterThan(
              road.width / 2 + 7,
            );
          }
          for (const corner of corners)
            expect(segmentDistance(corner, a, b)).toBeGreaterThan(road.width / 2 + 7);
        });
      }
    }
  });

  it('uses the curved lake outline for water collision while leaving the library and road clear', () => {
    expect(layout.lake.length).toBeGreaterThan(40);
    const library = layout.buildings.find((b) => b.id === 'Library')!;
    expect(Math.max(...layout.lake.map((p) => p.x)) + 22).toBeLessThan(library.x);
    for (const cell of layout.waterObstacles)
      expect(inside({ x: cell.x + 8, y: cell.y + 8 }, layout.lake)).toBe(true);
    const pavilion = layout.lakeDetails.pavilion;
    expect(inside(pavilion, layout.lake)).toBe(true);
    const west = Math.min(...layout.lake.map((p) => p.x));
    expect(pavilion.x - west).toBeLessThan(100);
    const road = layout.roads.find((r) => r.name === '明湖路')!;
    expect(west - road.points[0]!.x).toBeGreaterThan(road.width / 2 + 7);
  });
});
