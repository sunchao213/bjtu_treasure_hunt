import { describe, expect, it } from 'vitest';
import {
  hudFitsCanvas,
  hudLeavesSearchAndWarningsClear,
  raidHudLayout,
} from '../../src/modules/ui/hud-clearance';

const layouts = [
  {
    name: '桌面 1920×1080',
    canvasWidth: 1920,
    canvasHeight: 1080,
    touch: false,
    compact: false,
    viewHeight: 720,
  },
  {
    name: '桌面 1024×768',
    canvasWidth: 1024,
    canvasHeight: 768,
    touch: false,
    compact: false,
    viewHeight: 720,
  },
  {
    name: '手机横屏 844×390',
    canvasWidth: 844,
    canvasHeight: 390,
    touch: true,
    compact: false,
    viewHeight: 390,
  },
  {
    name: '手机矮横屏 844×300',
    canvasWidth: 844,
    canvasHeight: 300,
    touch: true,
    compact: true,
    viewHeight: 300,
  },
];

describe('不同分辨率下搜索和危险提示不被挡住', () => {
  it.each(layouts)('$name', (options) => {
    const layout = raidHudLayout(options);
    expect(hudFitsCanvas(layout, options.canvasWidth, options.canvasHeight)).toBe(true);
    expect(hudLeavesSearchAndWarningsClear(layout)).toBe(true);
  });
});
