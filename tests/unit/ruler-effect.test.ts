import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene, Texture, Vector3 } from 'three';
import { RulerEffectView } from '../../src/campus-3d/ruler-effect-view';
import { RULER_EFFECT } from '../../src/config/weapon-effects';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import * as maps from '../../src/config/play-map';
import { FormalWorld } from '../../src/modules/world/formal-world';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { RaidController } from '../../src/modules/raid/raid-controller';
import { EventBus } from '../../src/shared/events/game-events';
import type { Enemy } from '../../src/modules/world/night-systems';
import type { Rect, SavePort } from '../../src/shared/types/game';

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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup(walls: Rect[] = []) {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const map = maps.activeMap();
  vi.spyOn(maps, 'activeMap').mockReturnValue({ ...map, obstacles: walls });
  let now = 0;
  let raid = 0;
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
    () => `ruler-${++raid}`,
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
  world.position = { x: 400, y: 400 };
  world.combat.enemies = [];
  vi.spyOn(world.combat, 'updateSpawns').mockReturnValue([]);
  const add = (itemId = 'folding-ruler') => {
    inventory.addLoot({
      instanceId: itemId,
      itemId,
      origin: { kind: 'raid-loot', obtainedInRaidId: controller.getView().raidId! },
    });
    world.syncHotbar();
    world.assignQuickSlot(0, itemId);
    world.selectQuickSlot(0);
  };
  const target = (id: string, x = 440, y = 400, health = 70) => {
    const enemy: Enemy = {
      id,
      kind: 'patrol',
      species: 'duck',
      position: { x, y },
      home: { x, y },
      route: [{ x, y }],
      waypoint: 0,
      health,
      state: 'patrol',
      timer: 0,
      cooldown: 0,
      hugProgress: 0,
      calmHitCount: 0,
      mutated: false,
      wanders: false,
    };
    world.combat.enemies.push(enemy);
    return enemy;
  };
  return {
    world,
    controller,
    add,
    target,
    advance: (ms: number) => {
      now += ms;
    },
    close: () => {
      world.dispose();
      controller.dispose();
    },
  };
}

describe('folding ruler actual attack feedback', () => {
  it('plays on accepted swings only, locks origin and aim, and expires without looping', async () => {
    const s = await setup();
    s.add();
    expect(s.world.frame().rulerEffect).toBeUndefined();
    s.world.tick(0, { ...idle, attack: true });
    expect(s.world.frame().rulerEffect).toEqual({
      elapsedMs: 0,
      origin: { x: 400, y: 400 },
      aim: 0,
      hits: [],
    });
    s.advance(80);
    s.world.tick(0, { ...idle, aim: Math.PI, attack: true });
    expect(s.world.frame().rulerEffect?.elapsedMs).toBe(80);
    expect(s.world.frame().rulerEffect?.aim).toBe(0);
    s.world.position = { x: 600, y: 600 };
    expect(s.world.frame().rulerEffect?.origin).toEqual({ x: 400, y: 400 });
    s.advance(80);
    expect(s.world.frame().rulerEffect).toBeUndefined();
    for (let i = 0; i < 3; i++) s.world.tick(100, idle);
    s.world.tick(0, { ...idle, attack: true });
    expect(s.world.frame().rulerEffect?.elapsedMs).toBe(0);
    s.close();
  });

  it('spawns independent sparks on every damaged target, including a lethal hit', async () => {
    const s = await setup();
    s.add();
    const alive = s.target('alive');
    const killed = s.target('killed', 435, 410, 10);
    const far = s.target('far', 470);
    const behind = s.target('behind', 360);
    s.world.tick(0, { ...idle, attack: true });
    expect(alive.health).toBe(50);
    expect(killed.state).toBe('dead');
    expect(far.health).toBe(70);
    expect(behind.health).toBe(70);
    expect(s.world.frame().rulerEffect?.hits).toEqual([
      { x: 440, y: 400 },
      { x: 435, y: 410 },
    ]);
    alive.position = { ...alive.position, x: alive.position.x + 200 };
    s.advance(30);
    s.world.tick(0, { ...idle, attack: true });
    // A cooldown attempt clears NightCombat.attackHit; the completed impact snapshot survives.
    expect(s.world.frame().rulerEffect?.hits[0]).toEqual({ x: 440, y: 400 });
    s.close();
  });

  it('never adds sparks for a target blocked by an actual map obstacle', async () => {
    const s = await setup([{ x: 420, y: 380, width: 5, height: 40 }]);
    s.add();
    const blocked = s.target('blocked');
    s.world.tick(0, { ...idle, attack: true });
    expect(blocked.health).toBe(70);
    expect(s.world.frame().rulerEffect?.hits).toEqual([]);
    s.close();
  });

  it('does not play for empty hands, another weapon, or a paused attack', async () => {
    const s = await setup();
    s.world.tick(0, { ...idle, attack: true });
    expect(s.world.frame().rulerEffect).toBeUndefined();
    s.add('long-broom');
    s.world.tick(0, { ...idle, attack: true });
    expect(s.world.frame().rulerEffect).toBeUndefined();
    s.add();
    s.controller.pause();
    s.world.tick(300, { ...idle, attack: true });
    expect(s.world.frame().rulerEffect).toBeUndefined();
    s.close();
  });

  it('hides on pause and settlement and clears on the next raid and teardown', async () => {
    const s = await setup();
    s.add();
    s.world.tick(0, { ...idle, attack: true });
    s.controller.pause();
    expect(s.world.frame().rulerEffect).toBeUndefined();
    s.advance(200);
    s.controller.resume();
    expect(s.world.frame().rulerEffect).toBeUndefined();
    for (let i = 0; i < 3; i++) s.world.tick(100, idle);
    s.world.tick(0, { ...idle, attack: true });
    expect(s.world.frame().rulerEffect).toBeDefined();
    s.controller.abandon();
    expect(s.world.frame().rulerEffect).toBeUndefined();
    await vi.waitFor(() => expect(s.controller.getView().phase).toBe('failed'));
    s.controller.prepareNext();
    await s.controller.start();
    s.world.tick(0, idle);
    expect(s.world.frame().rulerEffect).toBeUndefined();
    s.add();
    s.world.tick(0, { ...idle, attack: true });
    s.world.dispose();
    expect(s.world.frame().rulerEffect).toBeUndefined();
    s.controller.dispose();
  });
});

