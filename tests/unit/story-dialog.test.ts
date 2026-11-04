import { describe, expect, it } from 'vitest';
import { FIRST_CHAPTER } from '../../src/modules/quests/chapter-content';
import {
  stepForEvidence,
  storyDialogMarkup,
  storySegments,
} from '../../src/modules/ui/story-dialog';
import { EVIDENCE_FEATHER, EVIDENCE_NOTEBOOK } from '../../src/modules/quests/quest-service';

describe('剧情对话 · storySegments 台词序列', () => {
  it('step 只呈现对应线索正文，标签为线索标题', () => {
    const step = FIRST_CHAPTER.steps[0]!;
    const segments = storySegments({ kind: 'step', step });
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((s) => s.label === step.title)).toBe(true);
    expect(segments.map((s) => s.text).join('')).toBe(step.stepBody);
  });

  it('ending 包含章节结尾与结算提示，且不承诺范围外功能', () => {
    const segments = storySegments({ kind: 'ending' });
    const all = segments.map((s) => s.text).join('');
    expect(all).toContain(FIRST_CHAPTER.epilogue);
    expect(all).toContain(FIRST_CHAPTER.settlementSummary);
    expect(all).not.toMatch(/互助组|组队|联机|排行榜/);
    expect(segments.at(-1)!.label).toBe('下一步');
  });

  it('full-chapter 依次覆盖开场、全部线索与结尾', () => {
    const segments = storySegments({ kind: 'full-chapter' });
    const labels = [...new Set(segments.map((s) => s.label))];
    expect(labels).toEqual([
      '开场 · 晚归的路上',
      ...FIRST_CHAPTER.steps.map((step) => step.title),
      '章节结尾 · 新的记忆缺口',
      '下一步',
    ]);
  });

  it('每一段台词都有内容，说话人为旁白', () => {
    for (const view of [
      { kind: 'ending' } as const,
      { kind: 'full-chapter' } as const,
      { kind: 'step', step: FIRST_CHAPTER.steps[1]! } as const,
    ]) {
      for (const segment of storySegments(view)) {
        expect(segment.text.trim().length).toBeGreaterThan(0);
        expect(segment.speaker).toBe('旁白');
      }
    }
  });
});

describe('剧情对话 · stepForEvidence 拾取触发映射', () => {
  it('残缺手记触发线索一，异常羽毛触发线索二', () => {
    expect(stepForEvidence(EVIDENCE_NOTEBOOK)).toBe(FIRST_CHAPTER.steps[0]);
    expect(stepForEvidence(EVIDENCE_FEATHER)).toBe(FIRST_CHAPTER.steps[1]);
  });

  it('非任务证据与未知 ID 不触发对话', () => {
    expect(stepForEvidence('morning-coffee')).toBeUndefined();
    expect(stepForEvidence('unknown-item')).toBeUndefined();
  });
});

describe('剧情对话 · 骨架标记', () => {
  it('使用与序章一致的「旁白」台词卡结构', () => {
    const markup = storyDialogMarkup();
    expect(markup).toContain('<dialog id="story-dialog" class="story-dialog"');
    expect(markup).toContain('class="story-box"');
    expect(markup).toContain('class="story-speaker"');
    for (const id of [
      'story-label',
      'story-speaker',
      'story-line',
      'story-progress',
      'story-hint',
      'story-skip',
    ]) {
      expect(markup).toContain(`id="${id}"`);
    }
  });
});
