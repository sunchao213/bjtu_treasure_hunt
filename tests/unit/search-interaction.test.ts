import { describe, expect, it } from 'vitest';
import { SearchInteraction } from '../../src/modules/world/search-interaction';
import type { ItemInstance } from '../../src/shared/types/game';

const item: ItemInstance = {
  instanceId: 'raid-1:library-west',
  itemId: 'window-seat',
  origin: { kind: 'raid-loot', obtainedInRaidId: 'raid-1' },
};

describe('SearchInteraction', () => {
  it('requires the full duration and marks a point only after insertion succeeds', () => {
    let now = 0;
    const search = new SearchInteraction(2_000, () => now);
    search.begin('library-west');
    now = 1_999;
    expect(search.finish(item, () => ({ ok: true, value: undefined }))).toEqual({
      ok: false,
      error: 'INVALID_STATE',
    });
    now = 2_000;
    expect(search.finish(item, () => ({ ok: true, value: undefined }))).toEqual({
      ok: true,
      value: undefined,
    });
    expect(search.begin('library-west')).toBe(false);
  });

  it('keeps the point searchable when inventory rejects the item', () => {
    let now = 0;
    const search = new SearchInteraction(2_000, () => now);
    search.begin('lake-east');
    now = 2_000;
    expect(search.finish(item, () => ({ ok: false, error: 'INVENTORY_FULL' }))).toEqual({
      ok: false,
      error: 'INVENTORY_FULL',
    });
    expect(search.begin('lake-east')).toBe(true);
    now = 4_000;
    expect(search.finish(item, () => ({ ok: true, value: undefined })).ok).toBe(true);
  });

  it('marks the completed point when pickup opens a story and cancels interaction', () => {
    let now = 0;
    const search = new SearchInteraction(2_000, () => now);
    search.begin('library-west');
    now = 2_000;
    const result = search.finish(item, () => {
      // ItemPicked opens the story dialog synchronously, clearing scene interactions.
      search.cancel();
      return { ok: true, value: undefined };
    });
    expect(result.ok).toBe(true);
    expect(search.isOpened('library-west')).toBe(true);
    expect(search.begin('library-west')).toBe(false);
    expect(search.current()).toBeNull();
  });

  it('cancels progress when interaction is interrupted', () => {
    let now = 500;
    const search = new SearchInteraction(2_000, () => now);
    search.begin('garden-east');
    now = 1_000;
    search.cancel();
    expect(search.progress()).toBe(0);
    expect(search.finish(item, () => ({ ok: true, value: undefined }))).toEqual({
      ok: false,
      error: 'INVALID_STATE',
    });
  });
});
