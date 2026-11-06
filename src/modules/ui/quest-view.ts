import { ITEM_CATALOG_IDS, ITEM_DEFINITIONS } from '../../config/game-config';
import {
  CHAPTERS,
  CODEX_ENTRIES,
  chapterContentById,
  FIRST_CHAPTER,
} from '../quests/chapter-content';
import {
  activeQuestChapter,
  chapterEvidence,
  chapterUnlockGranted,
  questChapterById,
  visibleQuestChapters,
} from '../quests/quest-service';
import type { QuestChapterSpec, QuestProgressView } from '../quests/quest-service';
import type { RaidResult } from '../../shared/types/game';

/**
 * D 的界面渲染：任务进度卡、大厅章节列表与图鉴 / 剧情档案。
 * 只消费外部传入的快照并更新 DOM，不发起任何业务写入。
 */

type StepState = 'done' | 'active' | 'locked';

/** 第一步无前置；第二步必须先持有本局第一件证据才可进行（各章同构）。 */
function stepState(index: number, progress: QuestProgressView): StepState {
  const carried = new Set(progress.carriedIds);
  const evidenceId = progress.evidenceIds[index] ?? '';
  if (carried.has(evidenceId)) {
    return 'done';
  }
  if (index === 0) {
    return 'active';
  }
  return carried.has(progress.evidenceIds[0] ?? '') ? 'active' : 'locked';
}

function stepStateText(state: StepState, chapter: QuestChapterSpec): string {
  if (state === 'done') return '已完成';
  if (state === 'active') return '可进行';
  return `未开始：需先取得${chapter.evidence[0]?.label ?? '前置证据'}`;
}

/** 章节任务卡：标题、两条线索与状态文案都跟随当前进行中的章节。 */
export function renderQuestPanel(progress: QuestProgressView): void {
  const count = document.getElementById('quest-count');
  if (count) {
    count.textContent = `${progress.collected} / ${progress.total}`;
  }
  const chapter = questChapterById(progress.chapterId);
  const steps = document.getElementById('quest-steps');
  if (steps) {
    steps.replaceChildren(
      ...chapter.evidence.map((evidence, index) => {
        const state = stepState(index, progress);
        const li = document.createElement('li');
        li.dataset.evidence = evidence.itemId;
        li.textContent = `${evidence.label.replace(/[「」]/g, '')} · ${evidence.placeName}`;
        li.classList.toggle('done', state === 'done');
        li.classList.toggle('active', state === 'active');
        li.setAttribute('title', stepStateText(state, chapter));
        return li;
      }),
    );
  }
  const status = document.getElementById('quest-status');
  if (status) {
    status.textContent = progress.statusText;
  }
}

export interface LobbyMissionRow {
  readonly chapterId: string;
  readonly order: number;
  readonly title: string;
  readonly status: 'done' | 'active';
  readonly statusText: string;
}

/** 大厅章节简报的纯数据视图：第一章常驻，其后每解锁一章追加一行。 */
export function lobbyMissionRows(unlockedChapterIds: readonly string[]): LobbyMissionRow[] {
  const active = activeQuestChapter(unlockedChapterIds);
  return visibleQuestChapters(unlockedChapterIds).map((chapter) => {
    const unlocked = unlockedChapterIds.includes(chapter.id);
    const statusText = unlocked ? '已完成' : chapter.id === active.id ? '进行中' : '未开始';
    return {
      chapterId: chapter.id,
      order: chapter.order,
      title: chapter.title,
      status: unlocked ? 'done' : 'active',
      statusText,
    } as const;
  });
}

/** 大厅任务简报：第一章常驻；通关后在其下方追加下一章，形成 01 / 02 / 03 列表。 */
export function renderLobbyMissions(
  container: HTMLElement,
  unlockedChapterIds: readonly string[],
): void {
  container.replaceChildren(
    ...lobbyMissionRows(unlockedChapterIds).map((row) => {
      const strip = document.createElement('div');
      strip.className = 'lobby-mission-strip';
      strip.dataset.chapter = row.chapterId;
      const number = document.createElement('span');
      number.className = 'mission-number';
      number.textContent = String(row.order).padStart(2, '0');
      const body = document.createElement('span');
      const title = document.createElement('b');
      title.textContent = row.title;
      const note = document.createElement('small');
      note.textContent = '带回两件证据，并从南门安全撤离';
      body.append(title, note);
      const status = document.createElement('span');
      status.className = `mission-status ${row.status}`;
      status.textContent = row.statusText;
      strip.append(number, body, status);
      return strip;
    }),
  );
}

