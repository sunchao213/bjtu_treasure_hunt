import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, Texture } from 'three';
import { UtilityItemEffectsView } from '../../src/campus-3d/utility-item-effects-view';
import { UtilityItemEffects } from '../../src/modules/world/utility-item-effects';
import { FormalWorld } from '../../src/modules/world/formal-world';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { RaidController } from '../../src/modules/raid/raid-controller';
import { EventBus } from '../../src/shared/events/game-events';
import { ITEM_DEFINITIONS, RAID_RULES, UTILITY_EFFECTS } from '../../src/config/game-config';
import type { SavePort } from '../../src/shared/types/game';

afterEach(() => vi.unstubAllGlobals());
async function setup() {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  let now = 0;
  const events = new EventBus();
  const inventory = new ReferenceInventory(events, 6, ITEM_DEFINITIONS);
  const save: SavePort = {
    beginRaid: async () => [],
    finalizeRaid: async () => {},
    unlockChapter: async () => {},
  };
  const controller = new RaidController(
    inventory,
    save,
    events,
    RAID_RULES,
    ITEM_DEFINITIONS,
    () => now,
    () => 'utility-raid',
    () => null,
  );
  await controller.start();
  const world = new FormalWorld(
    {
      controller,
      inventory,
      events,
      questChapter: () => null,
      notify: vi.fn(),
      onFrame: vi.fn(),
      sound: { play: vi.fn(), setLoop: vi.fn() } as unknown as ConstructorParameters<
        typeof FormalWorld
      >[0]['sound'],
    },
    () => now,
  );
  const tick = (ms = 0) => {
    now += ms;
    world.tick(ms, {
      move: { x: 0, y: 0 },
      aim: 0,
      interact: false,
      attack: false,
      hug: false,
      flashlight: false,
      refill: false,
      flare: false,
    });
  };
  tick();
  world.combat.enemies = [];
  vi.spyOn(world.combat, 'updateSpawns').mockReturnValue([]);
  const add = (itemId: string, id = itemId) => {
    expect(
      inventory.addLoot({
        itemId,
        instanceId: id,
        origin: { kind: 'raid-loot', obtainedInRaidId: 'utility-raid' },
      }).ok,
    ).toBe(true);
  };
  const use = (itemId: string, id = itemId) =>
    inventory.consumeUtility(id, () => {
      const effect = UTILITY_EFFECTS[itemId]!;
      return effect.speedMultiplier !== undefined
        ? controller.activateSpeedBoost(effect.speedMultiplier, effect.durationMs)
        : controller.activateShield(effect.shield!, effect.durationMs);
    });
  return { controller, inventory, events, world, tick, add, use };
}

describe('utility visuals follow successful gameplay effects', () => {
  it('keeps rejected bike uses from consuming inventory or restarting the animation', async () => {
    const s = await setup();
    s.add('yellow-bike');
    expect(s.world.frame().utilityEffects).toEqual([]);
    expect(s.use('yellow-bike').ok).toBe(true);
    expect(s.controller.getMoveSpeedMultiplier()).toBe(1.3);
    s.tick(800);
    expect(s.world.frame().utilityEffects).toEqual([
      { itemId: 'yellow-bike', phase: 'loop', elapsedMs: 400 },
    ]);
    s.add('yellow-bike', 'second-bike');
    expect(s.use('yellow-bike', 'second-bike').ok).toBe(false);
    expect(s.inventory.getCarriedItems().some((i) => i.instanceId === 'second-bike')).toBe(true);
    expect(s.world.frame().utilityEffects?.[0]?.phase).toBe('loop');
    s.tick(4200);
    expect(s.controller.getMoveSpeedMultiplier()).toBe(1);
    expect(s.world.frame().utilityEffects).toEqual([
      { itemId: 'yellow-bike', phase: 'end', elapsedMs: 0 },
    ]);
    s.tick(400);
    expect(s.world.frame().utilityEffects).toEqual([]);
    s.world.dispose();
    s.controller.dispose();
  });

  it('breaks the shield immediately when a hit uses its last points without damaging health', async () => {
    const s = await setup();
    const damage = vi.fn();
    s.events.on('DamageTaken', damage);
    s.add('thick-down-jacket');
    s.use('thick-down-jacket');
    s.tick(800);
    s.controller.applyDamage(10);
    expect(s.world.frame().utilityEffects?.[0]?.phase).toBe('loop');
    s.controller.applyDamage(20);
    expect(s.controller.getView().health).toBe(100);
    expect(damage).not.toHaveBeenCalled();
    expect(s.world.frame().utilityEffects).toEqual([
      { itemId: 'thick-down-jacket', phase: 'end', elapsedMs: 0 },
    ]);
    s.tick(480);
    expect(s.world.frame().utilityEffects).toEqual([]);
    s.world.dispose();
    s.controller.dispose();
  });

  it('allows both effects together and cleans up expired, ended, and disposed scenes', async () => {
    const s = await setup();
    s.add('yellow-bike');
    s.add('thick-down-jacket');
    s.use('yellow-bike');
    s.use('thick-down-jacket');
    s.tick(5000);
    expect(s.world.frame().utilityEffects?.map((f) => f.phase)).toEqual(['end', 'end']);
    s.tick(480);
    expect(s.world.frame().utilityEffects).toEqual([]);
    s.add('thick-down-jacket', 'new-jacket');
    s.use('thick-down-jacket', 'new-jacket');
    expect(s.world.frame().utilityEffects).toHaveLength(1);
    s.controller.abandon();
    expect(s.world.frame().utilityEffects).toEqual([]);
    s.world.dispose();
    s.events.emit('ItemConsumed', {
      raidId: 'utility-raid',
      instanceId: 'late',
      itemId: 'yellow-bike',
    });
    expect(s.world.frame().utilityEffects).toEqual([]);
    s.controller.dispose();
  });

  it('ignores old-raid events and paused or unsupported utility uses', async () => {
    const s = await setup();
    s.events.emit('ItemConsumed', { raidId: 'old-raid', instanceId: 'old', itemId: 'yellow-bike' });
    expect(s.world.frame().utilityEffects).toEqual([]);
    s.add('yellow-bike');
    s.controller.pause();
    expect(s.use('yellow-bike').ok).toBe(false);
    expect(s.world.frame().utilityEffects).toEqual([]);
    s.world.dispose();
    s.controller.dispose();
    const effects = new UtilityItemEffects();
    effects.consume('electric-bike-helmet', 0);
    expect(effects.frames(100)).toEqual([]);
  });
});

