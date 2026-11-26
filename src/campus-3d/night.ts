import type { Point } from '../shared/types/game';
import type { TrialMap } from './map';
import type { LightSource } from '../modules/world/night-systems';

export type NightAction = 'flashlight' | 'battery' | 'flare';
export interface NightFrame {
  enabled: boolean;
  flashlight: boolean;
  battery: number;
  spareBatteries: number;
  flareCount: number;
  aim: number;
  flares: readonly (LightSource & { remainingMs: number })[];
}

/** Map-local lamps: never use the two-dimensional campus's coordinates. */
export function campusLamps(map: TrialMap): LightSource[] {
  const points: Point[] = [map.spawn, ...map.chests];
  return points.map((p) => {
    // Try the road shoulder near each destination, keeping posts outside collision.
    const offsets = [
      [48, 30],
      [-48, 30],
      [48, -30],
      [-48, -30],
      [0, 0],
    ];
    const point =
      offsets
        .map(([x, y]) => ({ x: p.x + x!, y: p.y + y! }))
        .find(
          (q) =>
            q.x > map.bounds.x + 8 &&
            q.y > map.bounds.y + 8 &&
            q.x < map.bounds.x + map.bounds.width - 8 &&
            q.y < map.bounds.y + map.bounds.height - 8 &&
            !map.obstacles.some(
              (r) =>
                q.x + 12 > r.x &&
                q.x - 12 < r.x + r.width &&
                q.y + 12 > r.y &&
                q.y - 12 < r.y + r.height,
            ),
        ) ?? p;
    return { ...point, radius: 155 };
  });
}
