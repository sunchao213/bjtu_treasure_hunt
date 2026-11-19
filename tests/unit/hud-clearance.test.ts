import { describe, expect, it } from 'vitest';
import {
  hudFitsCanvas,
  hudLeavesSearchAndWarningsClear,
  raidHudLayout,
} from '../../src/modules/ui/hud-clearance';

const layouts = [
  {
    name: '桌面 900×475',
    canvasWidth: 900,
    canvasHeight: 475,
    touch: false,
    compact: false,
    viewHeight: 720,
  },
  {
    name: '桌面最矮 640×400',
    canvasWidth: 640,
    canvasHeight: 400,
    touch: false,
    compact: false,
    viewHeight: 720,
  },
  {
    name: '手机横屏 844×312',
    canvasWidth: 844,
    canvasHeight: 312,
    touch: true,
    compact: false,
    viewHeight: 390,
  },
  {
    name: '手机矮横屏 844×222',
    canvasWidth: 844,
    canvasHeight: 222,
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
