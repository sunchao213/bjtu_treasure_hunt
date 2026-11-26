import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, Texture } from 'three';
import { BandageHealingView } from '../../src/campus-3d/bandage-healing-view';
import { BANDAGE_HEALING_EFFECT, COFFEE_HEALING_EFFECT } from '../../src/config/item-effects';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import { FormalWorld } from '../../src/modules/world/formal-world';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { PersistentSave } from '../../src/modules/save/persistent-save';
import { RaidController } from '../../src/modules/raid/raid-controller';
import { EventBus } from '../../src/shared/events/game-events';

const idle = {
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
  let now = 0;
  let raid = 0;
  const events = new EventBus();
  const data = new Map<string, string>();
  const save = new PersistentSave({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  });
  const inventory = new ReferenceInventory(events, RAID_RULES.bagCapacity, ITEM_DEFINITIONS);
  const controller = new RaidController(
    inventory,
    save,
    events,
    RAID_RULES,
    ITEM_DEFINITIONS,
    () => now,
    () => `healing-${++raid}`,
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
  world.tick(0, idle);
  world.combat.enemies = [];
  vi.spyOn(world.combat, 'updateSpawns').mockReturnValue([]);
  const add = (itemId = 'bandage') => {
    expect(
      inventory.addLoot({
        instanceId: itemId,
        itemId,
        origin: { kind: 'raid-loot', obtainedInRaidId: controller.getView().raidId! },
      }).ok,
    ).toBe(true);
  };
  return {
    events,
    controller,
    inventory,
    world,
    add,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('successful bandage consumption feedback', () => {
  it('starts only after healing succeeds, expires, and can restart', async () => {
    const s = await setup();
    s.add();
    expect(s.world.frame().bandageHealingElapsedMs).toBeUndefined();
    s.controller.applyDamage(20);
    expect(s.inventory.consumeHealing('bandage', () => s.controller.heal(10)).ok).toBe(true);
    expect(s.controller.getView().health).toBe(90);
    expect(s.world.frame().bandageHealingElapsedMs).toBe(0);
    s.advance(500);
    expect(s.world.frame().bandageHealingElapsedMs).toBe(500);
    s.advance(BANDAGE_HEALING_EFFECT.durationMs - 500);
    expect(s.world.frame().bandageHealingElapsedMs).toBeUndefined();
    s.add();
    s.inventory.consumeHealing('bandage', () => s.controller.heal(10));
    expect(s.world.frame().bandageHealingElapsedMs).toBe(0);
    s.world.dispose();
    expect(s.world.frame().bandageHealingElapsedMs).toBeUndefined();
    s.events.emit('ItemConsumed', {
      raidId: s.controller.getView().raidId!,
      instanceId: 'late',
      itemId: 'bandage',
    });
    expect(s.world.frame().bandageHealingElapsedMs).toBeUndefined();
    s.controller.dispose();
  });

  it('keeps the bandage and shows no effect at full health or while paused', async () => {
    const s = await setup();
    s.add();
    expect(s.inventory.consumeHealing('bandage', () => s.controller.heal(10)).ok).toBe(false);
    expect(s.inventory.getCarriedItems().some((item) => item.itemId === 'bandage')).toBe(true);
    expect(s.world.frame().bandageHealingElapsedMs).toBeUndefined();
    s.controller.applyDamage(20);
    s.controller.pause();
    expect(s.inventory.consumeHealing('bandage', () => s.controller.heal(10)).ok).toBe(false);
    expect(s.world.frame().bandageHealingElapsedMs).toBeUndefined();
    s.world.dispose();
    s.controller.dispose();
  });

  it('ignores other healing items and stale raids, and hides feedback on raid end', async () => {
    const s = await setup();
    s.controller.applyDamage(30);
    s.add('morning-coffee');
    s.inventory.consumeHealing('morning-coffee', () => s.controller.heal(10));
    expect(s.world.frame().bandageHealingElapsedMs).toBeUndefined();
    s.events.emit('ItemConsumed', { raidId: 'old-raid', instanceId: 'old', itemId: 'bandage' });
    expect(s.world.frame().bandageHealingElapsedMs).toBeUndefined();
    s.add();
    s.inventory.consumeHealing('bandage', () => s.controller.heal(10));
    expect(s.world.frame().bandageHealingElapsedMs).toBe(0);
    s.controller.abandon();
    expect(s.world.frame().bandageHealingElapsedMs).toBeUndefined();
    s.world.dispose();
    s.controller.dispose();
  });
});

describe('bandage sprite sheet rendering', () => {
  it('reads all 16 cells in row order and fades the final frame to transparent', () => {
    const texture = new Texture();
    const visual = new BandageHealingView(new Scene(), texture);
    expect(visual.sprite.visible).toBe(false);
    for (let frame = 0; frame < 16; frame++) {
      visual.update((frame + 0.5) * (1_000 / 16), { x: 320, y: 640 });
      expect(texture.offset.x).toBe((frame % 4) / 4);
      expect(texture.offset.y).toBe(0.75 - Math.floor(frame / 4) / 4);
      expect(texture.repeat.toArray()).toEqual([0.25, 0.25]);
    }
    visual.update(1_100, { x: 320, y: 640 });
    expect(visual.sprite.material.opacity).toBeCloseTo(0.45);
    visual.update(1_199, { x: 320, y: 640 });
    expect(visual.sprite.material.opacity).toBeLessThan(0.01);
    visual.update(1_200, { x: 320, y: 640 });
    expect(visual.sprite.visible).toBe(false);
  });

  it('follows the player above the head and clears when the world stops supplying an effect', () => {
    const scene = new Scene();
    const visual = new BandageHealingView(scene, new Texture());
    visual.update(200, { x: 320, y: 640 });
    expect(visual.sprite.position.x).toBe(10);
    expect(visual.sprite.position.z).toBe(20);
    expect(visual.sprite.position.y - visual.sprite.scale.y / 2).toBeGreaterThan(1.44);
    visual.update(400, { x: 640, y: 960 });
    expect(visual.sprite.position.x).toBe(20);
    expect(visual.sprite.position.z).toBe(30);
    expect(visual.sprite.material.depthWrite).toBe(false);
    visual.update(undefined, { x: 640, y: 960 });
    expect(visual.sprite.visible).toBe(false);
    expect(scene.children).toHaveLength(1);
  });
});

describe('morning coffee healing feedback', () => {
  it('rejects full health and paused uses, plays only after healing, and cleans up on end/dispose', async () => {
    const s = await setup();
    s.add('morning-coffee');
    const use = () => s.inventory.consumeHealing('morning-coffee', () => s.controller.heal(25));
    expect(use().ok).toBe(false);
    expect(s.world.frame().coffeeHealingElapsedMs).toBeUndefined();
    expect(s.inventory.getCarriedItems().some((i) => i.itemId === 'morning-coffee')).toBe(true);
    s.controller.applyDamage(40);
    s.controller.pause();
    expect(use().ok).toBe(false);
    expect(s.world.frame().coffeeHealingElapsedMs).toBeUndefined();
    s.controller.resume();
    s.events.emit('ItemConsumed', {
      raidId: 'old-raid',
      instanceId: 'old',
      itemId: 'morning-coffee',
    });
    expect(s.world.frame().coffeeHealingElapsedMs).toBeUndefined();
    expect(use().ok).toBe(true);
    expect(s.controller.getView().health).toBe(85);
    expect(s.world.frame().coffeeHealingElapsedMs).toBe(0);
    expect(s.world.frame().bandageHealingElapsedMs).toBeUndefined();
    s.advance(COFFEE_HEALING_EFFECT.durationMs);
    expect(s.world.frame().coffeeHealingElapsedMs).toBeUndefined();
    s.add('morning-coffee');
    expect(use().ok).toBe(true);
    expect(s.world.frame().coffeeHealingElapsedMs).toBe(0);
    s.controller.abandon();
    expect(s.world.frame().coffeeHealingElapsedMs).toBeUndefined();
    s.world.dispose();
    s.events.emit('ItemConsumed', {
      raidId: s.controller.getView().raidId!,
      instanceId: 'late',
      itemId: 'morning-coffee',
    });
    expect(s.world.frame().coffeeHealingElapsedMs).toBeUndefined();
    s.controller.dispose();
  });

  it('plays all coffee frames above the head, follows movement, and fades out', () => {
    const visual = new BandageHealingView(new Scene(), new Texture(), COFFEE_HEALING_EFFECT);
    const texture = visual.sprite.material.map!;
    for (let frame = 0; frame < 16; frame++) {
      visual.update((frame + 0.5) * (1200 / 16), { x: 320, y: 640 });
      expect(texture.offset.toArray()).toEqual([(frame % 4) / 4, 0.75 - Math.floor(frame / 4) / 4]);
    }
    visual.update(600, { x: 640, y: 960 });
    expect(visual.sprite.position.x).toBe(20);
    expect(visual.sprite.position.z).toBe(30);
    expect(visual.sprite.position.y - visual.sprite.scale.y / 2).toBeGreaterThan(1.44);
    visual.update(1399, { x: 640, y: 960 });
    expect(visual.sprite.material.opacity).toBeLessThan(0.01);
    visual.update(1400, { x: 640, y: 960 });
    expect(visual.sprite.visible).toBe(false);
  });
});
