import type { ItemInstance, RaidResult } from '../../shared/types/game';

/**
 * D 的任务模块：本局任务前置判定、临时进度与章节解锁判定。
 *
 * 边界（与 docs/handoff.md 一致）：
 * - 一切判定基于调用方传入的「权威携带物快照」，不维护第二份物品副本；
 * - 只认 origin = raid-loot 且 obtainedInRaidId = 本局 raidId 的证据，带入物与上一局物品无效；
 * - 本模块不写任何永久数据：章节解锁的落库仍由 SavePort.finalizeRaid 完成，
 *   chapterUnlockGranted() 与存档层保持同一套规则，仅供结果展示使用。
 */

export const QUEST_CHAPTER_ID = 'siyuan-code';
export const EVIDENCE_NOTEBOOK = 'torn-notebook';
export const EVIDENCE_FEATHER = 'anomalous-feather';

export const QUEST_COMPLETE_HINT = '手记与异常羽毛已凑齐；带着它们成功撤离可解锁思源密码。';
export const NOTEBOOK_PREREQUISITE_HINT = '湖畔线索 · 缺少本局残缺手记';

export interface CarriedEvidence {
  readonly notebook: boolean;
  readonly feather: boolean;
  readonly collected: number;
}

export interface QuestProgressView extends CarriedEvidence {
  readonly complete: boolean;
  readonly statusText: string;
}

function hasEvidence(
  items: readonly ItemInstance[],
  evidenceId: string,
  raidId: string | null,
): boolean {
  return (
    raidId !== null &&
    items.some(
      (item) =>
        item.itemId === evidenceId &&
        item.origin.kind === 'raid-loot' &&
        item.origin.obtainedInRaidId === raidId,
    )
  );
}

/** 从权威快照中统计「本局新获得且仍携带」的任务证据。 */
export function carriedEvidence(
  items: readonly ItemInstance[],
  raidId: string | null,
): CarriedEvidence {
  const notebook = hasEvidence(items, EVIDENCE_NOTEBOOK, raidId);
  const feather = hasEvidence(items, EVIDENCE_FEATHER, raidId);
  return { notebook, feather, collected: (notebook ? 1 : 0) + (feather ? 1 : 0) };
}

/**
 * 地点调查前置：目标搜索点需要前置证据时返回拦截提示文案；返回 null 表示允许调查。
 * 当前规则：明湖石碑（anomalous-feather）必须先持有本局的残缺手记。
 */
export function prerequisiteHint(
  chestItemId: string,
  items: readonly ItemInstance[],
  raidId: string | null,
): string | null {
  if (chestItemId !== EVIDENCE_FEATHER) {
    return null;
  }
  const evidence = carriedEvidence(items, raidId);
  return evidence.notebook ? null : NOTEBOOK_PREREQUISITE_HINT;
}

/** 本局任务是否已凑齐（临时进度，不落永久档）。 */
export function isQuestComplete(items: readonly ItemInstance[], raidId: string | null): boolean {
  const evidence = carriedEvidence(items, raidId);
  return evidence.notebook && evidence.feather;
}

/** 任务卡的展示数据（含中文状态文案）。 */
export function questProgress(
  items: readonly ItemInstance[],
  raidId: string | null,
): QuestProgressView {
  const evidence = carriedEvidence(items, raidId);
  const complete = evidence.notebook && evidence.feather;
  let statusText: string;
  if (raidId === null) {
    statusText = '开始探索后，可按线索搜集任务证据。';
  } else if (complete) {
    statusText = '线索齐备 · 带回南门可解锁章节';
  } else if (evidence.notebook) {
    statusText = '下一线索：明湖石碑';
  } else {
    statusText = '线索：图书馆外残缺手记';
  }
  return { ...evidence, complete, statusText };
}

/**
 * 结算侧判定：与 SavePort.finalizeRaid 的解锁规则一致——
 * 成功撤离 + questComplete + 两件证据均为本局 raid-loot。仅供结果展示，不做任何写入。
 */
export function chapterUnlockGranted(result: RaidResult): boolean {
  if (result.outcome !== 'success' || result.questComplete !== true) {
    return false;
  }
  return (
    hasEvidence(result.items, EVIDENCE_NOTEBOOK, result.raidId) &&
    hasEvidence(result.items, EVIDENCE_FEATHER, result.raidId)
  );
}
