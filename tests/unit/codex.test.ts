import { describe, expect, it } from 'vitest';
import { getCodexEntries } from '../../src/modules/ui/codex';
import { archiveEntries, VALUE_COLLECTION_IDS } from '../../src/modules/ui/archive-browser';
import { ALL_ITEM_IDS } from '../../src/config/game-config';
import { CODEX_ENTRIES } from '../../src/modules/quests/chapter-content';
import type { ItemInstance } from '../../src/shared/types/game';

const stored = (id: string, itemId: string): ItemInstance => ({
  instanceId: id,
  itemId,
  origin: { kind: 'carry-in' },
});

describe('value collection and permanent warehouse', () => {
  it('only catalogs value-only items, keeping quest evidence, healing and utilities out', () => {
    const ids = getCodexEntries(ALL_ITEM_IDS).map((entry) => entry.id);
    expect(ids).toEqual(VALUE_COLLECTION_IDS);
    expect(ids).toContain('silver-watch');
    expect(ids).toContain('david-head-statue');
    for (const id of [
      'anomalous-feather',
      'siyuan-key',
      'portable-medkit',
      'morning-coffee',
      'roller-skates',
      'electric-bike-helmet',
      'soothe-charm',
      'bandage',
    ]) {
      expect(ids).not.toContain(id);
    }
  });

  it('uses current rarity and per-item values for the unlocked collection', () => {
    const entries = getCodexEntries(['silver-watch', 'david-head-statue', 'gpa-charm']);
    expect(entries.find((entry) => entry.id === 'silver-watch')).toMatchObject({
      name: '银色手表',
      rarity: '传说',
      value: 100,
      unlocked: true,
    });
    expect(entries.find((entry) => entry.id === 'david-head-statue')).toMatchObject({
      rarity: '史诗',
      value: 80,
    });
    expect(entries.find((entry) => entry.id === 'gpa-charm')?.value).toBe(50);
  });

  it('hides identity, value and purpose until a collectible is unlocked', () => {
    const entry = getCodexEntries([]).find((item) => item.id === 'silver-watch')!;
    expect(entry).toMatchObject({
      unlocked: false,
      name: '未发现物品',
      rarity: '未解锁',
      value: null,
      icon: 'locked',
    });
    expect(entry.description).not.toContain('银色手表');
  });

  it('ignores unknown save IDs and duplicate unlock records', () => {
    const entries = getCodexEntries(['unknown', 'silver-watch', 'silver-watch', 'bandage']);
    expect(entries.filter((entry) => entry.unlocked)).toHaveLength(1);
  });

  it('preserves existing item lore and functional details for exports', () => {
    for (const entry of getCodexEntries(VALUE_COLLECTION_IDS)) {
      expect(entry.description).toContain(CODEX_ENTRIES[entry.id]);
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });

  it('groups warehouse copies and includes purchased supplies, evidence and collectibles', () => {
    const snapshot = {
      codexIds: [],
      warehouse: [
        stored('a', 'bandage'),
        stored('b', 'bandage'),
        stored('c', 'anomalous-feather'),
        stored('d', 'silver-watch'),
        stored('e', 'unknown'),
      ],
    };
    expect(archiveEntries(snapshot, 'warehouse')).toEqual([
      { id: 'anomalous-feather', unlocked: true, count: 1 },
      { id: 'silver-watch', unlocked: true, count: 1 },
      { id: 'bandage', unlocked: true, count: 2 },
    ]);
    expect(archiveEntries({ codexIds: [], warehouse: [] }, 'warehouse')).toEqual([]);
  });

  it('unlocks the collection from permanent discovery records independently of warehouse possession', () => {
    const entries = archiveEntries(
      { codexIds: ['david-head-statue'], warehouse: [stored('a', 'silver-watch')] },
      'collection',
    );
    expect(entries.find((entry) => entry.id === 'david-head-statue')?.unlocked).toBe(true);
    expect(entries.find((entry) => entry.id === 'silver-watch')?.unlocked).toBe(false);
  });
});
