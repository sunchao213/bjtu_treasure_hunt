import { describe, expect, it } from 'vitest';
import {
  interruptedText,
  refusalText,
  valueGapText,
  type ExtractionSnapshot,
} from '../../src/modules/ui/extraction-feedback';
import type { RaidView } from '../../src/shared/types/game';

const view = (overrides: Partial<RaidView> = {}): RaidView => ({
  raidId: 'raid-1',
  phase: 'active',
  health: 100,
  remainingMs: 300_000,
  value: 75,
  threshold: 100,
  inExtractionZone: true,
  extractionProgress: 0,
  isBusy: false,
  saveError: false,
  result: null,
  ...overrides,
});

const snapshot = (overrides: Partial<ExtractionSnapshot> = {}): ExtractionSnapshot => ({
  value: 100,
  inZone: true,
  health: 100,
  paused: false,
  ...overrides,
});

describe('F02 撤离差额文案', () => {
  it('价值 75 时给出当前值、门槛与差额（F02 验收原文）', () => {
    expect(valueGapText(75, 100)).toBe('当前 75/100，还差 25，继续搜索');
  });

  it('刚好达标时差额为 0，不会出现负数', () => {
    expect(valueGapText(110, 100)).toBe('当前 110/100，还差 0，继续搜索');
  });
});

describe('F02 申请撤离被拒绝的原因', () => {
  it('不在撤离区提示回南门，而不是「价值不足」', () => {
    const text = refusalText('NOT_IN_RANGE', view({ inExtractionZone: false }), false);
    expect(text).toContain('不在撤离区');
  });

  it('价值不足给出差额与下一步动作', () => {
    expect(refusalText('VALUE_TOO_LOW', view({ value: 75 }), false)).toBe(
      '当前 75/100，还差 25，继续搜索',
    );
  });

  it('暂停与读条中属于不同原因', () => {
    expect(refusalText('INVALID_STATE', view(), true)).toContain('已暂停');
    expect(refusalText('INVALID_STATE', view({ phase: 'extracting' }), false)).toContain(
      '正在撤离',
    );
    expect(refusalText('INVALID_STATE', view({ phase: 'failed' }), false)).toContain('不能撤离');
  });
});

describe('F02 读条中断的原因', () => {
  it('价值从 110 丢掉 25 后跌破门槛，说明差额并中断', () => {
    const text = interruptedText(snapshot({ value: 110 }), view({ value: 85 }), false);
    expect(text).toBe('当前 85/100，还差 15，继续搜索 · 撤离读条已中断');
  });

  it('受伤、离开区域、暂停分别给出各自原因', () => {
    expect(interruptedText(snapshot(), view({ health: 75 }), false)).toContain('受到伤害');
    expect(
      interruptedText(snapshot(), view({ inExtractionZone: false, value: 100 }), false),
    ).toContain('离开撤离区');
    expect(interruptedText(snapshot(), view(), true)).toContain('已暂停');
  });

  it('读条正常完成进入结算时不提示中断', () => {
    expect(interruptedText(snapshot(), view({ phase: 'settling' }), false)).toBeNull();
    expect(interruptedText(snapshot(), view({ phase: 'success' }), false)).toBeNull();
  });
});
