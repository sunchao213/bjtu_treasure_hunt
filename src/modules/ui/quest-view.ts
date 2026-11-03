import { ITEM_CATALOG_IDS, ITEM_DEFINITIONS } from '../../config/game-config';
import { CODEX_ENTRIES, FIRST_CHAPTER } from '../quests/chapter-content';
import {
  carriedEvidence,
  chapterUnlockGranted,
  EVIDENCE_FEATHER,
  EVIDENCE_NOTEBOOK,
} from '../quests/quest-service';
import type { QuestProgressView } from '../quests/quest-service';
import type { RaidResult } from '../../shared/types/game';

/**
 * D 的界面渲染：任务进度卡与图鉴 / 剧情档案。
 * 只消费外部传入的快照并更新 DOM，不发起任何业务写入。
 */

type StepState = 'done' | 'active' | 'locked';

const STEP_STATE_TEXT: Readonly<Record<StepState, string>> = {
  done: '已完成',
  active: '可进行',
  locked: '未开始：需先取得残缺手记',
};

/** 第一步无前置；第二步必须先持有本局的残缺手记才可进行。 */
function stepState(evidenceId: string | undefined, progress: QuestProgressView): StepState {
  if (evidenceId === EVIDENCE_NOTEBOOK) {
    return progress.notebook ? 'done' : 'active';
  }
  if (evidenceId === EVIDENCE_FEATHER) {
    if (progress.feather) {
      return 'done';
    }
    return progress.notebook ? 'active' : 'locked';
  }
  return 'locked';
}

export function renderQuestPanel(progress: QuestProgressView): void {
  const count = document.getElementById('quest-count');
  if (count) {
    count.textContent = `${progress.collected} / 2`;
  }
  const steps = document.getElementById('quest-steps');
  if (steps) {
    for (const li of Array.from(steps.querySelectorAll('li'))) {
      const state = stepState(li.dataset.evidence, progress);
      li.classList.toggle('done', state === 'done');
      li.classList.toggle('active', state === 'active');
      li.setAttribute('title', STEP_STATE_TEXT[state]);
    }
  }
  const status = document.getElementById('quest-status');
  if (status) {
    status.textContent = progress.statusText;
  }
}

export interface CodexArchive {
  readonly codexIds: readonly string[];
  readonly unlockedChapterIds: readonly string[];
}

function itemName(itemId: string): string {
  return ITEM_DEFINITIONS[itemId]?.name ?? itemId;
}

export function renderCodexPanel(
  list: HTMLElement,
  story: HTMLElement,
  archive: CodexArchive,
): void {
  list.replaceChildren();
  for (const itemId of ITEM_CATALOG_IDS) {
    const lit = archive.codexIds.includes(itemId);
    const li = document.createElement('li');
    li.className = lit ? 'lit' : 'unlit';
    li.textContent = `${lit ? '◆' : '◇'} ${itemName(itemId)}`;
    const entry = CODEX_ENTRIES[itemId];
    if (entry !== undefined) {
      li.title = entry;
    }
    list.append(li);
  }

  story.replaceChildren();
  const unlocked = archive.unlockedChapterIds.includes(FIRST_CHAPTER.chapterId);
  const heading = document.createElement('p');
  heading.className = 'story-title';
  heading.textContent = FIRST_CHAPTER.title;
  const subtitle = document.createElement('p');
  subtitle.className = 'story-subtitle';
  subtitle.textContent = FIRST_CHAPTER.subtitle;
  story.append(heading, subtitle);

  if (!unlocked) {
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = FIRST_CHAPTER.unlockHint;
    story.append(hint);
  } else {
    // 已解锁：档案显示回看入口，完整第一章在剧情弹窗中呈现。
    const summary = document.createElement('p');
    summary.className = 'muted';
    summary.textContent = '本章已回收入册：明湖边的异常羽毛。';
    const button = document.createElement('button');
    button.id = 'open-story';
    button.className = 'secondary';
    button.textContent = '回看第一章剧情';
    story.append(summary, button);
  }
}

export function renderChapterUnlock(target: HTMLElement, granted: boolean): void {
  target.hidden = !granted;
  if (granted) {
    target.textContent = FIRST_CHAPTER.settlementSummary;
  }
}

/**
 * 撤离成功但主线没做完时，说明本章为什么没解锁（R07 验收要求「失败与缺口都要可读」）。
 * 返回 null 表示不需要提示（非成功结算，或已解锁）。
 */
export function chapterLockHint(result: RaidResult | null): string | null {
  if (result === null || result.outcome !== 'success') return null;
  if (chapterUnlockGranted(result)) return null;
  const evidence = carriedEvidence(result.items, result.raidId);
  const missing: string[] = [];
  if (!evidence.notebook) missing.push('「残缺手记」');
  if (!evidence.feather) missing.push('「异常羽毛」');
  if (missing.length === 0) {
    // 两件都在却没解锁：理论上只在主线完成标志缺失时出现，给兜底文案而不是空句。
    return '本章未解锁：主线条件未满足，请核对任务进度。';
  }
  return `本章未解锁：需同时带回${missing.join('和')}。`;
}

export function renderChapterLock(target: HTMLElement, result: RaidResult | null): void {
  const hint = chapterLockHint(result);
  target.hidden = hint === null;
  target.textContent = hint ?? '';
}
