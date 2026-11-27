import { describe, expect, it } from 'vitest';
import { COMBAT_RULES } from '../../src/config/combat-config';
import { EMPTY_INPUT, TrialSession, type TrialInput } from '../../src/campus-3d/session';
import { campusCombatMap } from '../../src/campus-3d/combat-map';
import { DISTRICT_MAP } from '../../src/campus-3d/map';
import type { TrialMap } from '../../src/campus-3d/map';
import type { CombatWeaponId, Enemy } from '../../src/modules/world/night-systems';
import { findEnemySpawnPosition } from '../../src/modules/world/night-systems';

const map: TrialMap = {
  id: 'combat-test',
  width: 1400,
  height: 1400,
  bounds: { x: 16, y: 16, width: 1368, height: 1368 },
  spawn: { x: 700, y: 700 },
  extraction: { x: 1050, y: 1050, width: 120, height: 120 },
  playerRadius: 8,
  playerSpeed: 145,
  obstacles: [],
  chests: [{ x: 700, y: 660, id: 'chest', itemId: 'school-badge' }],
};
async function setup(weapon: CombatWeaponId = 'training-bat', custom = map) {
  let now = 0,
    raid = 0;
  const data = new Map<string, string>();
  const session = new TrialSession(
    {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
    },
    () => now,
    () => `combat-${++raid}`,
    () => undefined,
    custom,
    true,
    true,
    () => 0.1,
  );
  await session.start(weapon);
  session.combat!.enemies = [];
  const tick = (ms = 20, input: TrialInput = EMPTY_INPUT) => {
    for (let t = 0; t < ms; t += 20) {
      now += 20;
      session.update(20, input);
    }
  };
  const enemy = (overrides: Partial<Enemy> = {}): Enemy => ({
    id: 'test-enemy',
    kind: 'patrol',
    species: 'duck',
    position: { x: 700, y: 650 },
    home: { x: 700, y: 650 },
    route: [{ x: 700, y: 650 }],
    waypoint: 0,
    health: 70,
    state: 'patrol',
    timer: 0,
    cooldown: 0,
    hugProgress: 0,
    calmHitCount: 0,
    mutated: false,
    wanders: false,
    ...overrides,
  });
  return { session, tick, enemy, data };
}

