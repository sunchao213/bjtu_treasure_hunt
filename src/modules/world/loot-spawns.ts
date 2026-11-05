import { WORLD } from '../../config/world-config';
import type { Point, Rect } from '../../shared/types/game';

export interface LootSpawn extends Point {
  id: string;
  itemId: string;
  zoneId: string;
}

/** The room round ID gives every member the same randomized campus layout. */
export function roundRandom(roundId: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < roundId.length; i++) seed = Math.imul(seed ^ roundId.charCodeAt(i), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Extra clearance leaves room to stand beside a chest and aim at it. */
const FOREGROUND_OCCLUSION_ZONES: readonly Rect[] = [
  // Red flag and pole in the west lawn.
  { x: 202, y: 610, width: 101, height: 280 },
  // Small sculpture ring, body and pedestal in the west lawn.
  { x: 218, y: 939, width: 85, height: 79 },
  { x: 220, y: 1018, width: 83, height: 32 },
  { x: 232, y: 1040, width: 58, height: 112 },
  { x: 204, y: 1142, width: 130, height: 50 },
];

export function clearLootPosition(
  p: Point,
  radius = 35,
  avoidForegroundOcclusion = false,
): boolean {
  const obstacles = avoidForegroundOcclusion
    ? [...WORLD.obstacles, ...FOREGROUND_OCCLUSION_ZONES]
    : WORLD.obstacles;
  return (
    p.x >= WORLD.bounds.x + radius &&
    p.x <= WORLD.bounds.x + WORLD.bounds.width - radius &&
    p.y >= WORLD.bounds.y + radius &&
    p.y <= WORLD.bounds.y + WORLD.bounds.height - radius &&
    !obstacles.some(
      (w) =>
        p.x + radius > w.x &&
        p.x - radius < w.x + w.width &&
        p.y + radius > w.y &&
        p.y - radius < w.y + w.height,
    )
  );
}

/** Finite candidate sampling: even a constant RNG cannot hang the raid. */
export function generateLootSpawns(random: () => number = Math.random): LootSpawn[] {
  const result: LootSpawn[] = [];
  const roll = () => Math.max(0, Math.min(0.999999, random()));
  for (const zone of WORLD.lootZones) {
    const candidates: Point[] = [];
    for (let x = zone.x + 25; x < zone.x + zone.width - 20; x += 50) {
      for (let y = zone.y + 25; y < zone.y + zone.height - 20; y += 50) {
        if (clearLootPosition({ x, y }, 35, true)) candidates.push({ x, y });
      }
    }
    const quota = zone.id === 'lake' ? 1 : 3;
    // Shuffle a finite list, then backtrack if a central choice would crowd out
    // the remaining boxes. A unlucky first choice must not break raid startup.
    const available = candidates.filter((p) =>
      result.every((other) => Math.hypot(p.x - other.x, p.y - other.y) >= 120),
    );
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(roll() * (i + 1));
      [available[i], available[j]] = [available[j]!, available[i]!];
    }
    const choose = (pool: Point[], count: number): Point[] | null => {
      if (count === 0) return [];
      for (let i = 0; i < pool.length; i++) {
        const point = pool[i]!;
        const rest = choose(
          pool
            .slice(i + 1)
            .filter((other) => Math.hypot(point.x - other.x, point.y - other.y) >= 120),
          count - 1,
        );
        if (rest) return [point, ...rest];
      }
      return null;
    };
    const selected = choose(available, quota);
    if (!selected) throw new Error(`No accessible loot positions in ${zone.id}`);
    for (let i = 0; i < quota; i++) {
      const point = selected[i]!;
      const jitter = { x: point.x + (roll() - 0.5) * 20, y: point.y + (roll() - 0.5) * 20 };
      const position =
        clearLootPosition(jitter, 35, true) &&
        result.every((other) => Math.hypot(jitter.x - other.x, jitter.y - other.y) >= 90)
          ? jitter
          : point;
      const pool = ['window-seat', 'morning-coffee', 'school-badge'];
      const itemId =
        zone.id === 'library' && i === 0
          ? 'torn-notebook'
          : zone.id === 'lake'
            ? 'anomalous-feather'
            : pool[Math.floor(roll() * pool.length)]!;
      result.push({ ...position, id: `${zone.id}-${i}`, itemId, zoneId: zone.id });
    }
  }
  return result;
}
