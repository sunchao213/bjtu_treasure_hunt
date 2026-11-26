import { describe, expect, it } from 'vitest';
import { RaidHotbar } from '../../src/modules/inventory/raid-hotbar';
import type { ItemInstance } from '../../src/shared/types/game';

const item = (itemId: string, instanceId = itemId): ItemInstance => ({
  itemId,
  instanceId,
  origin: { kind: 'carry-in' },
});
describe('raid hotbar', () => {
  it('keeps all four positions selectable with zero, one, two or three carried tools', () => {
    const tools = ['training-bat', 'bandage', 'yellow-bike'];
    for (let count = 0; count <= tools.length; count++) {
      const hotbar = new RaidHotbar();
      const carried = tools.slice(0, count).map((id) => item(id));
      hotbar.sync('raid-a', carried);
      expect(hotbar.slots()).toHaveLength(4);
      for (let index = count; index < 4; index++) {
        expect(hotbar.select(index)).toBe(true);
        hotbar.sync('raid-a', carried);
        expect(hotbar.selectedIndex).toBe(index);
        expect(hotbar.selected()).toEqual({ itemId: null, instanceId: null, item: null });
      }
    }
  });
  it('gives duplicate tools separate slots and leaves the consumed slot empty without shifting', () => {
    const hotbar = new RaidHotbar();
    const weapon = item('training-bat');
    const bandages = ['first', 'second', 'third'].map((id) => item('bandage', id));
    const reserve = item('bandage', 'reserve');
    const carried = [weapon, ...bandages, reserve];
    hotbar.sync('raid-a', carried);
    expect(hotbar.slots().map((slot) => slot.instanceId)).toEqual([
      'training-bat',
      'first',
      'second',
      'third',
    ]);
    hotbar.select(1);
    const remaining = [reserve, bandages[2]!, weapon, bandages[1]!];
    for (let frame = 0; frame < 3; frame++) {
      hotbar.sync('raid-a', remaining);
      expect(hotbar.selectedIndex).toBe(1);
      expect(hotbar.selected()).toEqual({ itemId: null, instanceId: null, item: null });
      expect(hotbar.slots().map((slot) => slot.instanceId)).toEqual([
        'training-bat',
        null,
        'second',
        'third',
      ]);
    }
    expect(hotbar.assign(1, 'first')).toBe(false);
    expect(hotbar.assign(1, 'reserve')).toBe(true);
    expect(hotbar.selected().item).toBe(reserve);
    hotbar.sync('raid-a', [weapon, reserve, bandages[2]!]);
    expect(hotbar.slots().map((slot) => slot.instanceId)).toEqual([
      'training-bat',
      'reserve',
      null,
      'third',
    ]);
  });
  it('assigns the exact duplicate instance and swaps existing bindings without duplication', () => {
    const hotbar = new RaidHotbar();
    const carried = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item('bandage', id));
    hotbar.sync('raid-a', carried);
    expect(hotbar.assign(1, 'f')).toBe(true);
    expect(hotbar.assign(2, 'f')).toBe(true);
    hotbar.sync('raid-a', [...carried].reverse());
    expect(hotbar.slots().map((slot) => slot.instanceId)).toEqual(['a', 'c', 'f', 'd']);
    expect(hotbar.assign(3, 'bandage')).toBe(false);
    expect(carried).toHaveLength(6);
    hotbar.sync(
      'raid-a',
      carried.filter((entry) => entry.instanceId !== 'f'),
    );
    hotbar.sync(
      'raid-a',
      carried.filter((entry) => entry.instanceId !== 'f'),
    );
    expect(hotbar.slots().map((slot) => slot.instanceId)).toEqual(['a', 'c', null, 'd']);
  });
  it('can fill an empty shortcut with a genuinely new pickup without rebinding old reserve items', () => {
    const hotbar = new RaidHotbar();
    const carried = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => item('bandage', id));
    hotbar.sync('raid-a', carried);
    hotbar.sync('raid-a', carried.slice(1));
    expect(hotbar.slots()[0]?.item).toBeNull();
    hotbar.sync('raid-a', [...carried.slice(1), item('bandage', 'pickup')]);
    expect(hotbar.slots().map((slot) => slot.instanceId)).toEqual(['pickup', 'b', 'c', 'd']);
    hotbar.sync(null, []);
    expect(hotbar.slots().every((slot) => slot.item === null)).toBe(true);
    hotbar.sync('raid-b', carried);
    expect(hotbar.slots().map((slot) => slot.instanceId)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('prefers the equipped weapon, ignores collectibles, and resets on a new raid', () => {
    const hotbar = new RaidHotbar();
    const primary = item('stun-baton');
    hotbar.sync('raid-a', [item('school-badge'), item('bandage'), primary], primary);
    expect(hotbar.slots().map((slot) => slot.itemId)).toEqual([
      'stun-baton',
      'bandage',
      null,
      null,
    ]);
    hotbar.select(3);
    hotbar.sync('raid-b', [item('yellow-bike')]);
    expect(hotbar.selectedIndex).toBe(0);
    expect(hotbar.slots().map((slot) => slot.itemId)).toEqual(['yellow-bike', null, null, null]);
    expect(hotbar.select(-1)).toBe(false);
    expect(hotbar.select(4)).toBe(false);
  });
  it('replaces a full shortcut from six carried items without changing stock or selection', () => {
    const hotbar = new RaidHotbar();
    const carried = [
      'training-bat',
      'bandage',
      'thick-down-jacket',
      'electric-bike-helmet',
      'morning-coffee',
      'portable-medkit',
    ].map((id) => item(id));
    hotbar.sync('raid-a', carried);
    hotbar.select(3);
    expect(hotbar.assign(1, 'morning-coffee')).toBe(true);
    hotbar.sync('raid-a', carried);
    expect(hotbar.slots().map((slot) => slot.itemId)).toEqual([
      'training-bat',
      'morning-coffee',
      'thick-down-jacket',
      'electric-bike-helmet',
    ]);
    expect(hotbar.selectedIndex).toBe(3);
    expect(carried).toHaveLength(6);
    expect(hotbar.assign(1, 'bandage')).toBe(true);
    expect(hotbar.slots()[1]?.itemId).toBe('bandage');
  });
  it('swaps an already bound instance and rejects missing or unusable items', () => {
    const hotbar = new RaidHotbar();
    const carried = [item('training-bat'), item('bandage'), item('school-badge')];
    hotbar.sync('raid-a', carried);
    expect(hotbar.assign(1, 'training-bat')).toBe(true);
    expect(hotbar.slots().map((slot) => slot.itemId)).toEqual([
      'bandage',
      'training-bat',
      null,
      null,
    ]);
    expect(hotbar.assign(0, 'training-bat')).toBe(true);
    expect(hotbar.assign(0, 'school-badge')).toBe(false);
    expect(hotbar.assign(0, 'yellow-bike')).toBe(false);
    expect(hotbar.assign(4, 'training-bat')).toBe(false);
    hotbar.sync('raid-a', [item('training-bat')]);
    expect(hotbar.assign(2, 'bandage')).toBe(false);
    expect(hotbar.slots()[2]?.itemId).toBeNull();
  });
});
