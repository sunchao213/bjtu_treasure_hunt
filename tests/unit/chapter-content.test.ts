import { describe, expect, it } from 'vitest';

import { ITEM_CATALOG_IDS } from '../../src/config/game-config';
import { CODEX_ENTRIES, findAct, FIRST_CHAPTER } from '../../src/modules/quests/chapter-content';
import {
  EVIDENCE_FEATHER,
  EVIDENCE_NOTEBOOK,
  QUEST_CHAPTER_ID,
} from '../../src/modules/quests/quest-service';

describe('第一章剧情内容', () => {
  it('章节归属与任务模块一致，且为三幕结构', () => {
    expect(FIRST_CHAPTER.chapterId).toBe(QUEST_CHAPTER_ID);
    expect(FIRST_CHAPTER.acts).toHaveLength(3);
    expect(FIRST_CHAPTER.acts.map((act) => act.order)).toEqual([1, 2, 3]);
  });

  it('幕 ID 唯一且可检索，地点与搜索点对齐', () => {
    const ids = FIRST_CHAPTER.acts.map((act) => act.actId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findAct(FIRST_CHAPTER, 'act-1-library-shelf')?.locationId).toBe('library-outside-shelf');
    expect(findAct(FIRST_CHAPTER, 'act-2-minghu-stele')?.locationId).toBe('minghu-stele');
    expect(findAct(FIRST_CHAPTER, 'act-3-south-extraction')?.locationId).toBe(
      'south-extraction-point',
    );
    expect(findAct(FIRST_CHAPTER, 'act-missing')).toBeUndefined();
  });

  it('各幕前置证据与任务链一致：手记 → 石碑 → 两件证据', () => {
    expect(findAct(FIRST_CHAPTER, 'act-1-library-shelf')?.requiresEvidence).toEqual([]);
    expect(findAct(FIRST_CHAPTER, 'act-2-minghu-stele')?.requiresEvidence).toEqual([
      EVIDENCE_NOTEBOOK,
    ]);
    expect(findAct(FIRST_CHAPTER, 'act-3-south-extraction')?.requiresEvidence).toEqual([
      EVIDENCE_NOTEBOOK,
      EVIDENCE_FEATHER,
    ]);
  });

  it('每幕正文有实质内容，未出现占位文字', () => {
    for (const act of FIRST_CHAPTER.acts) {
      expect(act.title.length).toBeGreaterThan(0);
      expect(act.body.length).toBeGreaterThan(60);
      expect(act.body).not.toContain('待填写');
    }
    expect(FIRST_CHAPTER.unlockHint).toContain('成功撤离');
  });
});

describe('图鉴条目描述', () => {
  it('12 种目录物品全部有描述', () => {
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
