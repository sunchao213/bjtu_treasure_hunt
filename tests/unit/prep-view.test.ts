import { describe, expect, it } from 'vitest';
import { canStartRaid, shouldShowPrepView } from '../../src/modules/ui/prep-view';
import { prepViewMarkup } from '../../src/modules/ui/reference-shell';

describe('F01 准备页独立视图 · 显隐逻辑', () => {
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

describe('F01 准备页独立视图 · 开始按钮可用性', () => {
  it('勾选风险确认且控制器空闲时才能开局', () => {
    expect(canStartRaid({ busy: false, consented: true })).toBe(true);
  });

  it('未勾选风险确认不能开局（F01 验收硬条件）', () => {
    expect(canStartRaid({ busy: false, consented: false })).toBe(false);
  });

  it('控制器保存或结算忙碌时不能开局，避免重复提交', () => {
    expect(canStartRaid({ busy: true, consented: true })).toBe(false);
    expect(canStartRaid({ busy: true, consented: false })).toBe(false);
  });
});

describe('F01 准备页首屏主内容', () => {
  const markup = prepViewMarkup();
  /** 折叠区起点：其后属于次要内容，不算首屏主内容。 */
  const firstDetails = markup.indexOf('<details');

  it('初始武器、带入选择、风险提示、勾选框与开始按钮都在准备页内', () => {
    for (const id of ['starter-weapon', 'loadout', 'risk-consent', 'start']) {
      expect(markup).toContain(`id="${id}"`);
    }
    expect(markup).toContain('prep-warning');
  });

  it('这五项主内容排在折叠区之前，属于首屏而不是「永久仓库 / 存档管理」', () => {
    expect(firstDetails).toBeGreaterThan(0);
    for (const id of ['starter-weapon', 'loadout', 'risk-consent', 'start']) {
      const at = markup.indexOf(`id="${id}"`);
      expect(at).toBeGreaterThan(0);
      expect(at).toBeLessThan(firstDetails);
    }
    expect(markup.indexOf('prep-warning')).toBeLessThan(firstDetails);
  });

  it('准备页是整页结构，不再使用居中的弹窗卡片', () => {
    expect(markup).toContain('class="prep-page"');
    expect(markup).toContain('class="prep-main"');
    expect(markup).not.toContain('prep-card');
  });
});