describe('three-dimensional combat integration', () => {
  it('equips a starter outside the six loot slots, attacks ahead, respects cooldown and drops pickable raid loot', async () => {
    const { session, tick, enemy } = await setup();
    const e = enemy({ health: 20 });
    session.combat!.enemies = [e];
    expect(session.inventory.getEquipment().primary?.itemId).toBe('training-bat');
    expect(session.frame().combat.bagCount).toBe(0);
    expect(session.controller.getView().value).toBe(0);
    tick(20, { ...EMPTY_INPUT, attack: true });
    expect(e.health).toBe(10);
    tick(100, { ...EMPTY_INPUT, attack: true });
    expect(e.health).toBe(10);
    tick(500, { ...EMPTY_INPUT, attack: true });
    expect(e.state).toBe('dead');
    const drop = session.frame().ground[0]!;
    expect(drop.item.itemId).toBe('school-badge');
    expect(session.frame().ground).toHaveLength(1);
    tick(1800, { ...EMPTY_INPUT, attack: true });
    expect(session.combat!.enemies).toHaveLength(0);
    expect(session.frame().ground).toHaveLength(1);
    const p = drop.position;
    for (
      let i = 0;
      i < 30 && Math.hypot(session.frame().position.x - p.x, session.frame().position.y - p.y) > 10;
      i++
    ) {
      const current = session.frame().position;
      tick(20, { move: { x: p.x - current.x, y: p.y - current.y }, interact: false });
    }
    tick(20, { ...EMPTY_INPUT, interact: true });
    expect(session.frame().ground).toHaveLength(0);
    expect(session.frame().combat.bagCount).toBe(1);
    expect(session.controller.getView().value).toBeGreaterThan(0);
    session.dispose();
  });

  it('cannot attack through walls or behind the player, and an attack cancels searching', async () => {
    const { session, tick, enemy } = await setup('training-bat', {
      ...map,
      obstacles: [{ x: 695, y: 670, width: 10, height: 10 }],
    });
    const e = enemy();
    session.combat!.enemies = [e];
    tick(20, { ...EMPTY_INPUT, attack: true });
    expect(e.health).toBe(70);
    e.position = { x: 700, y: 750 };
    tick(500, { ...EMPTY_INPUT, attack: true });
    expect(e.health).toBe(70);
    session.dispose();
    const open = await setup();
    open.tick(1000, { ...EMPTY_INPUT, interact: true });
    expect(open.session.frame().searchProgress).toBeGreaterThan(0.4);
    open.tick(20, { ...EMPTY_INPUT, interact: true, attack: true });
    expect(open.session.frame().searchProgress).toBe(0);
    expect(open.session.frame().opened).toEqual([]);
    open.session.dispose();
  });

  it('applies stun-baton damage, stun and finite uses', async () => {
    const { session, tick, enemy } = await setup('stun-baton');
    const weapon = session.inventory.getEquipment().primary!;
    expect(session.frame().combat.uses).toBe(100);
    const e = enemy();
    session.combat!.enemies = [e];
    tick(20, { ...EMPTY_INPUT, attack: true });
    expect(e.health).toBe(45);
    expect(e.state).toBe('stunned');
    expect(session.frame().combat.uses).toBe(99);
    session.combat!.enemies = [];
    for (let use = 0; use < 99; use++) {
      session.combat!.tick(1200);
      tick(20, { ...EMPTY_INPUT, attack: true });
    }
    expect(session.combat!.getWeaponUsesRemaining('stun-baton', weapon.instanceId)).toBe(0);
    expect(session.inventory.getEquipment().primary).toBeUndefined();
    tick(2000);
    tick(20, { ...EMPTY_INPUT, attack: true });
    expect(session.frame().combat.swing).toBe(0);
    session.dispose();
  });

  it('calms a hug monster with Q, creates one reward and warns then mutates when attacked', async () => {
    const { session, tick, enemy } = await setup();
    const e = enemy({ kind: 'hug', health: 100 });
    session.combat!.enemies = [e];
    tick(20);
    expect(e.state).toBe('request');
    expect(session.frame().prompt).toContain('Q');
    tick(1500, { ...EMPTY_INPUT, hug: true });
    expect(e.state).toBe('calmed');
    expect(session.frame().ground.filter((p) => p.item.itemId === 'gpa-charm')).toHaveLength(1);
    tick(2000, { ...EMPTY_INPUT, hug: true });
    expect(session.frame().ground).toHaveLength(1);
    const second = enemy({ id: 'mutate', kind: 'hug', health: 100 });
    session.combat!.enemies = [second];
    tick(20, { ...EMPTY_INPUT, attack: true });
    expect(second.state).toBe('mutation-warning');
    tick(1000);
    expect(second.mutated).toBe(true);
    expect(second.state).toBe('chase');
    session.dispose();
  });

  it('cancels a hug on same-frame damage without rewarding and interrupts extraction on enemy damage', async () => {
    const { session, tick, enemy } = await setup();
    const hug = enemy({
      id: 'hug',
      kind: 'hug',
      health: 100,
      state: 'request',
      timer: 4000,
      hugProgress: 1480,
    });
    const attacker = enemy({
      id: 'attacker',
      state: 'windup',
      timer: 1,
      position: { x: 720, y: 700 },
    });
    session.combat!.enemies = [hug, attacker];
    tick(20, { ...EMPTY_INPUT, hug: true });
    expect(hug.state).toBe('mutation-warning');
    expect(session.frame().ground).toHaveLength(0);
    expect(session.controller.getView().health).toBe(86);
    expect(session.frame().action).toBe('hurt');
    session.combat!.invulnerability = 0;
    session.controller.setExtractionPresence(true);
    for (let i = 0; i < 4; i++)
      session.inventory.addLoot({
        instanceId: `loot-${i}`,
        itemId: 'school-badge',
        origin: { kind: 'raid-loot', obtainedInRaidId: 'combat-1' },
      });
    expect(session.controller.startExtraction().ok).toBe(true);
    attacker.state = 'windup';
    attacker.timer = 1;
    tick(20);
    expect(session.controller.getView().phase).toBe('active');
    session.dispose();
  });

  it('freezes combat on pause and death settles failure; a new round clears enemies and drops', async () => {
    const { session, tick, enemy } = await setup();
    const e = enemy({ state: 'windup', timer: 100, position: { x: 720, y: 700 } });
    session.combat!.enemies = [e];
    session.pause();
    const snapshot = structuredClone(e);
    tick(2000, { ...EMPTY_INPUT, attack: true, hug: true });
    expect(e).toEqual(snapshot);
    expect(session.controller.getView().health).toBe(100);
    session.controller.resume();
    session.controller.applyDamage(90);
    tick(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.controller.getView().result?.reason).toBe('death');
    expect(session.prepareNext()).toBe(true);
    expect(session.frame().ground).toEqual([]);
    expect(session.controller.getView().health).toBe(100);
    await session.start();
    expect(session.inventory.getEquipment().primary?.itemId).toBe('training-bat');
    session.dispose();
  });

  it('places initial and ongoing spawns on connected 3D ground outside the gate safe zone', async () => {
    const map = campusCombatMap(DISTRICT_MAP);
    const data = new Map<string, string>();
    let seed = 9;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const session = new TrialSession(
      {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
      },
      () => 0,
      () => 'spawns',
      () => undefined,
      DISTRICT_MAP,
      true,
      true,
      random,
    );
    await session.start();
    expect(session.combat!.enemies.length).toBeGreaterThan(5);
    const spawned = session.combat!.updateSpawns(30_000, () =>
      findEnemySpawnPosition(
        DISTRICT_MAP.spawn,
        -Math.PI / 2,
        session.lighting,
        session.combat!.enemies,
        random,
        map,
      ),
    );
    expect(spawned.length).toBeGreaterThan(0);
    expect(session.combat!.enemies.length).toBeLessThanOrEqual(COMBAT_RULES.spawning.maxAlive);
    for (const e of session.combat!.enemies) {
      expect(map.canSpawn!(e.position), e.id).toBe(true);
      expect(
        Math.hypot(e.position.x - DISTRICT_MAP.spawn.x, e.position.y - DISTRICT_MAP.spawn.y),
      ).toBeGreaterThanOrEqual(COMBAT_RULES.spawning.minPlayerDistance);
      const r = DISTRICT_MAP.extraction,
        p = e.position;
      expect(
        Math.hypot(
          Math.max(r.x - p.x, 0, p.x - r.x - r.width),
          Math.max(r.y - p.y, 0, p.y - r.y - r.height),
        ),
      ).toBeGreaterThanOrEqual(180);
    }
    session.dispose();
  });
});
