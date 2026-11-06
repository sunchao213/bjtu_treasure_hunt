import { describe, expect, it } from 'vitest';
import {
  activeQuestChapter,
  chapterEvidence,
  chapterUnlockGranted,
  prerequisiteHint,
  questChapterForEvidence,
  questProgress,
  visibleQuestChapters,
} from '../../src/modules/quests/quest-service';
import { CHAPTERS, evidenceStoryBeat } from '../../src/modules/quests/chapter-content';
import { generateLootSpawns, questSpawnPlan } from '../../src/modules/world/loot-spawns';
import { lobbyMissionRows, prepGoalRows } from '../../src/modules/ui/quest-view';
import { FORMAL_SAVE_KEY, PersistentSave } from '../../src/modules/save/persistent-save';
import type { StoragePort } from '../../src/modules/save/reference-save';
import type { ItemInstance, RaidResult } from '../../src/shared/types/game';

const RAID_ID = 'raid-chapter-002';

function loot(itemId: string, inRaid = RAID_ID): ItemInstance {
  return {
    instanceId: `${inRaid}:${itemId}`,
    itemId,
    origin: { kind: 'raid-loot', obtainedInRaidId: inRaid },
  };
}

function result(raidId: string, items: ItemInstance[], questComplete = true): RaidResult {
  return { raidId, outcome: 'success', reason: null, items, value: 160, questComplete };
}

