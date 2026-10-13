import type { Point, Rect } from '../../shared/types/game';
import { NightLighting, rayDistance } from './night-systems';

/** Punch light into the darkness texture, clipped by the same walls used by gameplay. */
export function renderDarkness(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  lighting: NightLighting,
  player: Point,
  aim: number,
  walls: readonly Rect[],
): void {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(3, 5, 8, 0.92)';
  ctx.fillRect(0, 0, width, height);
  const illuminate = (
    source: Point,
    radius: number,
    start: number,
    sweep: number,
    strength: number,
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    const steps = Math.ceil(sweep * 100);
    for (let i = 0; i <= steps; i++) {
      const angle = start + (sweep * i) / steps;
      const length = rayDistance(source, angle, radius, walls);
      ctx.lineTo(source.x + Math.cos(angle) * length, source.y + Math.sin(angle) * length);
    }
    ctx.closePath();
    ctx.clip();
    ctx.globalCompositeOperation = 'destination-out';
    const gradient = ctx.createRadialGradient(source.x, source.y, 0, source.x, source.y, radius);
    gradient.addColorStop(0, `rgba(0,0,0,${strength})`);
    gradient.addColorStop(0.65, `rgba(0,0,0,${strength * 0.85})`);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(source.x - radius, source.y - radius, radius * 2, radius * 2);
    ctx.restore();
  };
  illuminate(player, 70, 0, Math.PI * 2, lighting.enabled ? 0.96 : 0.48);
  for (const source of lighting.sources()) {
    illuminate(source, source.radius, 0, Math.PI * 2, 1);
  }
  if (lighting.enabled && lighting.battery > 0) {
    illuminate(player, 310, aim - Math.PI / 5, (Math.PI * 2) / 5, 1);
  }
}
