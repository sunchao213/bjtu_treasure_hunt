import { describe, expect, it } from 'vitest';
import { WORLD } from '../../src/config/world-config';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import { lineOfSight, distance } from '../../src/modules/world/night-systems';
import { clearLootPosition, generateLootSpawns } from '../../src/modules/world/loot-spawns';

function seeded(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

describe('expanded main campus', () => {
  it('matches the supplied relative landmarks and grows exploration area', () => {
    const library = WORLD.buildings.find((b) => b.name === '图书馆')!;
    const siyuan = WORLD.buildings.find((b) => b.name === '思源楼')!;
    expect(siyuan.x + siyuan.width).toBeLessThan(WORLD.lake.x);
    expect(WORLD.lake.x + WORLD.lake.width).toBeLessThan(library.x);
    expect(library.x + library.width).toBeLessThan(WORLD.sportsFields[1]!.x);
    expect(WORLD.sportsFields[0]!.x).toBeLessThan(siyuan.x);
    expect(WORLD.width * WORLD.height).toBeGreaterThanOrEqual(1280 * 900 * 7);
    expect(WORLD.gates.filter((g) => g.role === 'extraction')).toHaveLength(1);
  });

  it('randomizes each raid with enough value, both clues and clear spaced positions', () => {
    for (let seed = 0; seed < 100; seed++) {
      const points = generateLootSpawns(seeded(seed));
      expect(points).toHaveLength(34);
      expect(new Set(points.map((p) => p.zoneId)).size).toBe(WORLD.lootZones.length);
      expect(points.filter((p) => p.itemId === 'torn-notebook')).toHaveLength(1);
      expect(points.filter((p) => p.itemId === 'anomalous-feather')).toHaveLength(1);
      expect(
        points.reduce((sum, p) => sum + RAID_RULES.values[ITEM_DEFINITIONS[p.itemId]!.rarity], 0),
      ).toBeGreaterThan(200);
      for (let i = 0; i < points.length; i++) {
        expect(clearLootPosition(points[i]!)).toBe(true);
        for (let j = i + 1; j < points.length; j++)
          expect(distance(points[i]!, points[j]!)).toBeGreaterThanOrEqual(90);
      }
    }
    expect(generateLootSpawns(seeded(1))).not.toEqual(generateLootSpawns(seeded(2)));
    expect(generateLootSpawns(() => 0)).toHaveLength(34);
    expect(generateLootSpawns(() => 1)).toHaveLength(34);
  });

  it('keeps loot, lamps and patrols connected to the south gate without wall crossings', () => {
    const step = 25;
    const queue = [{ ...WORLD.spawn }];
    const key = (x: number, y: number) => `${x},${y}`;
    const visited = new Set([key(WORLD.spawn.x, WORLD.spawn.y)]);
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head]!;
      for (const [dx, dy] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
      ]) {
        const x = p.x + dx!,
          y = p.y + dy!;
        if (
          clearLootPosition({ x, y }, WORLD.playerRadius) &&
          !visited.has(key(x, y)) &&
          lineOfSight(p, { x, y }, WORLD.obstacles)
        ) {
          visited.add(key(x, y));
          queue.push({ x, y });
        }
      }
    }
    const targets = [
      ...WORLD.lamps,
      ...WORLD.enemyRoutes.flatMap((e) => e.route),
      ...Array.from({ length: 10 }, (_, i) => generateLootSpawns(seeded(i))).flat(),
    ];
    for (const p of targets) {
      expect(clearLootPosition(p, WORLD.playerRadius), JSON.stringify(p)).toBe(true);
      const x = WORLD.spawn.x + Math.round((p.x - WORLD.spawn.x) / step) * step;
      const y = WORLD.spawn.y + Math.round((p.y - WORLD.spawn.y) / step) * step;
      expect(visited.has(key(x, y)), JSON.stringify(p)).toBe(true);
      expect(lineOfSight({ x, y }, p, WORLD.obstacles)).toBe(true);
    }
    for (const enemy of WORLD.enemyRoutes) {
      for (let i = 0; i < enemy.route.length; i++) {
        const a = enemy.route[i]!,
          b = enemy.route[(i + 1) % enemy.route.length]!;
        for (let t = 0; t <= 1; t += 0.02)
          expect(
            clearLootPosition({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, 12),
          ).toBe(true);
      }
    }
  });
});
