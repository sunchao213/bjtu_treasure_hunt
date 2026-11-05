import { describe, expect, it } from 'vitest';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import { retainSettlementItems } from '../../src/modules/save/settlement-retention';
import type { ItemInstance } from '../../src/shared/types/game';

const item = (instanceId: string, itemId: string): ItemInstance => ({
  instanceId,
  itemId,
  origin: { kind: 'raid-loot', obtainedInRaidId: 'raid' },
});

describe('settlement retention', () => {
  it('keeps the newest value-only item and converts duplicates to 交子', () => {
    const retained = retainSettlementItems(
      [item('old', 'school-badge')],
      [item('new', 'school-badge')],
      7,
      ITEM_DEFINITIONS,
      RAID_RULES.values,
    );
    expect(retained.warehouse.map((entry) => entry.instanceId)).toEqual(['new']);
    expect(retained.currency).toBe(7 + RAID_RULES.values.uncommon);
  });

  it('keeps functional items as separate instances', () => {
    const retained = retainSettlementItems(
      [item('old', 'morning-coffee')],
      [item('new', 'morning-coffee')],
      0,
      ITEM_DEFINITIONS,
      RAID_RULES.values,
    );
    expect(retained.warehouse.map((entry) => entry.instanceId)).toEqual(['old', 'new']);
    expect(retained.currency).toBe(0);
  });
});
