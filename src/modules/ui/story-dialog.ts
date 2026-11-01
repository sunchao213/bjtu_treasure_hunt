import { type ChapterContent, type ChapterStep, FIRST_CHAPTER } from '../quests/chapter-content';
import { EVIDENCE_FEATHER, EVIDENCE_NOTEBOOK } from '../quests/quest-service';
import { createTypewriter, toSegments, type StorySegment } from './typewriter';

/**
 * D · 剧情对话：视觉小说式的 NARRATION 台词栏（与序章同一套表现）。
 *
 * 呈现约定（与序章共用 typewriter）：
 * - 主句逐字打出，点击 / 回车 / 空格：先补全当前句，再翻到下一段；
 * - 长文本按句号自动拆成多段，副标题标明当前是第几段线索；
 * - 全部段落读完后自动关闭。
 *
 * 触发约定（与剧情稿 v1.1 一致）：
 * - step：拾取任务证据时自动弹出对应线索全文（表 4）；
 * - ending：成功撤离解锁章节后自动弹出结尾与下一章钩子（6.4）；
 * - full-chapter：剧情档案「回看」入口，完整重读本章。
 * 开场由序章（prologue-stage）承担，不再重复弹窗。
 * 本模块只渲染文本，不写存档、不做条件判定。
 */

export type StoryView =
  | { readonly kind: 'step'; readonly step: ChapterStep }
  | { readonly kind: 'ending' }
  | { readonly kind: 'full-chapter' };

/** 把剧情视图展开为台词序列；纯函数，便于测试与后续扩章复用。 */
export function storySegments(
  view: StoryView,
  chapter: ChapterContent = FIRST_CHAPTER,
): readonly StorySegment[] {
  switch (view.kind) {
    case 'step':
      return toSegments(view.step.title, view.step.stepBody);
    case 'ending':
      return [
        ...toSegments('章节结尾 · 新的记忆缺口', chapter.epilogue),
        ...toSegments('下一步', chapter.settlementSummary),
      ];
    case 'full-chapter':
      return [
        ...toSegments('开场 · 晚归的路上', chapter.prologue),
        ...chapter.steps.flatMap((step) => toSegments(step.title, step.stepBody)),
        ...toSegments('章节结尾 · 新的记忆缺口', chapter.epilogue),
        ...toSegments('下一步', chapter.settlementSummary),
      ];
  }
}

/** 拾取证据 → 对应剧情步骤（表 4 的两段线索正文；撤离段由 ending 呈现）。 */
const EVIDENCE_STEP_INDEX: Readonly<Record<string, number>> = {
  [EVIDENCE_NOTEBOOK]: 0,
  [EVIDENCE_FEATHER]: 1,
};

/** 拾取到任务证据时返回应自动弹出的剧情步骤；非任务证据返回 undefined。 */
export function stepForEvidence(
  itemId: string,
  chapter: ChapterContent = FIRST_CHAPTER,
): ChapterStep | undefined {
  const index = EVIDENCE_STEP_INDEX[itemId];
  return index === undefined ? undefined : chapter.steps[index];
}

export function storyDialogMarkup(): string {
  return `
    <dialog id="story-dialog" class="story-dialog" aria-label="剧情" tabindex="-1">
      <div class="story-box">
        <button id="story-skip" class="story-skip" aria-label="跳过本段剧情" title="跳过">跳过</button>
        <p class="story-label" id="story-label"></p>
        <p class="story-speaker" id="story-speaker"></p>
        <p class="story-line" id="story-line" aria-live="polite"></p>
        <div class="story-footer">
          <span class="story-progress" id="story-progress"></span>
          <span class="story-hint" id="story-hint"></span>
        </div>
      </div>
    </dialog>`;
}

export interface StoryDialogHandle {
  /** 从第一段开始播放剧情；已在播放时重新开头。 */
  open(view: StoryView): void;
}

export function bindStoryDialog(onOpen: () => void, onClose: () => void): StoryDialogHandle {
  const dialog = document.querySelector<HTMLDialogElement>('#story-dialog');
  if (!dialog) {
    throw new Error('Missing story dialog');
  }

  const typewriter = createTypewriter(
    {
      label: document.getElementById('story-label'),
      speaker: document.getElementById('story-speaker'),
      line: document.getElementById('story-line'),
      progress: document.getElementById('story-progress'),
      hint: document.getElementById('story-hint'),
    },
    () => dialog.close(),
  );

  const handle: StoryDialogHandle = {
    open(view) {
      if (!dialog.open) {
        onOpen();
        dialog.showModal();
        dialog.focus();
      }
      typewriter.play(storySegments(view));
    },
  };

  dialog.addEventListener('click', () => typewriter.advance());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      typewriter.advance();
    }
  });
  document.getElementById('story-skip')?.addEventListener('click', (event) => {
    event.stopPropagation();
    dialog.close();
  });
  dialog.addEventListener('close', () => {
    typewriter.stop();
    onClose();
  });
  return handle;
}