/** 行前目标清单的纯数据视图：本章两件证据 + 统一的撤离价值门槛。 */
export function prepGoalRows(chapterId: string): { name: string; place: string }[] {
  const chapter = questChapterById(chapterId);
  return [
    ...chapter.evidence.map((evidence) => ({
      name: evidence.label.replace(/[「」]/g, ''),
      place: evidence.placeName,
    })),
    { name: '携带价值 ≥ 100', place: '南门 · 撤离点' },
  ];
}

/** 大厅本局目标清单：跟随当前章节的两件证据，第三项为统一的撤离价值门槛。 */
export function renderPrepGoals(container: HTMLElement, chapterId: string): void {
  container.replaceChildren(
    ...prepGoalRows(chapterId).map((row) => {
      const li = document.createElement('li');
      const name = document.createElement('b');
      name.textContent = row.name;
      const place = document.createElement('span');
      place.textContent = row.place;
      li.append(name, place);
      return li;
    }),
  );
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
  if (archive.unlockedChapterIds.length === 0) {
    const heading = document.createElement('p');
    heading.className = 'story-title';
    heading.textContent = FIRST_CHAPTER.title;
    const subtitle = document.createElement('p');
    subtitle.className = 'story-subtitle';
    subtitle.textContent = FIRST_CHAPTER.subtitle;
    story.append(heading, subtitle);
    const hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = FIRST_CHAPTER.unlockHint;
    story.append(hint);
    return;
  }
  // 已解锁章节按顺序列出，每章一个回看入口；章节推进后档案自动追加新条目。
  for (const chapterId of archive.unlockedChapterIds) {
    const chapter = chapterContentById(chapterId);
    const heading = document.createElement('p');
    heading.className = 'story-title';
    heading.textContent = chapter.title;
    const subtitle = document.createElement('p');
    subtitle.className = 'story-subtitle';
    subtitle.textContent = chapter.subtitle;
    const summary = document.createElement('p');
    summary.className = 'muted';
    summary.textContent = '本章已回收入册。';
    const button = document.createElement('button');
    button.id = `open-story-${chapterId}`;
    button.dataset.chapterStory = chapterId;
    button.className = 'secondary';
    button.textContent = '回看本章剧情';
    story.append(heading, subtitle, summary, button);
  }
}

export function renderChapterUnlock(
  target: HTMLElement,
  granted: boolean,
  chapterId = FIRST_CHAPTER.chapterId,
): void {
  target.hidden = !granted;
  if (granted) {
    target.textContent = chapterContentById(chapterId).settlementSummary;
  }
}

/**
 * 撤离成功但主线没做完时，说明本章为什么没解锁（R07 验收要求「失败与缺口都要可读」）。
 * 返回 null 表示不需要提示（非成功结算，或已解锁）。
 */
export function chapterLockHint(
  result: RaidResult | null,
  chapterId = FIRST_CHAPTER.chapterId,
): string | null {
  if (result === null || result.outcome !== 'success') return null;
  if (chapterUnlockGranted(result, chapterId)) return null;
  const evidence = chapterEvidence(result.items, result.raidId, chapterId);
  const chapter = questChapterById(chapterId);
  const missing = chapter.evidence
    .filter((entry) => !evidence.carriedIds.includes(entry.itemId))
    .map((entry) => entry.label);
  if (missing.length === 0) {
    // 两件都在却没解锁：理论上只在主线完成标志缺失时出现，给兜底文案而不是空句。
    return '本章未解锁：主线条件未满足，请核对任务进度。';
  }
  return `本章未解锁：需同时带回${missing.join('和')}。`;
}

export function renderChapterLock(
  target: HTMLElement,
  result: RaidResult | null,
  chapterId = FIRST_CHAPTER.chapterId,
): void {
  const hint = chapterLockHint(result, chapterId);
  target.hidden = hint === null;
  target.textContent = hint ?? '';
}

/** 剧情档案里的可回看章节：只列已解锁的章节。 */
export function storyArchiveChapters(unlockedChapterIds: readonly string[]): string[] {
  return unlockedChapterIds.filter((chapterId) => CHAPTERS[chapterId] !== undefined);
}
