import { WORLD } from '../../config/world-config';
import type { Point } from '../../shared/types/game';

export const EXPLORED_CELL_SIZE = 16;
const EXPLORED_COLUMNS = Math.ceil(WORLD.width / EXPLORED_CELL_SIZE);
const EXPLORED_ROWS = Math.ceil(WORLD.height / EXPLORED_CELL_SIZE);

export type ExploredMap = Uint8Array;

export interface CampusOverviewOptions {
  /** Render a compact, player-centred radar view instead of the full campus. */
  followPlayer?: boolean;
  /** World-space radius shown around the player in the compact view. */
  viewRadius?: number;
  teammates?: readonly { readonly position: Point; readonly name: string }[];
}

export function createExploredMap(): ExploredMap {
  return new Uint8Array(EXPLORED_COLUMNS * EXPLORED_ROWS);
}

export function clearExploredMap(explored: ExploredMap): void {
  explored.fill(0);
}

export function revealExploredArea(explored: ExploredMap, center: Point, radius = 68): void {
  const minColumn = Math.max(0, Math.floor((center.x - radius) / EXPLORED_CELL_SIZE));
  const maxColumn = Math.min(
    EXPLORED_COLUMNS - 1,
    Math.floor((center.x + radius) / EXPLORED_CELL_SIZE),
  );
  const minRow = Math.max(0, Math.floor((center.y - radius) / EXPLORED_CELL_SIZE));
  const maxRow = Math.min(EXPLORED_ROWS - 1, Math.floor((center.y + radius) / EXPLORED_CELL_SIZE));
  const radiusSquared = radius * radius;

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const cellCenterX = column * EXPLORED_CELL_SIZE + EXPLORED_CELL_SIZE / 2;
      const cellCenterY = row * EXPLORED_CELL_SIZE + EXPLORED_CELL_SIZE / 2;
      const distanceX = cellCenterX - center.x;
      const distanceY = cellCenterY - center.y;
      if (distanceX * distanceX + distanceY * distanceY <= radiusSquared) {
        explored[row * EXPLORED_COLUMNS + column] = 1;
      }
    }
  }
}

function isExplored(explored: ExploredMap, worldX: number, worldY: number): boolean {
  const column = Math.floor(worldX / EXPLORED_CELL_SIZE);
  const row = Math.floor(worldY / EXPLORED_CELL_SIZE);
  if (column < 0 || column >= EXPLORED_COLUMNS || row < 0 || row >= EXPLORED_ROWS) {
    return false;
  }
  return explored[row * EXPLORED_COLUMNS + column] === 1;
}

export function drawCampusOverview(
  canvas: HTMLCanvasElement,
  player: Point,
  image: CanvasImageSource,
  explored: ExploredMap,
  options: CampusOverviewOptions = {},
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const followPlayer = options.followPlayer === true;
  const viewRadius = Math.max(96, options.viewRadius ?? 320);
  const scale = followPlayer
    ? Math.min(canvas.width, canvas.height) / (viewRadius * 2)
    : Math.min(canvas.width / WORLD.width, canvas.height / WORLD.height);
  const width = followPlayer ? viewRadius * 2 : WORLD.width;
  const height = followPlayer ? viewRadius * 2 : WORLD.height;
  const viewCenterX = followPlayer
    ? Math.max(viewRadius, Math.min(WORLD.width - viewRadius, player.x))
    : WORLD.width / 2;
  const viewCenterY = followPlayer
    ? Math.max(viewRadius, Math.min(WORLD.height - viewRadius, player.y))
    : WORLD.height / 2;
  const offsetX = followPlayer
    ? (canvas.width - width * scale) / 2 - (viewCenterX - viewRadius) * scale
    : (canvas.width - width * scale) / 2;
  const offsetY = followPlayer
    ? (canvas.height - height * scale) / 2 - (viewCenterY - viewRadius) * scale
    : (canvas.height - height * scale) / 2;
  const x = (worldX: number) => offsetX + worldX * scale;
  const y = (worldY: number) => offsetY + worldY * scale;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#101713';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (followPlayer) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.clip();
    ctx.drawImage(image, offsetX, offsetY, WORLD.width * scale, WORLD.height * scale);
  } else {
    ctx.drawImage(image, offsetX, offsetY, width * scale, height * scale);
  }

  ctx.fillStyle = '#020305';
  for (let row = 0; row < EXPLORED_ROWS; row += 1) {
    for (let column = 0; column < EXPLORED_COLUMNS; column += 1) {
      if (explored[row * EXPLORED_COLUMNS + column] === 1) continue;
      const worldX = column * EXPLORED_CELL_SIZE;
      const worldY = row * EXPLORED_CELL_SIZE;
      ctx.fillRect(
        x(worldX),
        y(worldY),
        Math.ceil(EXPLORED_CELL_SIZE * scale) + 1,
        Math.ceil(EXPLORED_CELL_SIZE * scale) + 1,
      );
    }
  }

  for (const gate of WORLD.gates) {
    if (!isExplored(explored, gate.x, gate.y)) continue;
    ctx.beginPath();
    ctx.arc(x(gate.x), y(gate.y), gate.role === 'extraction' ? 5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = gate.role === 'extraction' ? '#8cdeb2' : '#d3c08d';
    ctx.fill();
  }

  for (const teammate of options.teammates ?? []) {
    ctx.beginPath();
    ctx.arc(x(teammate.position.x), y(teammate.position.y), 4, 0, Math.PI * 2);
    ctx.fillStyle = '#78c4ee';
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(x(player.x), y(player.y), 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffc767';
  ctx.fill();
  ctx.strokeStyle = '#111714';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (followPlayer) ctx.restore();
}
