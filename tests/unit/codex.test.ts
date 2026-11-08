import { describe, expect, it } from 'vitest';
import { getCodexEntries } from '../../src/modules/ui/codex';
import { EXPLORATION_CATALOG_IDS, ITEM_CATALOG_IDS } from '../../src/config/game-config';
import { CODEX_ENTRIES } from '../../src/modules/quests/chapter-content';

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
    expect(known.description).toContain('普通收藏物');
  });

  it('ignores unknown save IDs and counts duplicate unlock IDs only once', () => {
    const entries = getCodexEntries([
      'unknown-item',
      'portable-medkit',
      'portable-medkit',
      'morning-coffee',
    ]);
    expect(entries.filter((e) => e.unlocked)).toHaveLength(2);
    expect(entries.map((e) => e.id)).toEqual(EXPLORATION_CATALOG_IDS);
    expect(entries.find((e) => e.id === 'portable-medkit')?.description).toContain(
      '恢复 30 点生命',
    );
  });

  it('preserves the teammate-authored lore for every unlocked catalog entry', () => {
    for (const entry of getCodexEntries(ITEM_CATALOG_IDS)) {
      if (CODEX_ENTRIES[entry.id]) expect(entry.description).toContain(CODEX_ENTRIES[entry.id]);
    }
  });

  it('shows every item that can be saved after extraction', () => {
    const unlocked = getCodexEntries(['morning-coffee', 'training-bat', 'stun-baton'])
      .filter((entry) => entry.unlocked)
      .map((entry) => entry.id);
    expect(unlocked).toEqual(['morning-coffee']);
  });

  it('does not add shop-only supplies to the exploration gallery', () => {
    const ids = getCodexEntries(['bandage', 'yellow-bike', 'thick-down-jacket']).map(
      (entry) => entry.id,
    );
    expect(ids).not.toContain('bandage');
    expect(ids).not.toContain('yellow-bike');
    expect(ids).not.toContain('thick-down-jacket');
  });
});
