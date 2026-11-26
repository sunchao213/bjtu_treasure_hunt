import { afterEach, describe, expect, it, vi } from 'vitest';
import { Scene, Texture, PerspectiveCamera, Vector3 } from 'three';
import { QuickNoteEffectView } from '../../src/campus-3d/quick-note-effect-view';
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
    () => `note-raid-${++raid}`,
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
  const add = (id = 'note') =>
    inventory.addLoot({
      instanceId: id,
      itemId: 'quick-note-card',
      origin: { kind: 'raid-loot', obtainedInRaidId: controller.getView().raidId! },
    });
  const use = (id = 'note') =>
    inventory.consumeUtility(id, () =>
      world.activateSearchBoost(UTILITY_EFFECTS['quick-note-card']!.searchDurationReductionMs!),
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

describe('quick note successful consumption and real search state', () => {
  it('plays after success, stays ready without a timeout, and does not restart on rejected repeat', async () => {
    const s = await setup();
    s.add();
    expect(s.world.frame().quickNoteEffect).toBeUndefined();
    expect(s.use().ok).toBe(true);
    expect(s.inventory.getCarriedItems()).toHaveLength(0);
    expect(s.world.frame().quickNoteEffect).toEqual({ elapsedMs: 0, status: 'ready' });
    s.advance(30_000);
    expect(s.world.frame().quickNoteEffect).toEqual({ elapsedMs: 30_000, status: 'ready' });
    s.add('repeat');
    expect(s.use('repeat').ok).toBe(false);
    expect(s.inventory.getCarriedItems()).toHaveLength(1);
    expect(s.world.frame().quickNoteEffect?.elapsedMs).toBe(30_000);
    s.close();
  });

  it('follows the real shortened search, clears on completion, and leaves the next search at its normal duration', async () => {
    const s = await setup();
    s.add();
    s.use();
    s.advance(1200);
    const points = s.world.searchPoints.filter((p) => p.tier === 'normal');
    const point = points[0]!;
    s.world.position = { x: point.x, y: point.y + 35 };
    s.world.aim = -Math.PI / 2;
    s.world.tick(0, { ...idle, aim: -Math.PI / 2, interact: true });
    expect(s.world.frame().quickNoteEffect?.status).toBe('searching');
    s.advance(999);
    s.world.tick(999, { ...idle, aim: -Math.PI / 2, interact: true });
    expect(s.world.search.isOpened(point.id)).toBe(false);
    s.advance(1);
    s.world.tick(1, { ...idle, aim: -Math.PI / 2, interact: true });
    expect(s.world.search.isOpened(point.id)).toBe(true);
    expect(s.world.frame().quickNoteEffect).toBeUndefined();
    const next = points[1]!;
    s.world.position = { x: next.x, y: next.y + 35 };
    s.world.aim = -Math.PI / 2;
    s.world.tick(0, { ...idle, aim: -Math.PI / 2, interact: true });
    s.advance(1000);
    s.world.tick(1000, { ...idle, aim: -Math.PI / 2, interact: true });
    expect(s.world.search.isOpened(next.id)).toBe(false);
    s.advance(1000);
    s.world.tick(1000, { ...idle, aim: -Math.PI / 2, interact: true });
    expect(s.world.search.isOpened(next.id)).toBe(true);
    s.close();
  });

  it('preserves readiness through non-search interactions and clears a spent bonus on interruption', async () => {
    const s = await setup();
    s.add();
    s.use();
    s.advance(1200);
    s.world.search.begin('charge:lamp', false);
    expect(s.world.frame().quickNoteEffect?.status).toBe('ready');
    s.world.search.cancel();
    expect(s.world.frame().quickNoteEffect?.status).toBe('ready');
    s.world.search.begin(s.world.searchPoints[0]!.id, 2000);
    expect(s.world.frame().quickNoteEffect?.status).toBe('searching');
    s.controller.applyDamage(1);
    expect(s.world.frame().quickNoteEffect).toBeUndefined();
    s.close();
  });

  it('ignores stale events and resets on raid changes, death, and disposal', async () => {
    const s = await setup();
    s.events.emit('ItemConsumed', { raidId: 'old', itemId: 'quick-note-card', instanceId: 'old' });
    expect(s.world.frame().quickNoteEffect).toBeUndefined();
    s.add();
    s.use();
    s.advance(1200);
    s.controller.abandon();
    expect(s.world.frame().quickNoteEffect).toBeUndefined();
    await vi.waitFor(() => expect(s.controller.getView().phase).toBe('failed'));
    s.controller.prepareNext();
    await s.controller.start();
    s.world.tick(0, idle);
    expect(s.world.frame().quickNoteEffect).toBeUndefined();
    s.add();
    expect(s.use().ok).toBe(true);
    s.controller.applyDamage(1000);
    expect(s.world.frame().quickNoteEffect).toBeUndefined();
    s.close();
    s.events.emit('ItemConsumed', {
      raidId: s.controller.getView().raidId!,
      itemId: 'quick-note-card',
      instanceId: 'late',
    });
    expect(s.world.frame().quickNoteEffect).toBeUndefined();
  });
});

describe('quick note animation and status badge', () => {
  it('plays all sixteen cells once, then shows a small persistent badge next to the head', () => {
    const view = new QuickNoteEffectView(new Scene(), new Texture(), new Texture());
    const camera = new PerspectiveCamera();
    camera.position.set(0, 4, 6);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    for (let frame = 0; frame < 16; frame++) {
      view.update({ elapsedMs: (frame + 0.5) * 62.5, status: 'ready' }, { x: 320, y: 640 }, camera);
      expect(view.activation.sprite.material.map!.offset.toArray()).toEqual([
        (frame % 4) / 4,
        0.75 - Math.floor(frame / 4) / 4,
      ]);
      expect(view.ready.visible).toBe(false);
    }
    view.update({ elapsedMs: 1000, status: 'ready' }, { x: 320, y: 640 }, camera);
    expect(view.activation.sprite.visible).toBe(false);
    expect(view.ready.visible).toBe(true);
    expect(view.ready.position.toArray()).toEqual([10.65, 1.48, 20]);
    expect(view.ready.scale.x).toBeLessThan(0.4);
    camera.position.set(6, 4, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    view.update({ elapsedMs: 30_000, status: 'searching' }, { x: 640, y: 960 }, camera);
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const expected = new Vector3(20, 1.48, 30).addScaledVector(right, 0.65);
    expect(view.ready.position.distanceTo(expected)).toBeLessThan(0.0001);
    view.update(undefined, { x: 640, y: 960 }, camera);
    expect(view.ready.visible || view.activation.sprite.visible).toBe(false);
  });
});
