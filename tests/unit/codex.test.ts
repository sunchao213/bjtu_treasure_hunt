import { describe, expect, it } from 'vitest';
import { getCodexEntries } from '../../src/modules/ui/codex';

describe('persistent collection gallery', () => {
  it('hides identity, value and purpose until an entry is unlocked', () => {
    const locked = getCodexEntries([]).find((e) => e.id === 'anomalous-feather')!;
    expect(locked).toMatchObject({
      unlocked: false,
      name: '未发现物品',
      rarity: '未解锁',
      value: null,
      icon: 'locked',
    });
    expect(locked.description).not.toContain('明湖');
    const known = getCodexEntries(['anomalous-feather']).find((e) => e.id === 'anomalous-feather')!;
    expect(known).toMatchObject({
      unlocked: true,
      name: '异常羽毛',
      rarity: '史诗',
      value: 60,
      icon: 'feather',
    });
    expect(known.description).toContain('本局残缺手记');
  });

  it('ignores unknown save IDs and counts duplicate unlock IDs only once', () => {
    const entries = getCodexEntries(['unknown-item', 'morning-coffee', 'morning-coffee']);
    expect(entries.filter((e) => e.unlocked)).toHaveLength(1);
    expect(entries.find((e) => e.id === 'morning-coffee')?.description).toContain('恢复 25 点生命');
  });
});
