import { ITEM_CATALOG_IDS, ITEM_DEFINITIONS } from '../../config/game-config';
import { CODEX_ENTRIES, FIRST_CHAPTER } from '../quests/chapter-content';
import { EVIDENCE_FEATHER, EVIDENCE_NOTEBOOK } from '../quests/quest-service';
import type { QuestProgressView } from '../quests/quest-service';

/**
 * D 的界面渲染：任务进度卡与图鉴 / 剧情档案。
 * 只消费外部传入的快照并更新 DOM，不发起任何业务写入。
 */

const UNLOCK_NOTICE = '思源密码 · 第一章已解锁，图鉴与剧情档案可回看。';

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

function evidenceNames(evidenceIds: readonly string[]): string {
  return evidenceIds.map(itemName).join('与');
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
  }

  for (const act of FIRST_CHAPTER.acts) {
    const actTitle = document.createElement('p');
    actTitle.className = 'story-act-title';
    actTitle.textContent = act.title;
    story.append(actTitle);
    const body = document.createElement('p');
    if (unlocked) {
      body.className = 'story-body';
      body.textContent = act.body;
    } else {
      body.className = 'muted';
      body.textContent = act.requiresEvidence.length
        ? `未解锁：需先取得${evidenceNames(act.requiresEvidence)}并成功带出。`
        : '未解锁：成功带出本章证据后开启。';
    }
    story.append(body);
  }
}

export function renderChapterUnlock(target: HTMLElement, granted: boolean): void {
  target.hidden = !granted;
  if (granted) {
    target.textContent = UNLOCK_NOTICE;
  }
}
