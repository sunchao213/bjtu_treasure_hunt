import type { ItemInstance, RaidResult } from '../../shared/types/game';

export const QUEST_CHAPTER_ID = 'siyuan-code';
export const EVIDENCE_NOTEBOOK = 'torn-notebook';

export const QUEST_COMPLETE_HINT = '任务完成：携带本局残缺手记成功撤离可解锁第一章。';
export const NOTEBOOK_PREREQUISITE_HINT = '明湖石碑：先在思源楼前取得本局残缺手记。';

export interface CarriedEvidence {
  readonly notebook: boolean;
  readonly collected: number;
}

export interface QuestProgressView extends CarriedEvidence {
  readonly steleInvestigated: boolean;
  readonly complete: boolean;
  readonly statusText: string;
}

function hasCurrentRaidLoot(
  items: readonly ItemInstance[],
  itemId: string,
  raidId: string | null,
): boolean {
  return (
    raidId !== null &&
    items.some(
      (item) =>
        item.itemId === itemId &&
        item.origin.kind === 'raid-loot' &&
        item.origin.obtainedInRaidId === raidId,
    )
  );
}

export function carriedEvidence(
  items: readonly ItemInstance[],
  raidId: string | null,
): CarriedEvidence {
  const notebook = hasCurrentRaidLoot(items, EVIDENCE_NOTEBOOK, raidId);
  return { notebook, collected: notebook ? 1 : 0 };
}

export function hasCurrentRaidNotebook(
  items: readonly ItemInstance[],
  raidId: string | null,
): boolean {
  return hasCurrentRaidLoot(items, EVIDENCE_NOTEBOOK, raidId);
}

export function isQuestComplete(
  items: readonly ItemInstance[],
  raidId: string | null,
  steleInvestigated: boolean,
): boolean {
  return steleInvestigated && hasCurrentRaidNotebook(items, raidId);
}

export function questProgress(
  items: readonly ItemInstance[],
  raidId: string | null,
  steleInvestigated = false,
): QuestProgressView {
  const evidence = carriedEvidence(items, raidId);
  const complete = isQuestComplete(items, raidId, steleInvestigated);
  let statusText: string;
  if (raidId === null) {
    statusText = '开始探索后，可按线索推进任务。';
  } else if (complete) {
    statusText = QUEST_COMPLETE_HINT;
  } else if (evidence.notebook && !steleInvestigated) {
    statusText = '第二步 · 前往明湖石碑，按 E 调查';
  } else if (steleInvestigated && !evidence.notebook) {
    statusText = NOTEBOOK_PREREQUISITE_HINT;
  } else {
    statusText = '第一步 · 前往思源楼前打开固定宝箱，取得残缺手记';
  }
  return {
    ...evidence,
    steleInvestigated,
    collected: (evidence.notebook ? 1 : 0) + (steleInvestigated ? 1 : 0),
    complete,
    statusText,
  };
}

export function chapterUnlockGranted(result: RaidResult): boolean {
  return (
    result.outcome === 'success' &&
    result.questComplete === true &&
    hasCurrentRaidNotebook(result.items, result.raidId)
  );
}
