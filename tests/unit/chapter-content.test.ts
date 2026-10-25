import { describe, expect, it } from 'vitest';

import { ITEM_CATALOG_IDS } from '../../src/config/game-config';
import { WORLD } from '../../src/config/world-config';
import {
  CODEX_ENTRIES,
  evidenceStoryBeat,
  findStep,
  FIRST_CHAPTER,
  STORY_LOCATION_ANCHORS,
} from '../../src/modules/quests/chapter-content';
import {
  EVIDENCE_FEATHER,
  EVIDENCE_NOTEBOOK,
  NOTEBOOK_PREREQUISITE_HINT,
  QUEST_CHAPTER_ID,
  QUEST_COMPLETE_HINT,
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

describe('剧情稿 v1.1 对齐：学生视角与完整章节', () => {
  it('身份为学生：副标题与正文不出现调查员、夜巡手册等旧口径', () => {
    expect(FIRST_CHAPTER.subtitle).not.toContain('调查员');
    for (const step of FIRST_CHAPTER.steps) {
      expect(step.stepBody).not.toContain('调查员');
      expect(step.stepBody).not.toContain('夜巡手册');
    }
  });

  it('开场文本（6.2）与章节结尾（6.4）齐全，结算提示不承诺范围外功能', () => {
    expect(FIRST_CHAPTER.prologue).toContain('校园卡');
    expect(FIRST_CHAPTER.prologue).toContain('别走地图上没有的路');
    expect(FIRST_CHAPTER.epilogue).toContain('新的记忆缺口');
    expect(FIRST_CHAPTER.settlementSummary).toContain('明湖边的异常羽毛');
    // V1.0 冻结范围不含联机与经济，结算文案不得出现互助组、组队、排行榜等承诺。
    expect(FIRST_CHAPTER.settlementSummary).not.toMatch(/互助组|组队|联机|排行榜/);
  });

  it('每一步的叙事地点都能映射到真实地图锚点（P0：地点 ID 统一）', () => {
    for (const step of FIRST_CHAPTER.steps) {
      const anchor = STORY_LOCATION_ANCHORS[step.locationId];
      expect(anchor, `缺少地点锚点：${step.locationId}`).toBeTruthy();
      if (!anchor) {
        continue;
      }
      if (anchor.kind === 'loot-zone') {
        expect(
          WORLD.lootZones.some((zone) => zone.id === anchor.anchorId),
          `地图不存在搜索区 ${anchor.anchorId}`,
        ).toBe(true);
      } else {
        expect(
          WORLD.gates.some((gate) => gate.name === anchor.anchorId && gate.role === 'extraction'),
          `地图不存在撤离点 ${anchor.anchorId}`,
        ).toBe(true);
      }
    }
  });

  it('局内文案与剧情稿表 7 逐字一致', () => {
    expect(NOTEBOOK_PREREQUISITE_HINT).toBe('湖畔线索：缺少本局残缺手记。');
    expect(QUEST_COMPLETE_HINT).toBe('线索齐备：带回南门撤离可解锁第一章。');
  });
});
