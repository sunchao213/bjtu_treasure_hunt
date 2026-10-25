import type { ErrorCode, RaidView } from '../../shared/types/game';

/**
 * R02 · 撤离拒绝与读条中断的统一文案。
 *
 * 助教按 E 时只看到「没有反应」：侧栏按钮原本被 disabled，读条被价值跌破、受伤、
 * 离开区域或暂停取消时也没有说明。这里把三种入口（南门按 E、侧栏按钮、触屏交互键）
 * 共用的文案收敛成纯函数，便于单元测试与界面复用。
 */

/** 读条开始时的状态快照，用来判断读条为什么被取消。 */
export interface ExtractionSnapshot {
  readonly value: number;
  readonly inZone: boolean;
  readonly health: number;
  readonly paused: boolean;
}

/** 「当前 75/100，还差 25，继续搜索」：差额和下一步动作一起给。 */
export function valueGapText(value: number, threshold: number): string {
  const gap = Math.max(0, threshold - value);
  return `当前 ${value}/${threshold}，还差 ${gap}，继续搜索`;
}

/** 申请撤离失败：按错误码给出不同原因，不能一律写「价值不足」。 */
export function refusalText(
  error: ErrorCode,
  view: Pick<RaidView, 'value' | 'threshold' | 'inExtractionZone' | 'phase'>,
  paused: boolean,
): string {
  if (error === 'NOT_IN_RANGE') {
    return '不在撤离区 · 请走到南门撤离点再申请撤离';
  }
  if (error === 'VALUE_TOO_LOW') {
    return valueGapText(view.value, view.threshold);
  }
  if (error === 'INVALID_STATE') {
    if (paused) return '已暂停 · 关闭规则或校园图后再申请撤离';
    if (view.phase === 'extracting') return '正在撤离 · 请留在南门区域内';
    return '当前状态不能撤离，请稍后再试';
  }
  return '撤离申请失败，请重试';
}

/** 读条被取消时的原因；正常完成（进入结算）返回 null。 */
export function interruptedText(
  before: ExtractionSnapshot,
  view: RaidView,
  paused: boolean,
): string | null {
  if (view.phase !== 'active') return null;
  if (paused) return '已暂停 · 撤离读条已中断，关闭弹层后重新申请';
  if (view.health < before.health) return '受到伤害 · 撤离读条已中断';
  if (view.value < view.threshold) {
    return `${valueGapText(view.value, view.threshold)} · 撤离读条已中断`;
  }
  if (!view.inExtractionZone) return '离开撤离区 · 撤离读条已中断';
  return null;
}
