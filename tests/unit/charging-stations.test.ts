import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateChargingStations } from '../../src/modules/world/charging-stations';
import { reachableGround } from '../../src/modules/world/reachable-ground';
import { roundRandom } from '../../src/modules/world/loot-spawns';
import { activeMap } from '../../src/config/play-map';
import { SOUTH_GATE_MAP, SIYUAN_MAP, DISTRICT_MAP } from '../../src/campus-3d/map';
import { FormalWorld, type WorldInput } from '../../src/modules/world/formal-world';
import { TrialSession, EMPTY_INPUT } from '../../src/campus-3d/session';
import { EventBus } from '../../src/shared/events/game-events';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { PersistentSave } from '../../src/modules/save/persistent-save';
import { RaidController } from '../../src/modules/raid/raid-controller';
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

async function setup(chapter: string | null = null) {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  let now = 0;
  const events = new EventBus();
  const data = new Map<string, string>();
  const inventory = new ReferenceInventory(events, RAID_RULES.bagCapacity, ITEM_DEFINITIONS);
  const controller = new RaidController(
    inventory,
    new PersistentSave({
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    }),
    events,
    RAID_RULES,
    ITEM_DEFINITIONS,
    () => now,
    () => 'charging-test',
    () => chapter,
  );
  await controller.start();
  const notify = vi.fn();
  const onFrame = vi.fn();
  const world = new FormalWorld(
    {
      controller,
      inventory,
      events,
      notify,
      onFrame,
      questChapter: () => chapter,
      sound: { play: vi.fn(), setLoop: vi.fn() } as unknown as ConstructorParameters<
        typeof FormalWorld
      >[0]['sound'],
    },
    () => now,
  );
  world.tick(0, idle);
  world.combat.enemies = [];
  vi.spyOn(world.combat, 'updateSpawns').mockReturnValue([]);
  world.position = { ...world.chargingStations[0]! };
  world.lighting.battery = 0;
  world.lighting.enabled = false;
  const tick = (input: Partial<WorldInput> = {}, ms = 100) => {
    now += ms;
    world.tick(ms, { ...idle, ...input });
  };
  return { world, controller, notify, onFrame, tick };
}

describe('random charging station placement', () => {
  for (const map of [activeMap(), SOUTH_GATE_MAP, SIYUAN_MAP, DISTRICT_MAP]) {
    it(`places exactly three separated, reachable stations on ${map.id}`, () => {
      const reachable = reachableGround(map);
      for (let round = 0; round < 8; round++) {
        const stations = generateChargingStations(map, roundRandom(`round-${round}`));
        expect(stations).toHaveLength(3);
        expect(new Set(stations.map((p) => p.id)).size).toBe(3);
        for (const station of stations) {
          expect(reachable(station)).toBe(true);
          expect(
            map.trees?.every((tree) => Math.hypot(tree.x - station.x, tree.y - station.y) >= 72) ??
              true,
          ).toBe(true);
          expect(
            map.obstacles.some(
              (r) =>
                station.x + 32 > r.x &&
                station.x - 32 < r.x + r.width &&
                station.y + 32 > r.y &&
                station.y - 32 < r.y + r.height,
            ),
          ).toBe(false);
          expect(
            stations
              .filter((p) => p.id !== station.id)
              .every((p) => Math.hypot(p.x - station.x, p.y - station.y) >= 64),
          ).toBe(true);
        }
      }
    });
  }
  it('shares a deterministic layout per round, varies between rounds and avoids search points', () => {
    const map = activeMap();
    const reserved = generateChargingStations(map, roundRandom('initial'));
    const generate = (id: string) => generateChargingStations(map, roundRandom(id), reserved);
    expect(generate('room-round')).toEqual(generate('room-round'));
    expect(generate('room-round')).not.toEqual(generate('next-round'));
    expect(
      generate('room-round').every((p) =>
        reserved.every((q) => Math.hypot(p.x - q.x, p.y - q.y) >= 100),
      ),
    ).toBe(true);
    expect(generateChargingStations(map, () => 0)).toHaveLength(3);
  });
});