function cameraAt(x = 0, z = 6) {
  const camera = new PerspectiveCamera();
  camera.position.set(x, 4, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

describe('ruler billboard animation', () => {
  it('follows the current player above the head without moving impact sparks', () => {
    const view = new RulerEffectView(new Scene(), new Texture(), new Texture());
    const state = { elapsedMs: 60, origin: { x: 320, y: 640 }, aim: 0, hits: [{ x: 350, y: 640 }] };
    for (const camera of [cameraAt(), cameraAt(6, 0), cameraAt(-6, 0)]) {
      for (const position of [
        { x: 320, y: 640 },
        { x: 380, y: 710 },
      ]) {
        view.update(state, camera, position);
        const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        const foot = new Vector3(position.x / 32, 0.03, position.y / 32);
        const head = foot.clone().addScaledVector(up, 1.44);
        const relative = view.slash.position.clone().sub(head);
        expect(relative.dot(up)).toBeCloseTo(RULER_EFFECT.slashHeadOffset - 1.44);
        expect(relative.clone().cross(up).length()).toBeLessThan(0.0001);
        expect(view.sparks[0]!.position.toArray()).toEqual([350 / 32, RULER_EFFECT.height, 20]);
      }
    }
    expect(view.slash.material.depthTest).toBe(false);
    expect(view.slash.material.depthWrite).toBe(false);
    expect(view.slash.renderOrder).toBe(20);
    expect(view.sparks[0]!.material.depthTest).toBe(true);
  });

  it('plays all eight cells once, keeps sparks smaller, and never emits sparks on a miss', () => {
    const view = new RulerEffectView(new Scene(), new Texture(), new Texture());
    const camera = cameraAt();
    const state = { elapsedMs: 0, origin: { x: 320, y: 640 }, aim: 0, hits: [] };
    for (let frame = 0; frame < 8; frame++) {
      view.update({ ...state, elapsedMs: (frame + 0.5) * 20 }, camera);
      expect(view.slash.visible).toBe(true);
      expect(view.slash.material.map!.offset.toArray()).toEqual([
        (frame % 4) / 4,
        0.5 - Math.floor(frame / 4) / 2,
      ]);
      expect(view.sparks).toHaveLength(0);
    }
    view.update({ ...state, elapsedMs: 160 }, camera);
    expect(view.slash.visible).toBe(false);
    view.update(
      {
        ...state,
        hits: [
          { x: 350, y: 640 },
          { x: 355, y: 650 },
        ],
      },
      camera,
    );
    expect(view.sparks).toHaveLength(2);
    const sparks = [...view.sparks];
    expect(sparks[0]!.scale.x).toBeLessThan(view.slash.scale.x);
    expect(sparks[0]!.position.toArray()).toEqual([350 / 32, RULER_EFFECT.height, 20]);
    expect(sparks[0]!.material.map).not.toBe(sparks[1]!.material.map);
    expect(sparks[0]!.material.depthWrite).toBe(false);
    expect(sparks[0]!.material.depthTest).toBe(true);
    for (let frame = 0; frame < 8; frame++) {
      view.update(
        { ...state, hits: [{ x: 350, y: 640 }], elapsedMs: (frame + 0.5) * 17.5 },
        camera,
      );
      expect(sparks[0]!.material.map!.offset.toArray()).toEqual([
        (frame % 4) / 4,
        0.5 - Math.floor(frame / 4) / 2,
      ]);
      expect(sparks[1]!.visible).toBe(false);
    }
    view.update({ ...state, hits: [{ x: 350, y: 640 }], elapsedMs: 145 }, camera);
    expect(view.slash.visible).toBe(true);
    expect(view.sparks.some((s) => s.visible)).toBe(false);
    view.update(undefined, camera);
    expect(view.slash.visible || view.sparks.some((s) => s.visible)).toBe(false);
    view.update({ ...state, hits: [{ x: 350, y: 640 }] }, camera);
    expect(view.sparks[0]).toBe(sparks[0]);
  });

  it('projects four attack directions correctly through camera rotation without moving the hit point', () => {
    const view = new RulerEffectView(new Scene(), new Texture(), new Texture());
    for (const camera of [cameraAt(), cameraAt(6, 0), cameraAt(-6, 0)]) {
      for (const aim of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        view.update(
          { elapsedMs: 60, origin: { x: 320, y: 640 }, aim, hits: [{ x: 350, y: 640 }] },
          camera,
        );
        const direction = new Vector3(Math.cos(aim), 0, Math.sin(aim));
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        expect(view.slash.material.rotation).toBeCloseTo(
          Math.atan2(direction.dot(up), direction.dot(right)),
        );
        const expected = new Vector3(10, 0.03, 20).addScaledVector(
          up,
          RULER_EFFECT.slashHeadOffset,
        );
        expect(view.slash.position.distanceTo(expected)).toBeLessThan(0.0001);
        expect(view.sparks[0]!.position.toArray()).toEqual([350 / 32, RULER_EFFECT.height, 20]);
      }
    }
  });
});
