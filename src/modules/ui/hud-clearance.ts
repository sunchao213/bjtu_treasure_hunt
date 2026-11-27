/** 局内搜索键提示、危险横幅、小地图和手机搜索键的占位，用来检查它们会不会互相挡住。 */

export interface ScreenBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RaidHudLayout {
  readonly interaction: ScreenBox;
  readonly hotbar: ScreenBox;
  readonly searchPrompt: ScreenBox | null;
  readonly dangerToast: ScreenBox;
  readonly minimap: ScreenBox;
  readonly touchSearch: ScreenBox | null;
}

const PROMPT_WIDTH = 96;
/** 圆键 84 + 间距 6 + 文案，再留出呼吸缩放。 */
const PROMPT_HEIGHT = 118;
const PROMPT_BOTTOM = 182;
const TOAST_HEIGHT = 44;
const TOAST_GAP = 12;
const CONTROL_INSET = 10;
const CONTROL_BLOCK = 93;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function boxesOverlap(a: ScreenBox, b: ScreenBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function raidHudLayout(options: {
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly touch: boolean;
  readonly compact: boolean;
  readonly viewHeight: number;
}): RaidHudLayout {
  const { canvasWidth, canvasHeight, touch, viewHeight } = options;
  const minimapSize = touch ? clamp(viewHeight * 0.24, 76, 112) : 164;
  const minimap = {
    x: canvasWidth - (touch ? 8 : 16) - minimapSize,
    y: touch ? 54 : 80,
    width: minimapSize,
    height: minimapSize,
  };
  const searchPrompt = touch
    ? null
    : {
        x: (canvasWidth - PROMPT_WIDTH) / 2,
        y: canvasHeight - PROMPT_BOTTOM - PROMPT_HEIGHT,
        width: PROMPT_WIDTH,
        height: PROMPT_HEIGHT,
      };
  const stick = clamp(viewHeight * 0.2, 64, 84);
  const controlsTop = canvasHeight - CONTROL_INSET - Math.max(stick, CONTROL_BLOCK);
  const toastBottom = touch ? 180 : PROMPT_BOTTOM + PROMPT_HEIGHT + TOAST_GAP;
  const toastWidth = touch ? Math.min(350, canvasWidth - 540) : Math.min(560, canvasWidth - 32);
  const dangerToast = {
    x: (canvasWidth - toastWidth) / 2,
    y: canvasHeight - toastBottom - TOAST_HEIGHT,
    width: toastWidth,
    height: TOAST_HEIGHT,
  };
  const touchSearch = touch
    ? {
        x: canvasWidth - CONTROL_INSET - (48 * 3 + 5 * 2),
        y: controlsTop,
        width: 48 * 3 + 5 * 2,
        height: CONTROL_BLOCK,
      }
    : null;
  const interactionWidth = touch ? canvasWidth - 540 : Math.min(640, canvasWidth - 200);
  const interaction = {
    x: (canvasWidth - interactionWidth) / 2,
    y: canvasHeight - (touch ? 112 : 128) - (touch ? 52 : 44),
    width: interactionWidth,
    height: touch ? 52 : 44,
  };
  const hotbarWidth = touch ? 194 : 280;
  const hotbarHeight = touch ? 68 : 94;
  const hotbar = {
    x: (canvasWidth - hotbarWidth) / 2,
    y: canvasHeight - (touch ? 12 : 20) - hotbarHeight,
    width: hotbarWidth,
    height: hotbarHeight,
  };
  return { interaction, hotbar, searchPrompt, dangerToast, minimap, touchSearch };
}

export function hudLeavesSearchAndWarningsClear(layout: RaidHudLayout): boolean {
  const boxes = [
    layout.interaction,
    layout.hotbar,
    layout.dangerToast,
    layout.minimap,
    layout.searchPrompt,
    layout.touchSearch,
  ].filter((box): box is ScreenBox => box !== null);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const first = boxes[i];
      const second = boxes[j];
      if (first && second && boxesOverlap(first, second)) return false;
    }
  }
  return true;
}

export function hudFitsCanvas(
  layout: RaidHudLayout,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const boxes = [
    layout.interaction,
    layout.hotbar,
    layout.dangerToast,
    layout.minimap,
    layout.searchPrompt,
    layout.touchSearch,
  ].filter((box): box is ScreenBox => box !== null);
  return boxes.every(
    (box) =>
      box.x >= 0 &&
      box.y >= 0 &&
      box.x + box.width <= canvasWidth + 0.5 &&
      box.y + box.height <= canvasHeight + 0.5,
  );
}