describe('flashlight charging in the production 3D map', () => {
  it('keeps a round layout identical for players with different chapter progress', async () => {
    const worlds = await Promise.all(['siyuan-code', 'siyuan-key', 'soothe-monster'].map(setup));
    expect(worlds[0]!.world.chargingStations).toHaveLength(3);
    expect(worlds[0]!.world.chargingStations).toEqual(worlds[1]!.world.chargingStations);
    expect(worlds[1]!.world.chargingStations).toEqual(worlds[2]!.world.chargingStations);
    worlds.forEach((s) => s.world.dispose());
  });
  it('shows the E prompt, takes two seconds, restores an empty flashlight and permits reuse', async () => {
    const s = await setup();
    expect(s.world.frame().chargingStations).toHaveLength(3);
    s.tick();
    expect(s.onFrame).toHaveBeenLastCalledWith(expect.stringContaining('充电'), 0, {
      key: 'E',
      label: '充电',
    });
    for (let cycle = 0; cycle < 2; cycle++) {
      s.world.lighting.battery = 0;
      s.world.lighting.enabled = false;
      s.tick({ interact: true });
      s.tick({ interact: true }, 1000);
      expect(s.world.lighting.battery).toBe(0);
      expect(s.world.frame().searchProgress).toBe(0.5);
      expect(s.world.frame().target).toBe(`charge:${s.world.chargingStations[0]!.id}`);
      s.tick({ interact: true }, 1000);
      expect(s.world.lighting.battery).toBe(100);
      expect(s.world.lighting.enabled).toBe(true);
      expect(s.world.lighting.spareBatteries).toBe(2);
      s.tick();
      expect(s.world.frame().prompt).toContain('电量已满');
    }
    expect(s.notify).toHaveBeenCalledWith('手电筒已充满。');
    s.notify.mockClear();
    for (const lamp of activeMap().lamps) {
      s.world.position = { ...lamp };
      s.world.lighting.battery = 0;
      s.world.lighting.enabled = false;
      s.tick({ interact: true });
      s.tick({ interact: true }, 2100);
      expect(s.world.lighting.battery).toBe(0);
      expect(s.world.frame().prompt).not.toContain('充电');
      expect(s.world.lighting.sources()).toContainEqual(lamp);
    }
    expect(s.notify).not.toHaveBeenCalledWith('手电筒已充满。');
    s.world.dispose();
  });

  it('cancels progress on release, movement, damage, leaving range, attack and pause', async () => {
    const s = await setup();
    const station = s.world.chargingStations[0]!;
    const begin = () => {
      s.world.position = { ...station };
      s.tick({ interact: true });
      s.tick({ interact: true }, 900);
      expect(s.world.search.progress()).toBe(0.45);
    };
    begin();
    s.tick();
    expect(s.world.search.current()).toBeNull();
    begin();
    s.tick({ interact: true, move: { x: 1, y: 0 } });
    expect(s.world.search.current()).toBeNull();
    begin();
    s.controller.applyDamage(1);
    s.tick({ interact: true });
    expect(s.world.search.current()).toBeNull();
    begin();
    s.world.position = { ...activeMap().spawn };
    s.tick({ interact: true });
    expect(s.world.search.current()).toBeNull();
    begin();
    s.tick({ interact: true, attack: true });
    expect(s.world.search.current()).toBeNull();
    begin();
    s.controller.pause();
    s.tick({ interact: true }, 3000);
    expect(s.world.search.current()).toBeNull();
    expect(s.world.lighting.battery).toBe(0);
    s.world.dispose();
  });

  it('cannot charge through a wall even inside interaction range', async () => {
    const s = await setup();
    const wall = activeMap().obstacles.find((r) => r.width > 100 && r.height > 50)!;
    s.world.position = { x: wall.x - 10, y: wall.y + wall.height / 2 };
    s.world.chargingStations = [{ id: 'blocked', x: wall.x + 10, y: s.world.position.y }];
    s.tick({ interact: true });
    s.tick({ interact: true }, 3000);
    expect(s.world.lighting.battery).toBe(0);
    expect(s.world.search.current()).toBeNull();
    s.world.dispose();
  });
});

it('also charges the flashlight in standalone 3D previews', async () => {
  let now = 0;
  const data = new Map<string, string>();
  const session = new TrialSession(
    {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    },
    () => now,
    () => 'charging-preview',
    () => undefined,
    SOUTH_GATE_MAP,
    true,
    false,
    roundRandom('preview'),
  );
  await session.start();
  const stations = session.frame().chargingStations!;
  expect(stations).toHaveLength(3);
  const station = stations[0]!;
  // Skip traversal only; charging uses the actual preview update loop.
  Object.assign(session, { position: { x: station.x, y: station.y } });
  session.lighting.battery = 0;
  session.lighting.enabled = false;
  session.update(0, { ...EMPTY_INPUT, interact: true });
  now = 2000;
  session.update(0, { ...EMPTY_INPUT, interact: true });
  expect(session.lighting.battery).toBe(100);
  expect(session.lighting.enabled).toBe(true);
  expect(session.frame().prompt).toContain('已充满');
  session.dispose();
});
