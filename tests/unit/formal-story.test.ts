import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormalWorld, type WorldInput } from '../../src/modules/world/formal-world';
import { storyTriggers } from '../../src/modules/world/story-triggers';
import { EventBus } from '../../src/shared/events/game-events';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { PersistentSave } from '../../src/modules/save/persistent-save';
import { RaidController } from '../../src/modules/raid/raid-controller';
import { ITEM_DEFINITIONS, RAID_RULES } from '../../src/config/game-config';
import { activeMap } from '../../src/config/play-map';
import campus from '../../src/config/formal-campus.json';
import type { ItemInstance, Point } from '../../src/shared/types/game';

afterEach(() => vi.unstubAllGlobals());
const idle: WorldInput = {
  move: { x: 0, y: 0 },
  aim: -Math.PI / 2,
  interact: false,
  attack: false,
  hug: false,
  flashlight: false,
  refill: false,
  flare: false,
};

async function setup(chapter: string | null = 'siyuan-code') {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  let now = 0;
  const events = new EventBus();
  const storage = new Map<string, string>();
  const save = new PersistentSave({
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => {
      storage.set(k, v);
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
    () => 'story-test',
    () => chapter,
  );
  await controller.start();
  const onFrame = vi.fn();
  const discovered = vi.fn();
  events.on('StoryDiscovered', discovered);
  const world = new FormalWorld(
    {
      controller,
      inventory,
      events,
      questChapter: () => chapter,
      notify: vi.fn(),
      onFrame,
      sound: { play: vi.fn(), setLoop: vi.fn() } as unknown as ConstructorParameters<
        typeof FormalWorld
      >[0]['sound'],
    },
    () => now,
  );
  const tick = (input: Partial<WorldInput> = {}, ms = 100) => {
    now += ms;
    world.tick(ms, { ...idle, ...input });
  };
  tick();
  world.combat.enemies = [];
  vi.spyOn(world.combat, 'updateSpawns').mockReturnValue([]);
  const stand = (p: Point) => {
    world.position = { x: p.x, y: p.y + 35 };
    tick();
  };
  const add = (itemId: string) =>
    inventory.addLoot({
      instanceId: `story-test:${itemId}`,
      itemId,
      origin: { kind: 'raid-loot', obtainedInRaidId: 'story-test' },
    });
  return { world, controller, inventory, events, onFrame, discovered, tick, stand, add };
}

describe('authored story triggers in the production campus', () => {
  it('keeps completed saves in free exploration without story sites or evidence on subsequent starts', async () => {
    const s = await setup(null);
    const evidenceIds = [
      'torn-notebook',
      'anomalous-feather',
      'marked-campus-map',
      'siyuan-key',
      'soothe-charm',
      'complete-record',
    ];
    expect(s.world.storyMarkers()).toEqual([]);
    expect(s.world.storyObjective().title).toBe('自由探索');
    expect(s.world.searchPoints.length).toBeGreaterThan(0);
    expect(s.world.searchPoints.some((point) => evidenceIds.includes(point.itemId))).toBe(false);
    for (const site of [
      campus.questChest,
      campus.stone,
      ...Object.values(campus.chapterTwoPoints),
      ...Object.values(campus.chapterThreePoints),
    ]) {
      s.stand(site);
      s.tick({ interact: true, hug: true });
      s.tick();
    }
    expect(s.discovered).not.toHaveBeenCalled();
    expect(s.inventory.getCarriedItems()).toHaveLength(0);
    const restarted = new FormalWorld(s.world.services, () => 2000);
    restarted.tick(100, idle);
    expect(restarted.storyMarkers()).toEqual([]);
    expect(restarted.combat.enemies.some((enemy) => enemy.id === 'story-garden-help')).toBe(false);
    expect(restarted.searchPoints.length).toBeGreaterThan(0);
    expect(restarted.searchPoints.some((point) => evidenceIds.includes(point.itemId))).toBe(false);
    restarted.dispose();
    s.world.dispose();
  });

  it('places the stone on reachable lawn north of the lake and off the old roadside spot', () => {
    expect(campus.stone.y).toBeLessThan(350);
    expect(campus.stone.x).toBeGreaterThan(2050);
    expect(activeMap().canSpawn!(campus.stone)).toBe(true);
  });

  it('introduces a site once per raid, pauses for reading, then guides to the next clue', async () => {
    const s = await setup();
    s.events.on('StoryDiscovered', () => s.controller.pause());
    s.stand(campus.questChest);
    expect(s.discovered).toHaveBeenCalledTimes(1);
    expect(s.controller.isPaused()).toBe(true);
    s.controller.resume();
    s.tick();
    expect(s.discovered).toHaveBeenCalledTimes(1);
    s.add('torn-notebook');
    expect(s.world.storyObjective().title).toBe('明湖石碑');
  });

  it('keeps the stone locked until this raid notebook and awards the feather only once', async () => {
    const s = await setup();
    s.stand(campus.stone);
    s.tick({ interact: true });
    expect(s.inventory.getCarriedItems()).toHaveLength(0);
    expect(s.discovered).toHaveBeenCalledWith(
      expect.objectContaining({ locationId: 'minghu-stele:locked' }),
    );
    s.add('torn-notebook');
    s.tick();
    s.tick({ interact: true });
    expect(s.inventory.getCarriedItems().map((i) => i.itemId)).toEqual([
      'torn-notebook',
      'anomalous-feather',
    ]);
    s.tick();
    s.tick({ interact: true });
    expect(s.inventory.getCarriedItems()).toHaveLength(2);
    expect(s.world.storyObjective().title).toContain('南门');
  });

  it('does not consume the stone interaction when the bag is full and can retry after making room', async () => {
    const s = await setup();
    s.add('torn-notebook');
    for (let i = 0; i < RAID_RULES.bagCapacity - 1; i++)
      s.inventory.addLoot({
        instanceId: `filler-${i}`,
        itemId: 'school-badge',
        origin: { kind: 'raid-loot', obtainedInRaidId: 'story-test' },
      });
    s.stand(campus.stone);
    s.tick({ interact: true });
    expect(s.controller.getView().steleInvestigated).toBe(false);
    s.inventory.remove('filler-0');
    s.tick();
    s.tick({ interact: true });
    expect(s.inventory.getCarriedItems().some((i) => i.itemId === 'anomalous-feather')).toBe(true);
  });

  it.each([
    [
      'siyuan-key',
      campus.chapterTwoPoints.campusMap,
      campus.chapterTwoPoints.siyuanKey,
      'marked-campus-map',
      'siyuan-key',
    ],
    [
      'soothe-monster',
      campus.chapterThreePoints.help,
      campus.chapterThreePoints.record,
      'soothe-charm',
      'complete-record',
    ],
  ] as const)(
    'enforces %s evidence order, uses authored objects and cannot reissue dropped evidence',
    async (chapter, first, second, firstItem, secondItem) => {
      const s = await setup(chapter);
      s.stand(second);
      s.tick({ interact: true });
      expect(s.inventory.getCarriedItems()).toHaveLength(0);
      if (chapter === 'siyuan-key') {
        s.stand(first);
        s.tick({ interact: true });
      } else s.add(firstItem);
      expect(s.inventory.getCarriedItems().some((i) => i.itemId === firstItem)).toBe(true);
      s.stand(second);
      s.tick({ interact: true });
      const evidence = s.inventory.getCarriedItems().find((i) => i.itemId === secondItem)!;
      expect(evidence).toBeDefined();
      expect(s.world.searchPoints.some((p) => p.itemId === secondItem)).toBe(false);
      s.world.drop(evidence.instanceId);
      // Move away from the dropped item, but stay in range of the authored object.
      s.world.position = { x: second.x, y: second.y - 45 };
      s.tick();
      s.tick({ interact: true });
      expect(s.inventory.getCarriedItems().some((i) => i.itemId === secondItem)).toBe(false);
      expect(s.world.storyObjective().title).toContain('拾回');
      expect(s.world.ground.size).toBe(1);
      s.stand(second);
      s.tick({ interact: true });
      expect(s.inventory.getCarriedItems().some((i) => i.itemId === secondItem)).toBe(true);
    },
  );

  it('ignores old and carry-in evidence when selecting the next trigger', () => {
    const items: ItemInstance[] = [
      {
        instanceId: 'old',
        itemId: 'torn-notebook',
        origin: { kind: 'raid-loot', obtainedInRaidId: 'previous' },
      },
      { instanceId: 'carry', itemId: 'anomalous-feather', origin: { kind: 'carry-in' } },
    ];
    const markers = storyTriggers('siyuan-code', items, 'current');
    expect(markers.find((p) => p.id === campus.questChest.id)?.status).toBe('active');
    expect(markers.find((p) => p.id === 'minghu-stele')?.status).toBe('locked');
  });

  it('earns the garden charm by holding Q, not searching a random chest', async () => {
    const s = await setup('soothe-monster');
    // Reinitialize through the real raid lifecycle to retain the authored helper.
    const next = new FormalWorld({ ...s.world.services }, () => 1000);
    next.tick(100, idle);
    const helper = next.combat.enemies.find((e) => e.id === 'story-garden-help')!;
    next.combat.enemies = [helper];
    vi.spyOn(next.combat, 'updateSpawns').mockReturnValue([]);
    next.position = { x: helper.position.x, y: helper.position.y + 20 };
    for (let i = 0; i < 18; i++) next.tick(100, { ...idle, hug: true });
    expect(s.inventory.getCarriedItems().filter((i) => i.itemId === 'soothe-charm')).toHaveLength(
      1,
    );
    for (let i = 0; i < 18; i++) next.tick(100, { ...idle, hug: true });
    expect(s.inventory.getCarriedItems().filter((i) => i.itemId === 'soothe-charm')).toHaveLength(
      1,
    );
    expect(next.storyObjective().title).toContain('记录台');
    next.dispose();
  });

  it('can call the story helper back after an interrupted encounter', async () => {
    const s = await setup('soothe-monster');
    const next = new FormalWorld({ ...s.world.services }, () => 1000);
    next.tick(100, idle);
    const helper = next.combat.enemies.find((e) => e.id === 'story-garden-help')!;
    helper.state = 'dead';
    next.position = { ...campus.chapterThreePoints.help };
    next.tick(100, { ...idle, interact: true });
    expect(helper.state).toBe('patrol');
    expect(helper.health).toBeGreaterThan(0);
    expect(s.inventory.getCarriedItems()).toHaveLength(0);
    next.dispose();
  });
});
