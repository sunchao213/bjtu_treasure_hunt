import { describe, expect, it } from 'vitest';
import {
  carriedEvidence,
  chapterUnlockGranted,
  hasCurrentRaidNotebook,
  isQuestComplete,
  NOTEBOOK_PREREQUISITE_HINT,
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

describe('本局手记身份判定', () => {
  it('只认本局新获得且仍携带的残缺手记', () => {
    expect(hasCurrentRaidNotebook([notebook], RAID_ID)).toBe(true);
    expect(hasCurrentRaidNotebook([carryIn('carry', 'torn-notebook')], RAID_ID)).toBe(false);
    expect(hasCurrentRaidNotebook([loot('old', 'torn-notebook', 'raid-old')], RAID_ID)).toBe(false);
    expect(hasCurrentRaidNotebook([notebook], null)).toBe(false);
  });

  it('异常羽毛按普通收藏处理，不计入任务进度', () => {
    expect(carriedEvidence([feather], RAID_ID)).toEqual({ notebook: false, collected: 0 });
    expect(isQuestComplete([notebook, feather], RAID_ID, false)).toBe(false);
    expect(isQuestComplete([notebook], RAID_ID, true)).toBe(true);
  });
});

describe('明湖石碑任务进度', () => {
  it('必须同时持有本局手记并已调查石碑才完成', () => {
    expect(isQuestComplete([], RAID_ID, true)).toBe(false);
    expect(isQuestComplete([notebook], RAID_ID, false)).toBe(false);
    expect(isQuestComplete([carryIn('carry', 'torn-notebook')], RAID_ID, true)).toBe(false);
    expect(isQuestComplete([loot('old', 'torn-notebook', 'raid-old')], RAID_ID, true)).toBe(false);
    expect(isQuestComplete([notebook], RAID_ID, true)).toBe(true);
  });

  it('进度卡显示取得手记与调查石碑两步', () => {
    expect(questProgress([], null).statusText).toBe('开始探索后，可按线索推进任务。');
    const initial = questProgress([], RAID_ID);
    expect(initial.statusText).toContain('思源楼前');
    expect(initial.collected).toBe(0);

    const notebookOnly = questProgress([notebook], RAID_ID);
    expect(notebookOnly.statusText).toContain('明湖石碑');
    expect(notebookOnly.collected).toBe(1);
    expect(notebookOnly.complete).toBe(false);

    const done = questProgress([notebook], RAID_ID, true);
    expect(done.statusText).toBe(QUEST_COMPLETE_HINT);
    expect(done.collected).toBe(2);
    expect(done.complete).toBe(true);
  });

  it('石碑先于手记调查时提示先取得本局手记', () => {
    expect(questProgress([], RAID_ID, true).statusText).toBe(NOTEBOOK_PREREQUISITE_HINT);
  });
});

describe('章节解锁判定', () => {
  it('成功撤离、任务已完成且携带本局手记时解锁，羽毛无关', () => {
    expect(chapterUnlockGranted(result({ items: [notebook] }))).toBe(true);
    expect(chapterUnlockGranted(result({ items: [notebook, feather] }))).toBe(true);
  });

  it('缺手记、未调查或任务标记缺失时不解锁', () => {
    expect(chapterUnlockGranted(result({ items: [feather] }))).toBe(false);
    expect(chapterUnlockGranted(result({ questComplete: false }))).toBe(false);
    expect(chapterUnlockGranted(result({ questComplete: undefined }))).toBe(false);
  });

  it('上一局或带入的手记不解锁，失败撤离也不解锁', () => {
    expect(
      chapterUnlockGranted(result({ items: [loot('old', 'torn-notebook', 'raid-old')] })),
    ).toBe(false);
    expect(chapterUnlockGranted(result({ items: [carryIn('carry', 'torn-notebook')] }))).toBe(
      false,
    );
    expect(chapterUnlockGranted(result({ outcome: 'failed', reason: 'timeout', items: [] }))).toBe(
      false,
    );
  });
});
