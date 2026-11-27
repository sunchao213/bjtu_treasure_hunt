import { describe, expect, it } from 'vitest';
import geometry from '../../src/config/formal-campus.json';
import district from '../../assets-source/campus-3d/district/layout.json';
import { activeMap } from '../../src/config/play-map';
import {
  generateLootSpawns,
  questSpawnPlan,
  roundRandom,
  clearLootPosition,
} from '../../src/modules/world/loot-spawns';
import { createEnemies } from '../../src/modules/world/night-systems';

describe('shared production 3D campus', () => {
  it('uses model footprints and the district south gate on both sides of the network', () => {
    expect(geometry.obstacles).toEqual(district.obstacles);
    expect(geometry.spawn).toEqual(district.spawn);
    expect(activeMap().obstacles).toEqual(geometry.obstacles);
    expect(geometry.width).toBe(3264);
    expect(geometry.height).toBe(3328);
    for (const p of geometry.spawnPositions) expect(clearLootPosition(p, 8)).toBe(true);
    expect(new Set(geometry.spawnPositions.map((p) => `${p.x},${p.y}`)).size).toBe(10);
  });
  it('keeps each chapter evidence point on reachable clear ground', () => {
    for (const chapter of ['siyuan-code', 'siyuan-key', 'soothe-monster']) {
      const loot = generateLootSpawns(roundRandom(chapter), questSpawnPlan(chapter));
      for (const point of loot) {
        expect(clearLootPosition(point), JSON.stringify(point)).toBe(true);
        expect(activeMap().canSpawn!(point)).toBe(true);
      }
    }
    expect(activeMap().canSpawn!(geometry.stone)).toBe(true);
    expect(geometry.questChest).toMatchObject({ id: 'siyuan-notebook-chest', zoneId: 'siyuan' });
  });
  it('repeats shared round layouts and varies later rounds without blocked loot', () => {
    expect(generateLootSpawns(roundRandom('one'))).toEqual(generateLootSpawns(roundRandom('one')));
    expect(generateLootSpawns(roundRandom('one'))).not.toEqual(
      generateLootSpawns(roundRandom('two')),
    );
    for (let i = 0; i < 24; i++)
      for (const p of generateLootSpawns(roundRandom(String(i))))
        expect(clearLootPosition(p)).toBe(true);
  });
  it('starts twelve enemies including fixed amplifiers on Siyuan lawn and beside the library', () => {
    const enemies = createEnemies(roundRandom('enemies'));
    const otherSeed = createEnemies(roundRandom('enemies-2'));
    expect(enemies).toHaveLength(12);
    expect(enemies.filter((e) => e.kind === 'amplifier')).toHaveLength(2);
    expect(enemies.find((e) => e.id === 'library-amplifier')!.position).toEqual({
      x: 2700,
      y: 1070,
    });
    expect(enemies.filter((e) => e.kind === 'hug')).toHaveLength(3);
    const amplifier = enemies.find((e) => e.id === 'central-amplifier')!;
    const otherAmplifier = otherSeed.find((e) => e.id === 'central-amplifier')!;
    expect(amplifier.position).toEqual({ x: 1060, y: 1520 });
    expect(otherAmplifier.position).toEqual({ x: 1060, y: 1520 });
    const lawn = district.forecourt.lawn;
    expect(amplifier.position.x).toBeGreaterThan(lawn.x);
    expect(amplifier.position.x).toBeLessThan(lawn.x + lawn.width);
    expect(amplifier.position.y).toBeGreaterThan(lawn.y);
    expect(amplifier.position.y).toBeLessThan(lawn.y + lawn.height);
    expect(enemies.every((e) => activeMap().canSpawn!(e.position))).toBe(true);
  });
  it('keeps shared room chest positions and ordinary loot consistent across chapter progress', () => {
    for (let seed = 0; seed < 12; seed++) {
      const layouts = ['siyuan-code', 'siyuan-key', 'soothe-monster'].map((chapter) =>
        generateLootSpawns(roundRandom(`round-${seed}`), questSpawnPlan(chapter)).filter((p) =>
          /^.+-\d+$/.test(p.id),
        ),
      );
      const positions = (layout: (typeof layouts)[number]) =>
        layout.map(({ id, x, y }) => ({ id, x, y }));
      expect(positions(layouts[0]!)).toEqual(positions(layouts[1]!));
      expect(positions(layouts[1]!)).toEqual(positions(layouts[2]!));
      for (const point of layouts[0]!) {
        const items = layouts.map((layout) => layout.find((p) => p.id === point.id)!.itemId);
        if (items.includes('soothe-charm') || items.includes('complete-record')) continue;
        expect(new Set(items).size).toBe(1);
      }
    }
  });
});
