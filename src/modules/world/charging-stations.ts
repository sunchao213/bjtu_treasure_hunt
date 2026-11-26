import type { Point, Rect } from '../../shared/types/game';
import { reachableGround } from './reachable-ground';

export interface ChargingStation extends Point {
  id: string;
}
export const CHARGING_STATION_COUNT = 3;
export const CHARGING_STATION_RANGE = 55;

interface ChargingMap {
  width: number;
  height: number;
  spawn: Point;
  obstacles: readonly Rect[];
  trees?: readonly Point[];
  extraction: Rect;
  extractions?: readonly Rect[];
  bounds?: Rect;
  canSpawn?: (point: Point) => boolean;
}

/** Sample connected, clear ground once per raid; never depend on frame timing. */
export function generateChargingStations(
  map: ChargingMap,
  random: () => number,
  reserved: readonly Point[] = [],
): ChargingStation[] {
  const reachable = map.canSpawn ?? reachableGround(map);
  const bounds = map.bounds ?? { x: 30, y: 35, width: map.width - 60, height: map.height - 70 };
  const candidates: Point[] = [];
  const clearance = 32;
  for (let y = bounds.y + clearance; y < bounds.y + bounds.height - clearance; y += 32) {
    for (let x = bounds.x + clearance; x < bounds.x + bounds.width - clearance; x += 32) {
      const point = { x, y };
      if (
        !reachable(point) ||
        Math.hypot(x - map.spawn.x, y - map.spawn.y) < 100 ||
        map.trees?.some((p) => Math.hypot(x - p.x, y - p.y) < 72) ||
        reserved.some((p) => Math.hypot(x - p.x, y - p.y) < 100) ||
        (map.extractions ?? [map.extraction]).some(
          (r) => x > r.x - 80 && x < r.x + r.width + 80 && y > r.y - 80 && y < r.y + r.height + 80,
        ) ||
        map.obstacles.some(
          (r) =>
            x + clearance > r.x &&
            x - clearance < r.x + r.width &&
            y + clearance > r.y &&
            y - clearance < r.y + r.height,
        )
      )
        continue;
      candidates.push(point);
    }
  }
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.max(0, Math.min(0.999999, random())) * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  const selected: ChargingStation[] = [];
  // Relax spacing on small preview maps without relaxing ground safety.
  for (const spacing of [Math.min(map.width, map.height) * 0.25, 128, 64]) {
    for (const point of candidates) {
      if (selected.some((p) => Math.hypot(point.x - p.x, point.y - p.y) < spacing)) continue;
      selected.push({ ...point, id: `charging-station-${selected.length + 1}` });
      if (selected.length === CHARGING_STATION_COUNT) return selected;
    }
  }
  return selected;
}
