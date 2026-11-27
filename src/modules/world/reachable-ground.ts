import type { Point, Rect } from '../../shared/types/game';

interface GroundMap {
  width: number;
  height: number;
  spawn: Point;
  obstacles: readonly Rect[];
}
const cache = new WeakMap<GroundMap, (point: Point) => boolean>();

/** Conservative connected ground grid shared by loot and enemy placement. */
export function reachableGround(map: GroundMap): (point: Point) => boolean {
  const existing = cache.get(map);
  if (existing) return existing;
  const step = 16;
  const cols = Math.ceil(map.width / step);
  const rows = Math.ceil(map.height / step);
  const cells = new Uint8Array(cols * rows);
  const clear = (x: number, y: number) =>
    x >= 42 &&
    y >= 47 &&
    x <= map.width - 42 &&
    y <= map.height - 47 &&
    !map.obstacles.some(
      (w) => x + 12 > w.x && x - 12 < w.x + w.width && y + 12 > w.y && y - 12 < w.y + w.height,
    );
  let start = -1;
  let nearest = Infinity;
  for (let i = 0; i < cells.length; i++) {
    const x = ((i % cols) + 0.5) * step;
    const y = (Math.floor(i / cols) + 0.5) * step;
    if (!clear(x, y)) continue;
    cells[i] = 1;
    const distance = Math.hypot(x - map.spawn.x, y - map.spawn.y);
    if (distance < nearest) {
      nearest = distance;
      start = i;
    }
  }
  const queue = start >= 0 ? [start] : [];
  if (start >= 0) cells[start] = 2;
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!;
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const x = (i % cols) + dx;
      const y = Math.floor(i / cols) + dy;
      const next = y * cols + x;
      if (x >= 0 && x < cols && y >= 0 && y < rows && cells[next] === 1) {
        cells[next] = 2;
        queue.push(next);
      }
    }
  }
  const reachable = (p: Point) => {
    const col = Math.floor(p.x / step),
      row = Math.floor(p.y / step);
    return (
      col >= 0 &&
      col < cols &&
      row >= 0 &&
      row < rows &&
      cells[row * cols + col] === 2 &&
      clear(p.x, p.y)
    );
  };
  cache.set(map, reachable);
  return reachable;
}
