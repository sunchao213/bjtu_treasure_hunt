import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldScene } from '../../src/scenes/world-scene';
import { NightCombat } from '../../src/modules/world/night-systems';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { RaidController } from '../../src/modules/raid/raid-controller';
import { PersistentSave } from '../../src/modules/save/persistent-save';
import { EventBus } from '../../src/shared/events/game-events';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import { WORLD } from '../../src/config/world-config';
import type { ItemInstance, Point } from '../../src/shared/types/game';

vi.mock('phaser', () => {
  class DisplayObject {
    depth = 0;
    text = '';
    list: DisplayObject[] = [];
    setOrigin() {
      return this;
    }
    setStrokeStyle() {
      return this;
    }
    setDepth(depth: number) {
      this.depth = depth;
      return this;
    }
    destroy = vi.fn();
  }
  return {
    default: {
      Scene: class {
        time = { now: 0 };
        input = { activePointer: null };
        add = {
          circle: () => new DisplayObject(),
          text: (_x: number, _y: number, text: string) =>
            Object.assign(new DisplayObject(), { text }),
          container: (_x: number, _y: number, list: DisplayObject[]) =>
            Object.assign(new DisplayObject(), { list }),
        };
      },
    },
  };
});

class InputElement {
  constructor(readonly type: string) {}
}

afterEach(() => vi.unstubAllGlobals());

async function setup(touchLayout = false) {
  const document = { activeElement: null as object | null };
  vi.stubGlobal('document', document);
  vi.stubGlobal('HTMLInputElement', InputElement);
  vi.stubGlobal('HTMLSelectElement', class {});
  vi.stubGlobal('matchMedia', () => ({ matches: touchLayout }));
  let now = 0;
  const storage = new Map<string, string>();
  const save = new PersistentSave({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      storage.set(key, value);
    },
  });
  const events = new EventBus();
  const inventory = new ReferenceInventory(events, RAID_RULES.bagCapacity, ITEM_DEFINITIONS);
  const controller = new RaidController(
    inventory,
    save,
    events,
    RAID_RULES,
    ITEM_DEFINITIONS,
    () => now,
    () => 'hug-raid',
  );
  await controller.start();
  const combat = new NightCombat(() => 0.5);
  const hug = combat.enemies.find((enemy) => enemy.kind === 'hug')!;
  hug.position = { x: WORLD.spawn.x + 60, y: WORLD.spawn.y };
  combat.enemies = [hug];
  vi.spyOn(combat, 'updateSpawns').mockReturnValue([]);
  const held = new Set<string>();
  const keys = Object.fromEntries(['Q', 'E', 'D', 'SPACE'].map((key) => [key, { isDown: false }]));
  const frame = vi.fn();
  type Services = ConstructorParameters<typeof WorldScene>[0];
  const scene = new WorldScene({
    controller,
    inventory,
    events,
    onFrame: frame,
    notify: vi.fn(),
    touch: {
      movement: { x: 0, y: 0 },
      aim: null,
      aimDirection: null,
      held: (key: string) => held.has(key),
      finishFrame: vi.fn(),
      reset: () => held.clear(),
    } as unknown as Services['touch'],
    sound: { play: vi.fn(), setLoop: vi.fn() } as unknown as Services['sound'],
  });
  Object.assign(scene, { combat, keys, lastRaidId: 'hug-raid' });
  const ground = Reflect.get(scene, 'ground') as Map<
    string,
    {
      item: ItemInstance;
      position: Point;
      sprite: { depth: number; list: { text: string }[] };
    }
  >;
  const step = (ms = 100) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 100) {
      const delta = Math.min(100, ms - elapsed);
      now += delta;
      scene.time.now = now;
      scene.update(now, delta);
    }
  };
  step();
  return {
    scene,
    combat,
    hug,
    keys,
    held,
    frame,
    ground,
    document,
    step,
    inventory,
    controller,
    save,
  };
}

describe('hug input, feedback and calming in the world scene', () => {
  it.each(['range', 'checkbox'])('accepts desktop Q with a focused %s control', async (type) => {
    const s = await setup();
    s.document.activeElement = new InputElement(type);
    s.keys.Q!.isDown = true;
    s.step(700);
    expect(s.hug.hugProgress).toBe(700);
    expect(s.frame).toHaveBeenLastCalledWith(expect.stringContaining('长按 Q'), 700 / 1500);
    s.step(800);
    expect(s.hug.state).toBe('calmed');
    expect(s.combat.enemies).toEqual([s.hug]);
    expect(s.ground.size).toBe(0);
  });

  it('shows the nearest request progress even when an earlier enemy and an old banner exist', async () => {
    const s = await setup();
    s.combat.enemies.unshift({
      ...s.hug,
      id: 'far-hug',
      position: { x: WORLD.spawn.x + 290, y: WORLD.spawn.y },
    });
    Object.assign(s.scene, { banner: { text: '旧的搜索提示', untilMs: 6000 } });
    s.keys.Q!.isDown = true;
    s.step(700);
    expect(s.frame).toHaveBeenLastCalledWith(expect.stringContaining('安抚抱抱怪'), 700 / 1500);
  });

  it('accepts the held mobile hug button and calms without dropping loot', async () => {
    const s = await setup(true);
    s.held.add('Q');
    s.step(2000);
    expect(s.hug.state).toBe('calmed');
    expect(s.combat.enemies).toEqual([s.hug]);
    expect(s.ground.size).toBe(0);
    expect(s.inventory.getCarriedItems()).toHaveLength(0);
  });

  it('does not hug with the mobile interact button alone', async () => {
    const s = await setup(true);
    s.held.add('E');
    s.step(2000);
    expect(s.hug.state).toBe('request');
    expect(s.ground.size).toBe(0);
  });

  it('clears progress on release and movement, then permits a new continuous Q hug', async () => {
    const s = await setup();
    s.keys.Q!.isDown = true;
    s.step(700);
    s.keys.Q!.isDown = false;
    s.step();
    expect(s.hug.hugProgress).toBe(0);
    s.keys.Q!.isDown = true;
    s.step(400);
    s.keys.D!.isDown = true;
    s.step();
    expect(s.hug.hugProgress).toBe(0);
    s.keys.D!.isDown = false;
    s.step(1500);
    expect(s.hug.state).toBe('calmed');
    expect(s.ground.size).toBe(0);
  });

  it('calms the same monster again without duplicating it or dropping items', async () => {
    const s = await setup();
    s.keys.Q!.isDown = true;
    s.step(1500);
    s.keys.Q!.isDown = false;
    expect(s.hug.state).toBe('calmed');
    expect(s.combat.enemies).toEqual([s.hug]);
    expect(s.ground.size).toBe(0);
    s.hug.timer = 100;
    s.step();
    s.keys.Q!.isDown = true;
    s.step(1500);
    expect(s.hug.state).toBe('calmed');
    expect(s.combat.enemies).toEqual([s.hug]);
    expect(s.ground.size).toBe(0);
    expect(s.inventory.getCarriedItems()).toHaveLength(0);
  });

  it('triggers a mutation warning instead of calming when damage lands on the completion frame', async () => {
    const s = await setup();
    s.keys.Q!.isDown = true;
    s.step(1400);
    s.combat.enemies.push({
      ...s.hug,
      id: 'attacker',
      kind: 'patrol',
      state: 'windup',
      position: { ...WORLD.spawn },
      timer: 100,
    });
    s.step();
    expect(s.hug.state).toBe('mutation-warning');
    expect(s.controller.getView().health).toBeLessThan(100);
    expect(s.ground.size).toBe(0);
  });
});
