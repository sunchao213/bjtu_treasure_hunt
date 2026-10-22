import { describe, expect, it } from 'vitest';

import { ITEM_CATALOG_IDS } from '../../src/config/game-config';
import {
  CODEX_ENTRIES,
  evidenceStoryBeat,
  findStep,
  FIRST_CHAPTER,
} from '../../src/modules/quests/chapter-content';
import {
  EVIDENCE_FEATHER,
  EVIDENCE_NOTEBOOK,
  QUEST_CHAPTER_ID,
} from '../../src/modules/quests/quest-service';

describe('第一章剧情内容', () => {
  it('章节归属与任务模块一致，且为三步任务链的对应内容', () => {
    expect(FIRST_CHAPTER.chapterId).toBe(QUEST_CHAPTER_ID);
    expect(FIRST_CHAPTER.steps).toHaveLength(3);
    expect(FIRST_CHAPTER.steps.map((step) => step.stepNumber)).toEqual([1, 2, 3]);
    expect(FIRST_CHAPTER.steps.map((step) => step.title.slice(0, 3))).toEqual([
      '线索一',
      '线索二',
      '线索三',
    ]);
  });

  it('步骤 ID 唯一且可检索，地点与搜索点对齐', () => {
    const ids = FIRST_CHAPTER.steps.map((step) => step.stepId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findStep(FIRST_CHAPTER, 'step-1-library-shelf')?.locationId).toBe(
      'library-outside-shelf',
    );
    expect(findStep(FIRST_CHAPTER, 'step-2-minghu-stele')?.locationId).toBe('minghu-stele');
    expect(findStep(FIRST_CHAPTER, 'step-3-south-extraction')?.locationId).toBe(
      'south-extraction-point',
    );
    expect(findStep(FIRST_CHAPTER, 'step-missing')).toBeUndefined();
  });

  it('每一步的前置证据与任务链一致：手记 → 石碑 → 两件证据', () => {
    expect(findStep(FIRST_CHAPTER, 'step-1-library-shelf')?.requiresEvidence).toEqual([]);
    expect(findStep(FIRST_CHAPTER, 'step-2-minghu-stele')?.requiresEvidence).toEqual([
      EVIDENCE_NOTEBOOK,
    ]);
    expect(findStep(FIRST_CHAPTER, 'step-3-south-extraction')?.requiresEvidence).toEqual([
      EVIDENCE_NOTEBOOK,
      EVIDENCE_FEATHER,
    ]);
  });

  it('每段正文有实质内容，未出现占位文字', () => {
    for (const step of FIRST_CHAPTER.steps) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.stepBody.length).toBeGreaterThan(60);
      expect(step.stepBody).not.toContain('待填写');
    }
    expect(FIRST_CHAPTER.unlockHint).toContain('成功撤离');
  });

  it('场景剧情提示只对任务证据生效，并带上步骤标题', () => {
    expect(evidenceStoryBeat(EVIDENCE_NOTEBOOK)).toContain('线索一');
    expect(evidenceStoryBeat(EVIDENCE_FEATHER)).toContain('线索二');
    expect(evidenceStoryBeat('scratch-paper')).toBeNull();
  });
});

describe('图鉴条目描述', () => {
  it('所有图鉴物品都有描述', () => {
    for (const itemId of ITEM_CATALOG_IDS) {
      expect(CODEX_ENTRIES[itemId], `缺少图鉴描述：${itemId}`).toBeTruthy();
    }
  });

  it('描述均为可读短句，不含占位词', () => {
    for (const [itemId, entry] of Object.entries(CODEX_ENTRIES)) {
      expect(entry.length, `${itemId} 描述过短`).toBeGreaterThan(8);
      expect(entry).not.toContain('TODO');
    }
  });
});
