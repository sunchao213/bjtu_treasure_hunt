import { describe, expect, it } from 'vitest';
import { WORLD } from '../../src/config/world-config';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import { lineOfSight, distance } from '../../src/modules/world/night-systems';

const radius = WORLD.playerRadius;
const clear = (x: number, y: number): boolean =>
  x >= 30 + radius &&
  x <= WORLD.width - 30 - radius &&
  y >= 35 + radius &&
  y <= WORLD.height - 35 - radius &&
  !WORLD.obstacles.some(
    (w) =>
      x + radius > w.x &&
      x - radius < w.x + w.width &&
      y + radius > w.y &&
      y - radius < w.y + w.height,
  );

describe('main campus routes', () => {
  it('keeps every search point, lamp, enemy waypoint and extraction reachable from the south gate', () => {
    const step = 10;
    const queue = [{ ...WORLD.spawn }];
    const visited = new Set<string>([`${WORLD.spawn.x},${WORLD.spawn.y}`]);
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head]!;
      for (const [dx, dy] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ]) {
        const x = p.x + dx!;
        const y = p.y + dy!;
        const key = `${x},${y}`;
        if (clear(x, y) && !visited.has(key)) {
          visited.add(key);
          queue.push({ x, y });
        }
      }
    }
    const targets = [
      ...WORLD.searchPoints,
      ...WORLD.lamps,
      ...WORLD.enemyRoutes.flatMap((e) => e.route),
      WORLD.spawn,
    ];
    for (const target of targets) {
      expect(clear(target.x, target.y), JSON.stringify(target)).toBe(true);
      expect(
        queue.some((p) => distance(p, target) < 20 && lineOfSight(p, target, WORLD.obstacles)),
        JSON.stringify(target),
      ).toBe(true);
    }
    for (const lamp of WORLD.lamps) {
      const zone = WORLD.extraction;
      const nearest = {
        x: Math.max(zone.x, Math.min(lamp.x, zone.x + zone.width)),
        y: Math.max(zone.y, Math.min(lamp.y, zone.y + zone.height)),
      };
      expect(distance(lamp, nearest)).toBeGreaterThan(55);
    }
  });

  it('preserves at least eight rare loot points and 200 baseline value across the campus', () => {
    const rare = WORLD.searchPoints.filter(
      (p) => ITEM_DEFINITIONS[p.itemId]?.rarity === 'uncommon',
    );
    expect(rare.length).toBeGreaterThanOrEqual(8);
    expect(rare.length * RAID_RULES.values.uncommon).toBeGreaterThanOrEqual(200);
    expect(rare.some((p) => p.x < WORLD.spawn.x)).toBe(true);
    expect(rare.some((p) => p.x > WORLD.spawn.x)).toBe(true);
  });
});
