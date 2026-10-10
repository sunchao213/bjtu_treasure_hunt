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
  for (const road of WORLD.roads) ctx.fillRect(road.x, road.y, road.width, road.height);
  ctx.fillStyle = '#a6b3a5';
  for (const building of WORLD.buildings)
    ctx.fillRect(building.x, building.y, building.width, building.height);
  ctx.fillStyle = '#428d9c';
  ctx.fillRect(WORLD.lake.x, WORLD.lake.y, WORLD.lake.width, WORLD.lake.height);
  ctx.fillStyle = '#58754e';
  ctx.fillRect(WORLD.sports.x, WORLD.sports.y, WORLD.sports.width, WORLD.sports.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 30px Microsoft YaHei, sans-serif';
  ctx.fillStyle = '#f0eee0';
  ctx.fillText('图书馆', 480, 350);
  ctx.fillText('明湖', WORLD.lake.x + WORLD.lake.width / 2, WORLD.lake.y + WORLD.lake.height / 2);
  ctx.fillText('思源楼', 810, 690);
  ctx.fillText(
    '西侧运动场',
    WORLD.sports.x + WORLD.sports.width / 2,
    WORLD.sports.y + WORLD.sports.height / 2,
  );
  ctx.font = 'bold 20px Microsoft YaHei, sans-serif';
  ctx.fillStyle = '#d8dfd1';
  ctx.fillText('教学楼群', 205, 492);
  ctx.fillText('教学楼群', 395, 650);
  ctx.fillText('实验楼群', 960, 215);
  ctx.fillText('教学楼群', 1105, 495);
  for (const gate of WORLD.gates) {
    const isExtraction = gate.role === 'extraction';
    ctx.beginPath();
    ctx.arc(gate.x, gate.y, isExtraction ? 22 : 14, 0, Math.PI * 2);
    ctx.fillStyle = isExtraction ? '#8cdeb2' : '#d3c08d';
    ctx.fill();
    ctx.strokeStyle = '#18211b';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.font = isExtraction
      ? 'bold 26px Microsoft YaHei, sans-serif'
      : 'bold 20px Microsoft YaHei, sans-serif';
    ctx.fillStyle = '#f0eee0';
    ctx.fillText(gate.name.replace(' · 地标', '').replace(' · 撤离点', ''), gate.x, gate.y - 34);
  }
  ctx.beginPath();
  ctx.arc(player.x, player.y, 16, 0, Math.PI * 2);
  ctx.fillStyle = '#ffc767';
  ctx.fill();
  ctx.strokeStyle = '#111714';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.restore();
}
