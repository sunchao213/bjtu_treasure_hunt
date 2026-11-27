import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormalWorld, type WorldInput } from '../../src/modules/world/formal-world';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { PersistentSave } from '../../src/modules/save/persistent-save';
import { RaidController } from '../../src/modules/raid/raid-controller';
import { EventBus } from '../../src/shared/events/game-events';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
const idle: WorldInput = {
  move: { x: 0, y: 0 },
  aim: 0,
  interact: false,
  attack: false,
  hug: false,
  flashlight: false,
  refill: false,
  flare: false,
};
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const events = new EventBus();
  const inventory = new ReferenceInventory(events, 6, ITEM_DEFINITIONS);
  const storage = new Map<string, string>();
  const save = new PersistentSave({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
  });
  const controller = new RaidController(
    inventory,
    save,
    events,
    RAID_RULES,
    ITEM_DEFINITIONS,
    () => 1000,
    () => 'hotbar-test',
    () => null,
  );
  expect((await controller.start()).ok).toBe(true);
  const useItem = vi.fn((instanceId: string) =>
    inventory.consumeHealing(instanceId, () => controller.heal(10)),
  );
  const notify = vi.fn();
  const world = new FormalWorld(
    {
      controller,
      inventory,
      events,
      questChapter: () => null,
      useItem,
      notify,
      onFrame: vi.fn(),
      sound: { play: vi.fn(), setLoop: vi.fn() } as unknown as ConstructorParameters<
        typeof FormalWorld
      >[0]['sound'],
    },
    () => 1000,
  );
  world.tick(0, idle);
  world.combat.enemies = [];
  vi.spyOn(world.combat, 'updateSpawns').mockReturnValue([]);
  const add = (itemId: string, instanceId = itemId) => {
    expect(
      inventory.addLoot({
        itemId,
        instanceId,
        origin: { kind: 'raid-loot', obtainedInRaidId: 'hotbar-test' },
      }).ok,
    ).toBe(true);
  };
  return { world, inventory, controller, useItem, add, notify };
}
describe('selected quickbar item in the real world', () => {
  it('can switch from a weapon to empty hands without falling back to the carried weapon', async () => {
    const s = await setup();
    s.add('training-bat');
    const attack = vi.spyOn(s.world.combat, 'attack');
    s.world.tick(16, { ...idle, quickSlot: 3, attack: true });
    expect(s.world.hotbar.selectedIndex).toBe(3);
    expect(s.world.hotbar.selected().item).toBeNull();
    expect(attack).not.toHaveBeenCalled();
    expect(s.useItem).not.toHaveBeenCalled();
    s.world.tick(16, idle);
    s.world.tick(16, { ...idle, quickSlot: 0, attack: true });
    expect(attack).toHaveBeenCalledOnce();
    s.world.dispose();
    s.controller.dispose();
  });
  it('scraps the baton after 100 attacks and leaves a spare at full durability', async () => {
    const s = await setup();
    s.add('stun-baton', 'baton-1');
    s.add('stun-baton', 'baton-2');
    for (let i = 0; i < 99; i++) {
      s.world.combat.tick(1200);
      s.world.tick(16, { ...idle, attack: true });
    }
    expect(s.world.combat.getWeaponUsesRemaining('stun-baton', 'baton-1')).toBe(1);
    s.world.combat.tick(1200);
    s.world.tick(16, { ...idle, attack: true });
    expect(s.world.combat.getWeaponUsesRemaining('stun-baton', 'baton-1')).toBe(0);
    expect(s.inventory.getCarriedItems().map((item) => item.instanceId)).toEqual(['baton-2']);
    expect(s.notify).toHaveBeenCalledExactlyOnceWith('电击器已报废，请切换武器。');
    for (let i = 0; i < 10; i++) s.world.tick(16, { ...idle, attack: true });
    expect(s.notify).toHaveBeenCalledTimes(1);
    expect(s.world.combat.getWeaponUsesRemaining('stun-baton', 'baton-2')).toBe(100);
    s.world.dispose();
    s.controller.dispose();
  });
  it('uses exactly the selected instance, empties its slot, and leaves duplicates untouched', async () => {
    const s = await setup();
    s.add('training-bat');
    s.add('bandage', 'bandage-1');
    s.add('bandage', 'bandage-2');
    const attack = vi.spyOn(s.world.combat, 'attack');
    s.world.tick(16, { ...idle, quickSlot: 1, attack: true });
    expect(s.inventory.getCarriedItems()).toHaveLength(3);
    s.world.tick(16, idle);
    s.controller.applyDamage(30);
    s.world.tick(16, { ...idle, attack: true });
    s.world.tick(16, { ...idle, attack: true });
    expect(s.inventory.getCarriedItems()).toHaveLength(2);
    expect(s.controller.getView().health).toBe(80);
    s.world.tick(16, idle);
    s.world.tick(16, { ...idle, attack: true, usePressed: true });
    s.world.tick(16, idle);
    expect(s.world.hotbar.selected()).toEqual({ itemId: null, instanceId: null, item: null });
    expect(s.world.hotbar.selectedIndex).toBe(1);
    expect(s.world.hotbar.slots()[2]?.instanceId).toBe('bandage-2');
    expect(s.inventory.getCarriedItems()).toHaveLength(2);
    s.world.tick(16, { ...idle, attack: true });
    expect(s.useItem).toHaveBeenCalledTimes(2);
    expect(s.inventory.getCarriedItems()).toHaveLength(2);
    s.world.tick(16, idle);
    s.world.tick(16, { ...idle, quickSlot: 2, attack: true, usePressed: true });
    s.world.tick(16, idle);
    expect(s.useItem).toHaveBeenLastCalledWith('bandage-2');
    expect(s.useItem).toHaveBeenCalledTimes(3);
    expect(s.inventory.getCarriedItems()).toHaveLength(1);
    expect(s.world.hotbar.selected()).toEqual({ itemId: null, instanceId: null, item: null });
    expect(s.world.hotbar.selectedIndex).toBe(2);
    expect(attack).not.toHaveBeenCalled();
    s.world.dispose();
    s.controller.dispose();
  });

  it('breaks only the spent weapon after its hundredth attack', async () => {
    const s = await setup();
    s.add('folding-ruler', 'ruler-1');
    s.add('folding-ruler', 'ruler-2');
    for (let use = 0; use < 100; use++) {
      s.world.combat.tick(300);
      s.world.tick(16, { ...idle, attack: true });
    }
    expect(s.inventory.getCarriedItems().map((item) => item.instanceId)).toEqual(['ruler-2']);
    expect(s.world.combat.getWeaponUsesRemaining('folding-ruler', 'ruler-1')).toBe(0);
    expect(s.world.combat.getWeaponUsesRemaining('folding-ruler', 'ruler-2')).toBe(100);
    s.world.combat.tick(300);
    s.world.tick(16, { ...idle, quickSlot: 1, attack: true });
    expect(s.world.combat.getWeaponUsesRemaining('folding-ruler', 'ruler-2')).toBe(99);
    s.world.dispose();
    s.controller.dispose();
  });
});
