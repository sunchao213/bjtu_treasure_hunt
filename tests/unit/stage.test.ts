import { describe, expect, it } from 'vitest';
import { fitStage, STAGE_HEIGHT, STAGE_WIDTH } from '../../src/modules/ui/stage';

describe('桌面端固定画框比例', () => {
  it('基准即为 16:9', () => {
    expect(STAGE_WIDTH / STAGE_HEIGHT).toBeCloseTo(16 / 9, 10);
  });
  it('基准尺寸本身不缩放', () => {
    expect(fitStage(1280, 720)).toBe(1);
  });
  it('16:9 大屏按整数倍放大', () => {
    expect(fitStage(1920, 1080)).toBeCloseTo(1.5, 10);
    expect(fitStage(2560, 1440)).toBeCloseTo(2, 10);
  });
  it('4:3 窗口按宽度贴边，上下留背景而不是拉伸', () => {
    expect(fitStage(1024, 768)).toBeCloseTo(0.8, 10);
  });
  it('窗口小于基准时等比缩小，保证整框可见', () => {
    expect(fitStage(1100, 640)).toBeCloseTo(1100 / 1280, 10);
    expect(fitStage(900, 600)).toBeCloseTo(900 / 1280, 10);
  });
  it('视口异常时回落到 1，不产生 0 或负比例', () => {
    expect(fitStage(0, 0)).toBe(1);
    expect(fitStage(-5, 100)).toBe(1);
    expect(fitStage(100, 0)).toBe(1);
  });
});
