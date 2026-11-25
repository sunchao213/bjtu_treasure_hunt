import type { CombatMap } from '../modules/world/night-systems';
import { lineOfSight } from '../modules/world/night-systems';
import type { Point } from '../shared/types/game';
import type { TrialMap } from './map';

const cache = new WeakMap<TrialMap, CombatMap>();

/** Flood once per map: enemies must spawn on ground reachable from the player. */
export function campusCombatMap(map: TrialMap): CombatMap {
  const cached = cache.get(map);
  if (cached) return cached;
  const step = 24;
  const cols = Math.ceil(map.bounds.width / step),
    rows = Math.ceil(map.bounds.height / step);
  const cells = new Uint8Array(cols * rows);
  const center = (i: number): Point => ({
    x: map.bounds.x + ((i % cols) + 0.5) * step,
    y: map.bounds.y + (Math.floor(i / cols) + 0.5) * step,
  });
  const clear = (p: Point) =>
    p.x - 18 >= map.bounds.x &&
    p.y - 18 >= map.bounds.y &&
    p.x + 18 <= map.bounds.x + map.bounds.width &&
    p.y + 18 <= map.bounds.y + map.bounds.height &&
    !map.obstacles.some(
      (r) =>
        p.x + 18 > r.x && p.x - 18 < r.x + r.width && p.y + 18 > r.y && p.y - 18 < r.y + r.height,
    );
  let start = -1,
    nearest = Infinity;
  // Rasterize expanded walls once instead of scanning every wall at every cell.
  // Adjacent centers are 24 apart, less than the combined 36-unit clearance,
  // so a wall cannot fit between two open adjacent cells.
  for (const r of map.obstacles) {
    const x0 = Math.max(0, Math.floor((r.x - 18 - map.bounds.x) / step));
    const x1 = Math.min(cols - 1, Math.floor((r.x + r.width + 18 - map.bounds.x) / step));
    const y0 = Math.max(0, Math.floor((r.y - 18 - map.bounds.y) / step));
    const y1 = Math.min(rows - 1, Math.floor((r.y + r.height + 18 - map.bounds.y) / step));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const p = center(y * cols + x);
        if (
          p.x + 18 > r.x &&
          p.x - 18 < r.x + r.width &&
          p.y + 18 > r.y &&
          p.y - 18 < r.y + r.height
        )
          cells[y * cols + x] = 3;
      }
  }
  for (let i = 0; i < cells.length; i++) {
    const p = center(i);
    if (
      cells[i] === 3 ||
      p.x - 18 < map.bounds.x ||
      p.y - 18 < map.bounds.y ||
      p.x + 18 > map.bounds.x + map.bounds.width ||
      p.y + 18 > map.bounds.y + map.bounds.height
    )
      continue;
    cells[i] = 1;
    const d = Math.hypot(p.x - map.spawn.x, p.y - map.spawn.y);
    if (d < nearest && lineOfSight(p, map.spawn, map.obstacles)) {
      start = i;
      nearest = d;
    }
  }
  const queue = start < 0 ? [] : [start];
  if (start >= 0) cells[start] = 2;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!,
      col = i % cols,
      row = Math.floor(i / cols);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const x = col + dx!,
        y = row + dy!,
        next = y * cols + x;
      if (x < 0 || x >= cols || y < 0 || y >= rows || cells[next] !== 1) continue;
      cells[next] = 2;
      queue.push(next);
    }
  }
  const count = map.width > 2000 ? 12 : 4;
  const result: CombatMap = {
    width: map.width,
    height: map.height,
    spawn: map.spawn,
    obstacles: map.obstacles,
    extractions: [map.extraction],
    enemyRoutes: Array.from({ length: count }, (_, i) => ({
      id: `campus-enemy-${i + 1}`,
      kind: i % 4 === 3 ? ('hug' as const) : ('patrol' as const),
      route: [map.spawn],
    })),
    canSpawn: (p) => {
      const col = Math.floor((p.x - map.bounds.x) / step),
        row = Math.floor((p.y - map.bounds.y) / step);
      if (
        col < 0 ||
        col >= cols ||
        row < 0 ||
        row >= rows ||
        cells[row * cols + col] !== 2 ||
        !clear(p)
      )
        return false;
      return lineOfSight(p, center(row * cols + col), map.obstacles);
    },
  };
  cache.set(map, result);
  return result;
}
