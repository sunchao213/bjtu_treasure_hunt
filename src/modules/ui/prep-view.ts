/**
 * D · F01 准备页独立视图的纯逻辑。
 *
 * 协作边界：本模块只做「界面该不该显示、按钮可不可点」的判断，
 * 不读存档、不触碰对局状态；对局状态一律由 RaidController 提供。
 */

/** 与 RaidController.getView().phase 一致的对局阶段。 */
export type RaidPhase = 'preparing' | 'active' | 'extracting' | 'settling' | 'success' | 'failed';

/**
 * 准备视图只在「准备出发」阶段整屏显示；
 * 其余阶段（探索/读条/结算/结果）一律让位给局内 HUD 与结算面板。
 */
export function shouldShowPrepView(phase: RaidPhase): boolean {
  return phase === 'preparing';
}

/**
 * 开始按钮可用条件：玩家已勾选风险确认，且控制器不在保存/结算忙碌状态。
 * 未勾选风险确认不能开局——这是 F01 的验收硬条件。
 */
export function canStartRaid(options: { busy: boolean; consented: boolean }): boolean {
  return options.consented && !options.busy;
}
