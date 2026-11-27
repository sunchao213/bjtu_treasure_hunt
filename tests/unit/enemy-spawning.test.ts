import { describe, expect, it } from 'vitest';
import { COMBAT_RULES } from '../../src/config/combat-config';
import { activeMap } from '../../src/config/play-map';
import layout from '../../assets-source/campus-3d/district/layout.json';
import {
  NightCombat,
  createEnemies,
  encounterRegionKey,
  type CombatMap,
} from '../../src/modules/world/night-systems';

const emptyMap: CombatMap = {
  width: 4000,
  height: 4000,
  spawn: { x: 100, y: 100 },
  obstacles: [],
  extractions: [],
  enemyRoutes: [],
};
function isolatedSpawns(random = 0) {
  const combat = new NightCombat(
    () => random,
    () => emptyMap,
  );
  Reflect.set(combat, 'spawnTimer', Infinity);
  Reflect.set(combat, 'amplifierSpawnTimer', Infinity);
  return combat;
}

describe('requested enemy spawn tuning', () => {
  it('keeps one reachable fixed amplifier by the library and the existing central amplifier across rounds', () => {
    const map = activeMap();
    const library = layout.buildings.find((b) => b.id === 'Library')!;
    for (const seed of [0, 0.25, 0.5, 0.999]) {
      const enemies = createEnemies(() => seed, map);
      const amplifier = enemies.find((e) => e.id === 'library-amplifier')!;
      expect(amplifier?.position).toEqual({ x: 2700, y: 1070 });
      expect(amplifier.kind).toBe('amplifier');
      expect(map.canSpawn?.(amplifier.position)).toBe(true);
      expect(amplifier.position.x).toBeGreaterThan(library.x);
      expect(amplifier.position.x).toBeLessThan(library.x + library.width);
      expect(amplifier.position.y).toBeGreaterThan(library.y + library.height);
      expect(amplifier.position.y - library.y - library.height).toBeLessThan(100);
      const central = enemies.find((e) => e.id === 'central-amplifier')!;
      expect(central.position).toEqual({ x: 1060, y: 1520 });
      expect(encounterRegionKey(amplifier.position)).not.toBe(encounterRegionKey(central.position));
      expect(enemies.filter((e) => e.kind === 'amplifier')).toHaveLength(2);
    }
  });
  it.each([
    [0.859999, 1],
    [0.86, 0],
  ])('uses the 86 percent probability boundary: random %s -> %s amplifier', (random, count) => {
    const combat = isolatedSpawns(random);
    Reflect.set(combat, 'amplifierSpawnTimer', COMBAT_RULES.enemy.amplifier.spawnIntervalMs);
    expect(COMBAT_RULES.enemy.amplifier.spawnChance).toBe(0.86);
    expect(combat.updateSpawns(45_000, () => ({ x: 1800, y: 1800 }))).toHaveLength(count);
  });
  it('spawns no hugs before 80 seconds, then exactly three, without replaying the batch immediately', () => {
    const combat = isolatedSpawns();
    let count = 0;
    const find = () => ({ x: 1000 + 200 * count++, y: 1000 });
    expect(COMBAT_RULES.spawning.hugSpawnIntervalMs).toBe(80_000);
    expect(COMBAT_RULES.spawning.hugSpawnCount).toBe(3);
    expect(combat.updateSpawns(79_999, find)).toEqual([]);
    const first = combat.updateSpawns(1, find);
    expect(first).toHaveLength(3);
    expect(first.every((e) => e.kind === 'hug')).toBe(true);
    expect(new Set(first.map((e) => e.id)).size).toBe(3);
    expect(combat.updateSpawns(0, find)).toEqual([]);
    expect(combat.updateSpawns(79_999, find)).toEqual([]);
    expect(combat.updateSpawns(1, find)).toHaveLength(3);
  });
  it('limits hug batches to the remaining shared capacity', () => {
    const combat = isolatedSpawns();
    const template = createEnemies(() => 0, activeMap())[0]!;
    combat.enemies = Array.from({ length: 20 }, (_, i) => ({ ...template, id: 'cap-' + i }));
    let position = 1000;
    const batch = combat.updateSpawns(80_000, () => ({ x: (position += 200), y: 1000 }));
    expect(batch).toHaveLength(2);
    expect(combat.enemies).toHaveLength(22);
  });
  it('stops a hug batch if no legal location remains and retains already spawned members', () => {
    const combat = isolatedSpawns();
    let calls = 0;
    const batch = combat.updateSpawns(80_000, () => (calls++ === 0 ? { x: 1000, y: 1000 } : null));
    expect(batch).toHaveLength(1);
    expect(calls).toBe(2);
    expect(combat.enemies).toEqual(batch);
  });
  it('spawns six ordinary monsters per wave when slots and routes are available', () => {
    const combat = isolatedSpawns();
    Reflect.set(combat, 'spawnTimer', 22_000);
    let x = 1000;
    const wave = combat.updateSpawns(22_000, () => ({ x: (x += 200), y: 1000 }));
    expect(COMBAT_RULES.spawning.spawnCount).toBe(6);
    expect(wave.map((e) => e.species)).toEqual(['duck', 'cat', 'swan', 'duck', 'cat', 'swan']);
  });
});
