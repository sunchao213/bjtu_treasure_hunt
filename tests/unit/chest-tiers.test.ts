import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHEST_TIERS, rollChestItem } from '../../src/config/chest-config';
import { ITEM_DEFINITIONS, RAID_RULES, itemValueFor } from '../../src/config/game-config';
import { activeMap } from '../../src/config/play-map';
import {
  clearLootPosition,
  generateLootSpawns,
  questSpawnPlan,
  roundRandom,
} from '../../src/modules/world/loot-spawns';

const value = (id: string) => itemValueFor(ITEM_DEFINITIONS[id]!)!;
describe('tiered campus chests', () => {
  it('loads transparent six-frame sheets for each tier at the existing frame size', () => {
    for (const { texture } of Object.values(CHEST_TIERS)) {
      const png = readFileSync(
        new URL(`../../public/assets/props/${texture}.png`, import.meta.url),
      );
      expect(png.readUInt32BE(16)).toBe(1536);
      expect(png.readUInt32BE(20)).toBe(256);
      expect(png[25]).toBe(6); // RGBA PNG
    }
    expect(Object.values(CHEST_TIERS).map((tier) => tier.durationMs)).toEqual([
      2_000, 4_000, 6_000,
    ]);
    expect(RAID_RULES).toMatchObject({ threshold: 200, bagCapacity: 6 });
  });

  it('preserves ordinary odds and implements exact intermediate and advanced rarity weights', () => {
    for (const [tier, expected] of [
      ['normal', { common: 800, uncommon: 9000, epic: 180, legendary: 20 }],
      ['intermediate', { uncommon: 4000, epic: 5800, legendary: 200 }],
      ['advanced', { epic: 9000, legendary: 1000 }],
    ] as const) {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 10_000; i++) {
        const id = rollChestItem(tier, () => (i + 0.5) / 10_000);
        const definition = ITEM_DEFINITIONS[id]!;
        counts[definition.rarity] = (counts[definition.rarity] ?? 0) + 1;
        expect(definition.kind).not.toBe('quest');
        expect([
          'torn-notebook',
          'anomalous-feather',
          'siyuan-key',
          'complete-record',
          'soothe-charm',
        ]).not.toContain(id);
        if (tier === 'advanced') expect(value(id)).toBeGreaterThanOrEqual(60);
      }
      expect(counts).toEqual(expected);
    }
  });

  it('keeps 11 random slots, upgrades four randomly chosen zones and places one advanced chest near a deep patrol', () => {
    const map = activeMap();
    const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    for (let seed = 0; seed < 100; seed++) {
      const points = generateLootSpawns(roundRandom(`tiers-${seed}`), []);
      expect(points).toHaveLength(11);
      expect(points.filter((point) => point.tier === 'normal')).toHaveLength(6);
      const medium = points.filter((point) => point.tier === 'intermediate');
      expect(medium).toHaveLength(4);
      expect(new Set(medium.map((point) => point.zoneId)).size).toBe(4);
      const high = points.filter((point) => point.tier === 'advanced');
      expect(high).toHaveLength(1);
      expect(distance(high[0]!, map.spawn)).toBeGreaterThanOrEqual(900);
      expect(
        map.enemyRoutes
          .filter((route) => route.kind === 'patrol')
          .some((route) => route.route.some((p) => distance(p, high[0]!) <= 300)),
      ).toBe(true);
      expect(
        map.extractions.every(
          (exit) =>
            distance(high[0]!, { x: exit.x + exit.width / 2, y: exit.y + exit.height / 2 }) >= 700,
        ),
      ).toBe(true);
      for (const point of points) expect(clearLootPosition(point, 35, true)).toBe(true);
    }
  });

  it('randomizes positions for every tier and varies intermediate zones between rounds', () => {
    const signatures = {
      normal: new Set<string>(),
      intermediate: new Set<string>(),
      advanced: new Set<string>(),
    };
    const mediumZones = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const points = generateLootSpawns(roundRandom(`random-layout-${seed}`), []);
      expect(points).toEqual(generateLootSpawns(roundRandom(`random-layout-${seed}`), []));
      for (const tier of ['normal', 'intermediate', 'advanced'] as const) {
        signatures[tier].add(
          JSON.stringify(
            points.filter((point) => point.tier === tier).map(({ x, y }) => ({ x, y })),
          ),
        );
      }
      mediumZones.add(
        points
          .filter((point) => point.tier === 'intermediate')
          .map((point) => point.zoneId)
          .sort()
          .join(','),
      );
    }
    for (const layouts of Object.values(signatures)) expect(layouts.size).toBe(30);
    expect(mediumZones.size).toBeGreaterThan(1);
  });

  it('preserves every authored story chest and evidence point exactly', () => {
    const map = activeMap();
    for (let seed = 0; seed < 12; seed++) {
      for (const chapter of ['siyuan-code', 'siyuan-key', 'soothe-monster']) {
        const plan = questSpawnPlan(chapter);
        const points = generateLootSpawns(roundRandom(`story-${seed}`), plan);
        for (const entry of plan) {
          const point = points.find((point) => point.itemId === entry.itemId)!;
          expect(point).toBeDefined();
          expect(point.tier).toBeUndefined();
          if (entry.fixedPoint) expect(point).toMatchObject(entry.fixedPoint);
          if (entry.itemId === 'torn-notebook')
            expect(point).toEqual({ ...map.questChest, itemId: 'torn-notebook' });
          expect(CHEST_TIERS[point.tier ?? 'normal'].durationMs).toBe(2_000);
        }
      }
    }
  });

  it('shares tier, position and rewards across chapters and keeps authored evidence out of tiered boxes', () => {
    for (const seed of ['chapter-a', 'chapter-b', 'chapter-c']) {
      const base = generateLootSpawns(roundRandom(seed), []);
      for (const chapter of ['siyuan-code', 'siyuan-key', 'soothe-monster']) {
        const points = generateLootSpawns(roundRandom(seed), questSpawnPlan(chapter));
        expect(points.filter((point) => point.tier)).toEqual(base);
        expect(
          points
            .filter((point) => !point.tier)
            .every((point) =>
              questSpawnPlan(chapter).some((entry) => entry.itemId === point.itemId),
            ),
        ).toBe(true);
      }
    }
    expect(4 * value('school-badge') + 2 * value('gpa-charm')).toBe(200);
    expect(4 * value('school-badge') + value('gpa-charm') + value('hunter-binoculars')).toBe(210);
  });
});
