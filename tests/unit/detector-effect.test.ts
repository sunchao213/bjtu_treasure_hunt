import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, Texture, PerspectiveCamera, OrthographicCamera, Vector3 } from 'three';
import { DetectorEffectView } from '../../src/campus-3d/detector-effect-view';
import { FormalWorld } from '../../src/modules/world/formal-world';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { RaidController } from '../../src/modules/raid/raid-controller';
import { EventBus } from '../../src/shared/events/game-events';
import { ITEM_DEFINITIONS, RAID_RULES, UTILITY_EFFECTS } from '../../src/config/game-config';
import type { SavePort } from '../../src/shared/types/game';

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
    () => `detector-raid-${++raid}`,
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
  const add = (id = 'detector') =>
    inventory.addLoot({
      instanceId: id,
      itemId: 'simple-detector',
      origin: { kind: 'raid-loot', obtainedInRaidId: controller.getView().raidId! },
    });
  const use = (id = 'detector') =>
    inventory.consumeUtility(id, () =>
      world.activateDetector(UTILITY_EFFECTS['simple-detector']!.detectorDurationMs!),
    );
  const close = () => {
    world.dispose();
    controller.dispose();
  };
  return {
    events,
    inventory,
    controller,
    world,
    add,
    use,
    close,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('detector successful consumption and target lifetime', () => {
  it('points at the nearest unopened chest, does not restart on rejection, and expires at eight seconds', async () => {
    const s = await setup();
    s.world.search.markOpened(s.world.searchPoints[0]!.id);
    const nearest = s.world.searchPoints
      .filter((p) => !s.world.search.isOpened(p.id))
      .sort(
        (a, b) =>
          Math.hypot(a.x - s.world.position.x, a.y - s.world.position.y) -
          Math.hypot(b.x - s.world.position.x, b.y - s.world.position.y),
      )[0]!;
    s.add();
    expect(s.world.frame().detectorEffect).toBeUndefined();
    expect(s.use().ok).toBe(true);
    expect(s.inventory.getCarriedItems()).toHaveLength(0);
    expect(s.world.frame().detectorEffect).toEqual({
      elapsedMs: 0,
      remainingMs: 8000,
      target: { x: nearest.x, y: nearest.y },
    });
    s.advance(1200);
    s.add('repeat');
    expect(s.use('repeat').ok).toBe(false);
    expect(s.inventory.getCarriedItems()).toHaveLength(1);
    expect(s.world.frame().detectorEffect?.elapsedMs).toBe(1200);
    s.advance(6800);
    expect(s.world.frame().detectorEffect).toBeUndefined();
    expect(s.use('repeat').ok).toBe(true);
    s.close();
  });

  it('keeps the detector when no unopened target exists and ignores other raids', async () => {
    const s = await setup();
    for (const point of s.world.searchPoints) s.world.search.markOpened(point.id);
    s.add();
    expect(s.use().ok).toBe(false);
    expect(s.inventory.getCarriedItems()).toHaveLength(1);
    s.events.emit('ItemConsumed', { raidId: 'old', itemId: 'simple-detector', instanceId: 'old' });
    expect(s.world.frame().detectorEffect).toBeUndefined();
    s.close();
  });

  it('hides the pointer after its selected chest is investigated and outside a living raid', async () => {
    const s = await setup();
    s.add();
    s.use();
    const target = s.world.frame().detectorEffect!.target;
    const chest = s.world.searchPoints.find((p) => p.x === target.x && p.y === target.y)!;
    s.world.search.markOpened(chest.id);
    expect(s.world.frame().detectorEffect).toBeUndefined();
    s.world.search.reset();
    s.controller.applyDamage(1000);
    expect(s.world.frame().detectorEffect).toBeUndefined();
    s.close();
    s.events.emit('ItemConsumed', {
      raidId: s.controller.getView().raidId!,
      itemId: 'simple-detector',
      instanceId: 'late',
    });
    expect(s.world.frame().detectorEffect).toBeUndefined();
  });

  it('clears activation on a new raid and does not show it before successful consumption', async () => {
    const s = await setup();
    expect(s.world.activateDetector(8000)).toBe(true);
    expect(s.world.frame().detectorEffect).toBeUndefined();
    s.events.emit('ItemConsumed', {
      raidId: s.controller.getView().raidId!,
      itemId: 'simple-detector',
      instanceId: 'consumed',
    });
    expect(s.world.frame().detectorEffect).toBeDefined();
    s.controller.abandon();
    expect(s.world.frame().detectorEffect).toBeUndefined();
    await vi.waitFor(() => expect(s.controller.getView().phase).toBe('failed'));
    expect(s.controller.prepareNext()).toBe(true);
    await s.controller.start();
    s.world.tick(0, idle);
    expect(s.world.frame().detectorEffect).toBeUndefined();
    s.close();
  });
});

describe('detector sprite and navigation projection', () => {
  it('plays sixteen frames once, then retains only the marker until expiry', () => {
    const view = new DetectorEffectView(new Scene(), new Texture(), new Texture());
    const camera = new PerspectiveCamera();
    camera.position.set(0, 4, 6);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (let frame = 0; frame < 16; frame++) {
      view.update(
        { elapsedMs: (frame + 0.5) * 75, remainingMs: 7000, target: { x: 320, y: 0 } },
        { x: 0, y: 0 },
        camera,
      );
      expect(view.activation.sprite.material.map!.offset.toArray()).toEqual([
        (frame % 4) / 4,
        0.75 - Math.floor(frame / 4) / 4,
      ]);
    }
    view.update(
      { elapsedMs: 1200, remainingMs: 6800, target: { x: 320, y: 0 } },
      { x: 0, y: 0 },
      camera,
    );
    expect(view.activation.sprite.visible).toBe(false);
    expect(view.marker.visible).toBe(true);
    view.update(undefined, { x: 0, y: 0 }, camera);
    expect(view.marker.visible || view.activation.sprite.visible).toBe(false);
  });

  it('points correctly for all ground directions, rotated cameras, and the overview camera', () => {
    const view = new DetectorEffectView(new Scene(), new Texture(), new Texture());
    for (const camera of [new PerspectiveCamera(), new OrthographicCamera(-10, 10, 10, -10)]) {
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        camera.position.set(Math.sin(yaw) * 6, 4, Math.cos(yaw) * 6);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        for (const [x, z] of [
          [0, -100],
          [0, 100],
          [-100, 0],
          [100, 0],
        ]) {
          view.update(
            { elapsedMs: 2000, remainingMs: 6000, target: { x: x!, y: z! } },
            { x: 0, y: 0 },
            camera,
          );
          const expected = new Vector3(x, 0, z);
          const angle = Math.atan2(-expected.dot(right), expected.dot(up));
          expect(view.marker.material.rotation).toBeCloseTo(angle);
          expect(view.marker.visible).toBe(true);
          expect(view.marker.material.map!.repeat.toArray()).toEqual([1, 1]);
        }
      }
    }
    view.update(
      { elapsedMs: 2000, remainingMs: 6000, target: { x: 320, y: 640 } },
      { x: 320, y: 640 },
      new PerspectiveCamera(),
    );
    expect(view.marker.visible).toBe(false);
  });
});
