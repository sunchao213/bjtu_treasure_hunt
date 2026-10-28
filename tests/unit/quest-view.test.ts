import { describe, expect, it } from 'vitest';
import { chapterLockHint } from '../../src/modules/ui/quest-view';
import type { ItemInstance, RaidResult } from '../../src/shared/types/game';

const loot = (itemId: string, instanceId: string): ItemInstance => ({
  instanceId,
  itemId,
  origin: { kind: 'raid-loot', obtainedInRaidId: 'raid-1' },
});

const result = (overrides: Partial<RaidResult> = {}): RaidResult => ({
  raidId: 'raid-1',
  outcome: 'success',
  reason: null,
  items: [],
  value: 120,
  questComplete: false,
  ...overrides,
});

describe('R07 撤离成功但未解锁时的说明', () => {
  it('两件证据都没带回时同时点名两件', () => {
    const hint = chapterLockHint(result());
    expect(hint).toBe('本章未解锁：需同时带回「残缺手记」和「异常羽毛」。');
  });

  it('只带回手记时只提示缺羽毛', () => {
    const hint = chapterLockHint(result({ items: [loot('torn-notebook', 'a')] }));
    expect(hint).toContain('「异常羽毛」');
    expect(hint).not.toContain('「残缺手记」');
  });

  it('只带回羽毛时只提示缺手记', () => {
    const hint = chapterLockHint(result({ items: [loot('anomalous-feather', 'b')] }));
    expect(hint).toContain('「残缺手记」');
    expect(hint).not.toContain('「异常羽毛」');
  });

  it('带入的物品不算证据，仍提示两件都缺', () => {
    const hint = chapterLockHint(
      result({
        items: [
          { instanceId: 'x', itemId: 'torn-notebook', origin: { kind: 'carry-in' } },
          { instanceId: 'y', itemId: 'anomalous-feather', origin: { kind: 'carry-in' } },
        ],
      }),
    );
    expect(hint).toBe('本章未解锁：需同时带回「残缺手记」和「异常羽毛」。');
  });

  it('两件都在但主线标志缺失时给兜底文案，不输出残缺句子', () => {
    const hint = chapterLockHint(
      result({ items: [loot('torn-notebook', 'a'), loot('anomalous-feather', 'b')] }),
    );
    expect(hint).toBe('本章未解锁：主线条件未满足，请核对任务进度。');
  });

  it('两件证据齐全且任务完成时不再提示', () => {
    const hint = chapterLockHint(
      result({
        items: [loot('torn-notebook', 'a'), loot('anomalous-feather', 'b')],
        questComplete: true,
      }),
    );
    expect(hint).toBeNull();
  });

  it('失败结算不提示解锁说明', () => {
    expect(chapterLockHint(result({ outcome: 'failed', reason: 'death' }))).toBeNull();
    expect(chapterLockHint(null)).toBeNull();
  });
});