class MemoryStorage implements StoragePort {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

describe('三章进度推进', () => {
  it('大厅按已解锁章节递进展示：第一章 → 加第二章 → 加第三章', () => {
    expect(visibleQuestChapters([]).map((chapter) => chapter.order)).toEqual([1]);
    expect(visibleQuestChapters(['siyuan-code']).map((chapter) => chapter.order)).toEqual([1, 2]);
    expect(
      visibleQuestChapters(['siyuan-code', 'siyuan-key']).map((chapter) => chapter.order),
    ).toEqual([1, 2, 3]);
    expect(
      visibleQuestChapters(['siyuan-code', 'siyuan-key', 'soothe-monster']).map(
        (chapter) => chapter.order,
      ),
    ).toEqual([1, 2, 3]);
  });

  it('第一关通关后当前章节切到第二章，第二关通关后切到第三章', () => {
    expect(activeQuestChapter([]).id).toBe('siyuan-code');
    expect(activeQuestChapter(['siyuan-code']).id).toBe('siyuan-key');
    expect(activeQuestChapter(['siyuan-code', 'siyuan-key']).id).toBe('soothe-monster');
    // 全通后停在第三章，不会产生不存在的第四章。
    expect(activeQuestChapter(['siyuan-code', 'siyuan-key', 'soothe-monster']).id).toBe(
      'soothe-monster',
    );
  });

  it('第二章证据与前置：没有本局校园地图时，思源楼金钥匙被拦截', () => {
    expect(prerequisiteHint('siyuan-key', [], RAID_ID, 'siyuan-key')).toBe(
      '侧门线索：缺少本局被涂改的校园地图。',
    );
    expect(prerequisiteHint('siyuan-key', [loot('campus-map')], RAID_ID, 'siyuan-key')).toBeNull();
    expect(chapterEvidence([loot('campus-map')], RAID_ID, 'siyuan-key').collected).toBe(1);
    expect(
      chapterEvidence([loot('campus-map'), loot('siyuan-key')], RAID_ID, 'siyuan-key').complete,
    ).toBe(true);
  });

  it('第三章证据与前置：没有本局安抚护符时，完整记录被拦截', () => {
    expect(prerequisiteHint('complete-record', [], RAID_ID, 'soothe-monster')).toBe(
      '记录线索：缺少本局安抚护符。',
    );
    expect(
      prerequisiteHint('complete-record', [loot('soothe-charm')], RAID_ID, 'soothe-monster'),
    ).toBeNull();
  });

  it('任务卡文案按当前章节切换，拾取证据能定位到所属章节', () => {
    const progress = questProgress([loot('campus-map')], RAID_ID, 'siyuan-key');
    expect(progress.statusText).toBe('线索二 · 去思源楼侧门，用手电寻找思源楼金钥匙');
    expect(questChapterForEvidence('campus-map')).toBe('siyuan-key');
    expect(questChapterForEvidence('soothe-charm')).toBe('soothe-monster');
    expect(questChapterForEvidence('torn-notebook')).toBe('siyuan-code');
    expect(evidenceStoryBeat('campus-map')).toContain('线索一 · 被涂改的校园地图');
  });

  it('章节结算判定只认本章证据，不会跨章解锁', () => {
    const ch2 = result(RAID_ID, [loot('campus-map'), loot('siyuan-key')]);
    expect(chapterUnlockGranted(ch2, 'siyuan-key')).toBe(true);
    expect(chapterUnlockGranted(ch2, 'soothe-monster')).toBe(false);
    expect(chapterUnlockGranted({ ...ch2, questComplete: false }, 'siyuan-key')).toBe(false);
  });

  it('大厅章节简报：第一章通关后加第二章，第二章通关后再加第三章', () => {
    expect(lobbyMissionRows([])).toEqual([
      expect.objectContaining({ order: 1, statusText: '进行中', status: 'active' }),
    ]);
    expect(lobbyMissionRows(['siyuan-code']).map((row) => [row.order, row.statusText])).toEqual([
      [1, '已完成'],
      [2, '进行中'],
    ]);
    expect(
      lobbyMissionRows(['siyuan-code', 'siyuan-key']).map((row) => [row.order, row.statusText]),
    ).toEqual([
      [1, '已完成'],
      [2, '已完成'],
      [3, '进行中'],
    ]);
  });

  it('行前目标清单跟随章节切换证据名与地点', () => {
    expect(prepGoalRows('siyuan-key')).toEqual([
      { name: '被涂改的校园地图', place: '教学楼群' },
      { name: '思源楼金钥匙', place: '思源楼侧门' },
      { name: '携带价值 ≥ 100', place: '南门 · 撤离点' },
    ]);
    expect(prepGoalRows('soothe-monster')[0]).toEqual({ name: '安抚护符', place: '芳华园' });
  });

  it('每章证据刷新到指定区域，三章都有可读剧情档案', () => {
    expect(questSpawnPlan('siyuan-key')).toEqual([
      { itemId: 'campus-map', zoneId: 'central-lawn', index: 0 },
      { itemId: 'siyuan-key', zoneId: 'library', index: 0 },
    ]);
    const spawns = generateLootSpawns(() => 0.5, questSpawnPlan('siyuan-key'));
    expect(spawns.find((spawn) => spawn.itemId === 'campus-map')?.zoneId).toBe('central-lawn');
    expect(spawns.find((spawn) => spawn.itemId === 'siyuan-key')?.zoneId).toBe('library');
    expect(CHAPTERS['siyuan-key']?.steps).toHaveLength(3);
    expect(CHAPTERS['soothe-monster']?.steps).toHaveLength(3);
  });
});

describe('存档层按章节递进解锁', () => {
  it('依次通关三章后，解锁列表按顺序累加，重复提交不重复发放', async () => {
    const storage = new MemoryStorage();
    const save = new PersistentSave(storage);

    await save.beginRaid('ch1', []);
    await save.finalizeRaid(
      result('ch1', [loot('torn-notebook', 'ch1'), loot('anomalous-feather', 'ch1')]),
    );
    expect(save.view().unlockedChapterIds).toEqual(['siyuan-code']);

    await save.beginRaid('ch2', []);
    await save.finalizeRaid(result('ch2', [loot('campus-map', 'ch2'), loot('siyuan-key', 'ch2')]));
    expect(save.view().unlockedChapterIds).toEqual(['siyuan-code', 'siyuan-key']);
    // 同一局重复结算（重试保存）不会把第二章重复写进列表。
    await save.finalizeRaid(result('ch2', [loot('campus-map', 'ch2'), loot('siyuan-key', 'ch2')]));
    expect(save.view().unlockedChapterIds).toEqual(['siyuan-code', 'siyuan-key']);

    await save.beginRaid('ch3', []);
    await save.finalizeRaid(
      result('ch3', [loot('soothe-charm', 'ch3'), loot('complete-record', 'ch3')]),
    );
    expect(save.view().unlockedChapterIds).toEqual(['siyuan-code', 'siyuan-key', 'soothe-monster']);

    const reloaded = new PersistentSave(storage);
    expect(reloaded.view().unlockedChapterIds).toHaveLength(3);
    expect(reloaded.view().unlockedChapterIds).not.toContain('chapter-4');
    expect(storage.getItem(FORMAL_SAVE_KEY)).not.toBeNull();
  });

  it('第一章未解锁时，第二章证据不会越过前置直接解锁第二章', async () => {
    const save = new PersistentSave(new MemoryStorage());
    await save.beginRaid('skip', []);
    await save.finalizeRaid(
      result('skip', [loot('campus-map', 'skip'), loot('siyuan-key', 'skip')]),
    );
    // 当前章节仍是第一章，因此这次结算只判定第一章，第二章保持锁定。
    expect(save.view().unlockedChapterIds).toEqual([]);
  });
});
