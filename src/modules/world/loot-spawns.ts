import { WORLD } from '../../config/world-config';
import type { Point } from '../../shared/types/game';

export interface LootSpawn extends Point {
  id: string;
  itemId: string;
  zoneId: string;
}

/** Extra clearance leaves room to stand beside a chest and aim at it. */
export function clearLootPosition(p: Point, radius = 35): boolean {
  return (
    p.x >= 30 + radius &&
    p.x <= WORLD.width - 30 - radius &&
    p.y >= 35 + radius &&
    p.y <= WORLD.height - 35 - radius &&
    !WORLD.obstacles.some(
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
        if (clearLootPosition({ x, y })) candidates.push({ x, y });
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
        clearLootPosition(jitter) &&
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
