import { describe, expect, it } from 'vitest';
import { canStartRaid, shouldShowPrepView } from '../../src/modules/ui/prep-view';

describe('R01 准备页独立视图 · 显隐逻辑', () => {
  it('仅「准备出发」阶段整屏显示准备视图', () => {
    expect(shouldShowPrepView('preparing')).toBe(true);
  });

  it('探索、读条、结算与结果阶段都不显示准备视图，让位给局内 HUD', () => {
    const otherPhases = ['active', 'extracting', 'settling', 'success', 'failed'] as const;
    for (const phase of otherPhases) {
      expect(shouldShowPrepView(phase)).toBe(false);
    }
  });
});

describe('R01 准备页独立视图 · 开始按钮可用性', () => {
  it('勾选风险确认且控制器空闲时才能开局', () => {
    expect(canStartRaid({ busy: false, consented: true })).toBe(true);
  });

  it('未勾选风险确认不能开局（R01 验收硬条件）', () => {
    expect(canStartRaid({ busy: false, consented: false })).toBe(false);
  });

  it('控制器保存或结算忙碌时不能开局，避免重复提交', () => {
    expect(canStartRaid({ busy: true, consented: true })).toBe(false);
    expect(canStartRaid({ busy: true, consented: false })).toBe(false);
  });
});
