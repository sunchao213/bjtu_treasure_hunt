import { WORLD } from '../../config/world-config';
import type { Point } from '../../shared/types/game';

export function drawCampusOverview(canvas: HTMLCanvasElement, player: Point): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.save();
  ctx.scale(canvas.width / WORLD.width, canvas.height / WORLD.height);
  ctx.fillStyle = '#202c25';
  ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  ctx.strokeStyle = '#6e7b70';
  ctx.lineWidth = 5;
  ctx.strokeRect(45, 50, WORLD.width - 90, WORLD.height - 90);
  ctx.fillStyle = '#5c6860';
  for (const road of WORLD.roads) {
    ctx.fillRect(road.x, road.y, road.width, road.height);
  }
  ctx.fillStyle = '#a6b3a5';
  for (const building of WORLD.buildings) {
    ctx.fillRect(building.x, building.y, building.width, building.height);
  }
  ctx.fillStyle = '#428d9c';
  ctx.fillRect(WORLD.lake.x, WORLD.lake.y, WORLD.lake.width, WORLD.lake.height);
  ctx.fillStyle = '#58754e';
  ctx.fillRect(WORLD.sports.x, WORLD.sports.y, WORLD.sports.width, WORLD.sports.height);
  ctx.font = '64px Microsoft YaHei, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f0eee0';
  ctx.fillText('图书馆', 475, 270);
  ctx.fillText('明湖', 775, 380);
  ctx.fillText('思源楼', 805, 615);
  ctx.fillStyle = '#8cdeb2';
  const zone = WORLD.extraction;
  ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
  ctx.fillText('南门', 625, 895);
  ctx.beginPath();
  ctx.arc(player.x, player.y, 22, 0, Math.PI * 2);
  ctx.fillStyle = '#ffc767';
  ctx.fill();
  ctx.strokeStyle = '#111714';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.restore();
}
