import { afterEach, describe, expect, it } from 'vitest';
import {
  activeMap,
  beginRaidMap,
  inExtraction,
  previewUpcomingMap,
  resetMapRotation,
  upcomingMap,
} from '../../src/config/play-map';
import { generateLootSpawns } from '../../src/modules/world/loot-spawns';
import { createEnemies } from '../../src/modules/world/night-systems';

afterEach(() => {
  resetMapRotation();
});

describe('generated campus map', () => {
  it('reads collision, spawn and extraction from the tiled layers', () => {
    beginRaidMap();
    const generated = beginRaidMap();
    expect(generated.id).toBe('generated');
    expect(generated.title).toBe('生成校园');
    expect(generated.hasStory).toBe(false);
    expect(generated.width).toBe(1504);
    expect(generated.height).toBe(1632);
    expect(generated.obstacles.length).toBeGreaterThan(40);
    expect(generated.spawn).toMatchObject({ x: 784.25, y: 1520 });
    expect(generated.extractions).toHaveLength(2);
    expect(generated.questChest).toBeNull();
    expect(generated.stone).toBeNull();
    const spawnBlocked = generated.obstacles.some(
      (rect) =>
        generated.spawn.x + 8 > rect.x &&
        generated.spawn.x - 8 < rect.x + rect.width &&
        generated.spawn.y + 8 > rect.y &&
        generated.spawn.y - 8 < rect.y + rect.height,
    );
    expect(spawnBlocked).toBe(false);
  });

  it('spawns loot and enemies on open ground, and keeps story points on the campus map', () => {
    beginRaidMap();
    beginRaidMap();
    const points = generateLootSpawns(() => 0.2, []);
    expect(points.length).toBe(activeMap().lootZones.length * 3);
    expect(points.every((point) => point.itemId !== 'torn-notebook')).toBe(true);
    const enemies = createEnemies(() => 0.4);
    expect(enemies.some((enemy) => enemy.kind === 'patrol')).toBe(true);
    expect(enemies.some((enemy) => enemy.kind === 'hug')).toBe(true);
    resetMapRotation();
    expect(activeMap().id).toBe('campus');
    expect(activeMap().hasStory).toBe(true);
  });

  it('alternates the upcoming map without skipping a raid', () => {
    expect(upcomingMap().id).toBe('campus');
    expect(beginRaidMap().id).toBe('campus');
    expect(previewUpcomingMap().id).toBe('generated');
    expect(beginRaidMap().id).toBe('generated');
    expect(beginRaidMap().id).toBe('campus');
  });

  it('uses both extraction polygons', () => {
    beginRaidMap();
    const generated = beginRaidMap();
    expect(
      generated.extractions.every((zone) =>
        inExtraction({ x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 }, generated),
      ),
    ).toBe(true);
  });
});
