import { describe, expect, it } from 'vitest';

import {
  carriedEvidence,
  chapterUnlockGranted,
  isQuestComplete,
  NOTEBOOK_PREREQUISITE_HINT,
  prerequisiteHint,
  QUEST_COMPLETE_HINT,
  questProgress,
} from '../../src/modules/quests/quest-service';
import type { ItemInstance, RaidResult } from '../../src/shared/types/game';

const RAID_ID = 'raid-demo-001';

function loot(instanceId: string, itemId: string, inRaid = RAID_ID): ItemInstance {
  return { instanceId, itemId, origin: { kind: 'raid-loot', obtainedInRaidId: inRaid } };
}

function carryIn(instanceId: string, itemId: string): ItemInstance {
  return { instanceId, itemId, origin: { kind: 'carry-in' } };
}

const notebook = loot('inst-notebook', 'torn-notebook');
const feather = loot('inst-feather', 'anomalous-feather');

function result(overrides: Partial<RaidResult> = {}): RaidResult {
  return {
    raidId: RAID_ID,
    outcome: 'success',
    reason: null,
    items: [notebook, feather],
    value: 110,
    questComplete: true,
    ...overrides,
  };
}

describe('地点调查前置判定', () => {
  it('未持本局残缺手记时，明湖石碑被拦截并给出提示', () => {
    expect(prerequisiteHint('anomalous-feather', [], RAID_ID)).toBe(NOTEBOOK_PREREQUISITE_HINT);
  });

  it('持本局手记后允许调查石碑', () => {
    expect(prerequisiteHint('anomalous-feather', [notebook], RAID_ID)).toBeNull();
  });

  it('非任务搜索点一律放行', () => {
    expect(prerequisiteHint('torn-notebook', [], RAID_ID)).toBeNull();
    expect(prerequisiteHint('scratch-paper', [], RAID_ID)).toBeNull();
  });

  it('带入物与上一局手记都不满足前置', () => {
    expect(prerequisiteHint('anomalous-feather', [carryIn('c1', 'torn-notebook')], RAID_ID)).toBe(
      NOTEBOOK_PREREQUISITE_HINT,
    );
    expect(
      prerequisiteHint('anomalous-feather', [loot('old', 'torn-notebook', 'raid-old')], RAID_ID),
    ).toBe(NOTEBOOK_PREREQUISITE_HINT);
  });
});

describe('本局任务进度', () => {
  it('凑齐两件证据时判定完成', () => {
    expect(isQuestComplete([notebook, feather], RAID_ID)).toBe(true);
    expect(isQuestComplete([notebook], RAID_ID)).toBe(false);
    expect(isQuestComplete([], RAID_ID)).toBe(false);
  });

  it('证据统计只认本局 raid-loot', () => {
    const evidence = carriedEvidence([carryIn('c1', 'torn-notebook'), feather], RAID_ID);
    expect(evidence).toEqual({ notebook: false, feather: true, collected: 1 });
  });

  it('任务卡文案按进度推进，并给出下一步方位指引', () => {
    expect(questProgress([], null).statusText).toBe('开始探索后，可按线索搜集任务证据。');
    expect(questProgress([], RAID_ID).statusText).toBe('线索一 · 去图书馆东侧金色点搜残缺手记');
    expect(questProgress([notebook], RAID_ID).statusText).toBe(
      '线索二 · 去明湖石碑（明湖东侧金色点）搜异常羽毛',
    );
    const done = questProgress([notebook, feather], RAID_ID);
    expect(done.statusText).toBe('线索齐备 · 带回南门撤离可解锁章节');
    expect(done.collected).toBe(2);
    expect(done.complete).toBe(true);
  });
});

describe('章节解锁判定（与 SavePort.finalizeRaid 规则一致）', () => {
  it('成功 + questComplete + 两件本局证据 → 解锁', () => {
    expect(chapterUnlockGranted(result())).toBe(true);
  });

  it('questComplete 缺失或为 false 时不解锁', () => {
    expect(chapterUnlockGranted(result({ questComplete: false }))).toBe(false);
    expect(chapterUnlockGranted(result({ questComplete: undefined }))).toBe(false);
  });

  it('失败结算永不解锁', () => {
    expect(chapterUnlockGranted(result({ outcome: 'failed', reason: 'timeout', items: [] }))).toBe(
      false,
    );
  });

  it('证据只有一件或不属于本局时不解锁', () => {
    expect(chapterUnlockGranted(result({ items: [notebook] }))).toBe(false);
    expect(
      chapterUnlockGranted(result({ items: [loot('n', 'torn-notebook', 'raid-old'), feather] })),
    ).toBe(false);
  });

  it('凑齐后丢弃任一证据（不在结算 items 中）→ 不解锁', () => {
    expect(chapterUnlockGranted(result({ items: [feather] }))).toBe(false);
  });
});

describe('文案契约', () => {
  it('场景与界面使用同一组文案常量', () => {
    expect(NOTEBOOK_PREREQUISITE_HINT).toBe('湖畔线索 · 缺少本局残缺手记');
    expect(QUEST_COMPLETE_HINT).toBe('手记与异常羽毛已凑齐；带着它们成功撤离可解锁思源密码。');
  });
});
