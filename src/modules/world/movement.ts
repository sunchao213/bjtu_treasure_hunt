import type { Point, Rect } from '../../shared/types/game';

export function contains(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function overlaps(position: Point, radius: number, obstacle: Rect): boolean {
  return (
    position.x + radius > obstacle.x &&
    position.x - radius < obstacle.x + obstacle.width &&
    position.y + radius > obstacle.y &&
    position.y - radius < obstacle.y + obstacle.height
  );
}

/** Axis-separated, sub-stepped movement prevents tunnelling at low frame rates. */
export function movePlayer(
  position: Point,
  direction: Point,
  deltaMs: number,
  speed: number,
  radius: number,
  bounds: Rect,
  obstacles: readonly Rect[],
): Point {
  const magnitude = Math.hypot(direction.x, direction.y);
  if (!magnitude || !Number.isFinite(deltaMs) || deltaMs <= 0) {
    return { ...position };
  }
  const distance = (speed * Math.min(deltaMs, 100)) / 1000;
  const dx = (direction.x / magnitude) * distance;
  const dy = (direction.y / magnitude) * distance;
  const steps = Math.max(1, Math.ceil(distance / Math.max(radius, 1)));
  let result = { ...position };
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));
  for (let i = 0; i < steps; i++) {
    const x = {
      x: clamp(result.x + dx / steps, bounds.x + radius, bounds.x + bounds.width - radius),
      y: result.y,
    };
    if (!obstacles.some((wall) => overlaps(x, radius, wall))) {
      result = x;
    }
    const y = {
      x: result.x,
      y: clamp(result.y + dy / steps, bounds.y + radius, bounds.y + bounds.height - radius),
    };
    if (!obstacles.some((wall) => overlaps(y, radius, wall))) {
      result = y;
    }
  }
  return result;
}
