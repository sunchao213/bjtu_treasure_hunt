import { describe, expect, it } from 'vitest';
import layout from '../../assets-source/campus-3d/district/layout.json';

describe('official-site Siyuan lawn and south-gate square', () => {
  it('keeps the apartment, its entrance path and the plaza access lane separate', () => {
    const dorm = layout.buildings.find((b) => b.id === 'Dormitory2')!;
    const westRoad = layout.roads.find((r) => r.name === '草坪西侧道路')!;
    const roadX = westRoad.points.at(-1)!.x;
    // Include the curb and enough room for the roof overhang beside the road.
    expect(roadX - westRoad.width / 2 - 7 - dorm.x - dorm.width).toBeGreaterThan(32);
    const path = layout.paths.find((r) => r.name === '2号公寓入口步道')!;
    expect(path.points[0]!.x).toBe(dorm.x + dorm.width / 2);
    expect(path.points[0]!.y).toBe(dorm.y + dorm.height);
    const crossRoad = layout.roads.find((r) => r.name === '广场南侧横路')!;
    expect(path.points.at(-1)!.y).toBe(crossRoad.points[0]!.y);
    const clear = (x: number, y: number) =>
      !layout.obstacles.some(
        (r) => x + 8 > r.x && x - 8 < r.x + r.width && y + 8 > r.y && y - 8 < r.y + r.height,
      );
    for (let y = dorm.y - 20; y <= crossRoad.points[0]!.y; y += 4)
      expect(clear(roadX, y), `Plaza access blocked at ${y}`).toBe(true);
    for (let y = dorm.y + dorm.height + 9; y <= path.points.at(-1)!.y; y += 4)
      expect(clear(path.points[0]!.x, y), `Apartment entrance blocked at ${y}`).toBe(true);
    expect(layout.obstacles).toContainEqual({
      x: dorm.x,
      y: dorm.y,
      width: dorm.width,
      height: dorm.height,
    });
  });

  it('preserves one large lawn in front of Siyuan with plaza south and gate beyond it', () => {
    const f = layout.forecourt;
    const main = layout.buildings.find((b) => b.id === 'Main')!;
    expect(main.y + main.height).toBeLessThan(f.lawn.y);
    expect(f.lawn.height).toBeGreaterThan(650);
    expect(f.lawn.width).toBeGreaterThan(450);
    expect(f.lawn.y + f.lawn.height).toBeLessThan(f.plaza.y);
    expect(f.plaza.y + f.plaza.height).toBeLessThan(layout.gate.y);
    for (const landmark of [f.flag, f.roundMonument]) {
      expect(landmark.x).toBeGreaterThan(f.lawn.x);
      expect(landmark.x).toBeLessThan(f.lawn.x + f.lawn.width);
    }
    expect(f.roundMonument.y).toBeGreaterThan(f.flag.y);
    // No straight asphalt through the open lawn; all road centerlines lie outside.
    for (const road of layout.roads.filter((r) => r.kind === 'road')) {
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]!,
          b = road.points[i]!;
        for (let t = 0; t <= 1; t += 0.02) {
          const x = a.x + (b.x - a.x) * t,
            y = a.y + (b.y - a.y) * t;
          expect(
            x > f.lawn.x &&
              x < f.lawn.x + f.lawn.width &&
              y > f.lawn.y &&
              y < f.lawn.y + f.lawn.height,
            `${road.name} cuts lawn`,
          ).toBe(false);
        }
      }
    }
  });

  it('retains an auditable image trace and sparse lawn trees with a separate plaza grove', () => {
    const f = layout.forecourt,
      trace = f.trace;
    // True ground corners from downloaded zoom2 official tiles, not roof labels.
    const pixel = (x: number, y: number) => {
      const u = (x - trace.logicalAnchor[0]!) / 1.55,
        v = (y - trace.logicalAnchor[1]!) / 1.55;
      return [84 + Math.cos(Math.PI / 6) * (u + v), 82 + 0.5 * (-u + v)];
    };
    const nw = pixel(f.lawn.x, f.lawn.y);
    expect(Math.hypot(nw[0]! - 220, nw[1]! - 175)).toBeLessThan(16);
    const se = pixel(f.lawn.x + f.lawn.width, f.lawn.y + f.lawn.height);
    expect(Math.hypot(se[0]! - 885, se[1]! - 253)).toBeLessThan(16);
    expect(f.conifers).toHaveLength(6);
    const lawnTrees = layout.trees.filter(
      (t) =>
        t.x > f.lawn.x + 20 &&
        t.x < f.lawn.x + f.lawn.width - 20 &&
        t.y > f.lawn.y &&
        t.y < f.lawn.y + f.lawn.height,
    );
    expect(lawnTrees).toHaveLength(6);
    const grove = layout.trees.filter(
      (t) =>
        t.x > f.plaza.x &&
        t.x < f.plaza.x + f.plaza.width &&
        t.y > f.plaza.y &&
        t.y < f.plaza.y + f.plaza.height,
    );
    expect(grove.length).toBeGreaterThan(20);
    // Each main building remains outside the newly traced lawn footprint.
    for (const b of layout.buildings.flatMap((b) => b.blocks)) {
      expect(
        b.x < f.lawn.x + f.lawn.width &&
          b.x + b.width > f.lawn.x &&
          b.y < f.lawn.y + f.lawn.height &&
          b.y + b.height > f.lawn.y,
      ).toBe(false);
    }
  });
});