describe('utility sprite rendering', () => {
  it('loops only sustained frames, mirrors the trail, and keeps the shield icon out of its center', () => {
    const scene = new Scene();
    const view = new UtilityItemEffectsView(
      scene,
      new Texture(),
      new Texture(),
      new Texture(),
      new Texture(),
    );
    const state = new UtilityItemEffects();
    state.consume('yellow-bike', 0);
    state.consume('thick-down-jacket', 0);
    view.update(state.frames(100), { x: 320, y: 640 }, false);
    expect(view.jacketBadge.visible).toBe(true);
    for (let t = 400; t < 5000; t += 100) {
      view.update(state.frames(t), { x: 320, y: 640 }, false);
      expect(view.bike.visible && view.shield.visible).toBe(true);
      expect(view.jacketBadge.visible).toBe(false);
      expect(view.bike.material.map!.offset.y).toBeGreaterThanOrEqual(0.25);
      expect(view.shield.material.map!.offset.y).toBeGreaterThanOrEqual(0.25);
    }
    view.update(state.frames(1000), { x: 640, y: 960 }, true);
    expect(view.bike.position.toArray()).toEqual([20, 0.28, 30]);
    expect(view.bike.material.map!.repeat.x).toBe(-0.25);
    expect(view.shield.position.toArray()).toEqual([20, 0.83, 30]);
    expect(view.shield.material.depthWrite).toBe(false);
    expect(view.bike.material.map).not.toBe(view.shield.material.map);
    view.update([], { x: 0, y: 0 }, false);
    expect(view.bike.visible || view.shield.visible || view.jacketBadge.visible).toBe(false);
    expect(scene.children).toHaveLength(4);
  });
});

describe('roller skates feedback', () => {
  it('starts after success, keeps its timer on rejected repeat use, and ends with the speed buff', async () => {
    const s = await setup();
    s.add('roller-skates');
    expect(s.use('roller-skates').ok).toBe(true);
    expect(s.controller.getMoveSpeedMultiplier()).toBe(1.15);
    s.tick(800);
    expect(s.world.frame().utilityEffects).toEqual([
      { itemId: 'roller-skates', phase: 'loop', elapsedMs: 400 },
    ]);
    s.add('roller-skates', 'repeat');
    expect(s.use('roller-skates', 'repeat').ok).toBe(false);
    expect(s.inventory.getCarriedItems().some((i) => i.instanceId === 'repeat')).toBe(true);
    s.tick(4200);
    expect(s.controller.getMoveSpeedMultiplier()).toBe(1);
    expect(s.world.frame().utilityEffects).toEqual([
      { itemId: 'roller-skates', phase: 'end', elapsedMs: 0 },
    ]);
    s.tick(400);
    expect(s.world.frame().utilityEffects).toEqual([]);
    s.world.dispose();
    s.controller.dispose();
  });

  it('ends the skating trail when a stronger bicycle boost replaces it', async () => {
    const s = await setup();
    s.add('roller-skates');
    s.use('roller-skates');
    s.tick(800);
    s.add('yellow-bike');
    expect(s.use('yellow-bike').ok).toBe(true);
    expect(s.controller.getMoveSpeedMultiplier()).toBe(1.3);
    expect(s.world.frame().utilityEffects).toEqual([
      { itemId: 'roller-skates', phase: 'end', elapsedMs: 0 },
      { itemId: 'yellow-bike', phase: 'start', elapsedMs: 0 },
    ]);
    s.tick(400);
    expect(s.world.frame().utilityEffects?.map((e) => e.itemId)).toEqual(['yellow-bike']);
    s.world.dispose();
    s.controller.dispose();
  });

  it('loops only trail frames, follows and mirrors at the feet, and hides on cleanup', () => {
    const view = new UtilityItemEffectsView(
      new Scene(),
      new Texture(),
      new Texture(),
      new Texture(),
      new Texture(),
    );
    const state = new UtilityItemEffects();
    state.consume('roller-skates', 0);
    state.consume('thick-down-jacket', 0);
    for (let t = 400; t < 5000; t += 100) {
      view.update(state.frames(t), { x: 320, y: 640 }, false);
      expect(view.skates.visible && view.shield.visible).toBe(true);
      expect(view.bike.visible).toBe(false);
      expect(view.skates.material.map!.offset.y).toBeGreaterThanOrEqual(0.25);
      expect(view.skates.material.map!.offset.y).toBeLessThanOrEqual(0.5);
    }
    view.update(state.frames(1000), { x: 640, y: 960 }, true);
    expect(view.skates.position.toArray()).toEqual([20, 0.28, 30]);
    expect(view.skates.material.map!.repeat.x).toBe(-0.25);
    view.update(state.frames(5400), { x: 640, y: 960 }, true);
    expect(view.skates.visible).toBe(false);
  });
});
