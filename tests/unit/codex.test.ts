import { describe, expect, it } from 'vitest';
import { getCodexEntries } from '../../src/modules/ui/codex';
import { EXPLORATION_CATALOG_IDS, ITEM_CATALOG_IDS } from '../../src/config/game-config';
import { CODEX_ENTRIES } from '../../src/modules/quests/chapter-content';

describe('persistent collection gallery', () => {
  it('registers the three new collectibles with assigned rarity and value', () => {
    const ids = ['electric-bike-helmet', 'david-head-statue', 'silver-watch'];
    const entries = getCodexEntries(ids).filter((entry) => ids.includes(entry.id));
    expect(entries).toMatchObject([
      {
        id: 'electric-bike-helmet',
        name: '电瓶车头盔',
        rarity: '普通',
        value: 15,
        unlocked: true,
      },
      { id: 'david-head-statue', name: '大卫头雕像', rarity: '史诗', value: 80, unlocked: true },
      { id: 'silver-watch', name: '银色手表', rarity: '传说', value: 100, unlocked: true },
    ]);
  });

  it('adds three collectible slots with their specified quality, value and blank artwork', () => {
    const ids = ['strange-veined-ginkgo-leaf', 'hunter-binoculars', 'roller-skates'];
    const entries = getCodexEntries(ids);
    expect(entries.filter((entry) => ids.includes(entry.id))).toMatchObject([
      { name: '叶脉奇怪的银杏叶', rarity: '传说', value: 150, icon: 'leaf', unlocked: true },
      { name: '猎手望远镜', rarity: '史诗', value: 60, icon: 'binoculars', unlocked: true },
      { name: '轮滑鞋', rarity: '普通', value: 15, icon: 'skates', unlocked: true },
    ]);
    const locked = getCodexEntries([]).filter((entry) => ids.includes(entry.id));
    expect(locked).toHaveLength(3);
    for (const entry of locked) {
      expect(entry).toMatchObject({ name: '未发现物品', value: null, unlocked: false });
    }
  });

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
    expect(known.description).toContain('第一章主线证据');
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
      '恢复 15 点生命',
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
