import { WORLD } from '../../config/world-config';
import type { Point } from '../../shared/types/game';

/** Geometry uses world coordinates; labels retain a readable screen font size. */
export function drawCampusOverview(
  canvas: HTMLCanvasElement,
  player: Point,
  expanded = false,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const sx = canvas.width / WORLD.width;
  const sy = canvas.height / WORLD.height;
  const pixelRatio = canvas.width / (canvas.clientWidth || canvas.width);
  const font = (expanded ? 12 : 10) * pixelRatio;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(sx, sy);
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
  for (const sports of WORLD.sportsFields)
    ctx.fillRect(sports.x, sports.y, sports.width, sports.height);
  const garden = WORLD.garden;
  ctx.fillStyle = '#3e6148';
  ctx.fillRect(garden.x, garden.y, garden.width, garden.height);
  ctx.restore();
  ctx.save();
  ctx.font = `bold ${font}px Microsoft YaHei, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = (name: string, x: number, y: number, color = '#f4f1df') => {
    const lines = expanded ? (name.match(/.{1,4}/gu) ?? [name]) : [name];
    const lineHeight = font * 1.12;
    const width = Math.max(...lines.map((line) => ctx.measureText(line).width)) + pixelRatio * 6;
    const height = lines.length * lineHeight + pixelRatio * 3;
    const px = Math.max(width / 2, Math.min(canvas.width - width / 2, x * sx));
    const py = Math.max(height / 2, Math.min(canvas.height - height / 2, y * sy));
    ctx.fillStyle = '#14221eed';
    ctx.fillRect(px - width / 2, py - height / 2, width, height);
    ctx.fillStyle = color;
    lines.forEach((line, i) =>
      ctx.fillText(line, px, py + (i - (lines.length - 1) / 2) * lineHeight),
    );
  };
  for (const b of WORLD.buildings) {
    const primary = ['思源楼', '图书馆'].includes(b.name);
    if (expanded || primary) {
      // Separate the three central labels on the compact map using leader lines.
      const y = expanded
        ? b.y + b.height / 2
        : b.name === '图书馆'
          ? b.y - 130
          : b.y + b.height + 100;
      if (!expanded) {
        ctx.strokeStyle = '#d8d1a5';
        ctx.lineWidth = pixelRatio;
        ctx.beginPath();
        ctx.moveTo((b.x + b.width / 2) * sx, (b.y + b.height / 2) * sy);
        ctx.lineTo((b.x + b.width / 2) * sx, y * sy);
        ctx.stroke();
      }
      label(b.name, b.x + b.width / 2, y, primary ? '#ffe3a0' : '#f4f1df');
    }
  }
  label(
    '明湖',
    WORLD.lake.x + WORLD.lake.width / 2,
    WORLD.lake.y + WORLD.lake.height / 2,
    '#b7ecf4',
  );
  for (const sports of WORLD.sportsFields)
    label(
      expanded ? sports.name : sports.name.replace('侧', ''),
      sports.x + sports.width / 2,
      sports.y + sports.height / 2,
    );
  label(garden.name, garden.x + garden.width / 2, garden.y + garden.height / 2);
  if (!expanded) {
    const north = WORLD.buildings.filter((b) => b.sub === 'TEACHING' && b.y < WORLD.lake.y);
    label(
      '教学区',
      north.reduce((sum, b) => sum + b.x + b.width / 2, 0) / north.length,
      Math.min(...north.map((b) => b.y)) + 70,
    );
    const labs = WORLD.buildings.filter((b) => b.sub === 'LABS' && b.y < WORLD.lake.y);
    label(
      '实验区',
      labs.reduce((sum, b) => sum + b.x + b.width / 2, 0) / labs.length,
      Math.min(...labs.map((b) => b.y)) + 70,
    );
  }
  for (const gate of WORLD.gates) {
    const extraction = gate.role === 'extraction';
    ctx.beginPath();
    ctx.arc(gate.x * sx, gate.y * sy, (extraction ? 3 : 2) * pixelRatio, 0, Math.PI * 2);
    ctx.fillStyle = extraction ? '#8cdeb2' : '#d3c08d';
    ctx.fill();
    label(
      gate.name.split(' · ')[0] + (expanded && extraction ? '撤离点' : ''),
      gate.x,
      gate.y - (expanded ? 80 : 170),
      extraction ? '#baf4d4' : '#f4f1df',
    );
  }
  ctx.beginPath();
  ctx.arc(player.x * sx, player.y * sy, 3 * pixelRatio, 0, Math.PI * 2);
  ctx.fillStyle = '#ffc767';
  ctx.fill();
  ctx.strokeStyle = '#111714';
  ctx.lineWidth = pixelRatio;
  ctx.stroke();
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f4f1df';
  ctx.fillText('北 ↑', canvas.width - 6 * pixelRatio, 10 * pixelRatio);
  ctx.restore();
}
