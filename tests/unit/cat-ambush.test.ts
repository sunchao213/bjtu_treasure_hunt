import { describe, expect, it } from 'vitest';
import {
  NightCombat,
  findCatHideout,
  type CombatMap,
  type Enemy,
} from '../../src/modules/world/night-systems';
import { COMBAT_RULES } from '../../src/config/combat-config';
import {
  monsterAnimationFor,
  monsterConcealed,
  monsterOpacityFor,
  monsterScaleFor,
} from '../../src/config/monster-sprites';
const bounds = { x: 0, y: 0, width: 1600, height: 1600 };
const map: CombatMap = {
  ...bounds,
  spawn: { x: 100, y: 100 },
  obstacles: [],
  extractions: [],
  enemyRoutes: [],
};
function setup() {
  const combat = new NightCombat(
    () => 0.5,
    () => map,
  );
  const cat: Enemy = {
    id: 'cat-test',
    kind: 'patrol',
    species: 'cat',
    position: { x: 800, y: 800 },
    home: { x: 800, y: 800 },
    route: [{ x: 1100, y: 800 }],
    waypoint: 0,
    health: 70,
    state: 'patrol',
    timer: 0,
    cooldown: 0,
    hugProgress: 0,
    calmHitCount: 0,
    mutated: false,
    wanders: true,
  };
  combat.enemies = [cat];
  return { combat, cat };
}
function advance(
  combat: NightCombat,
  player = { x: 900, y: 800 },
  ms = 100,
  walls = map.obstacles,
  invulnerable = false,
) {
  let damage = 0;
  for (let t = 0; t < ms; t += 20)
    damage += combat.update(
      Math.min(20, ms - t),
      player,
      true,
      false,
      true,
      walls,
      bounds,
      1,
      invulnerable,
    ).damage;
  return damage;
}
describe('cat ambush', () => {
  it('stays still outside proximity range even with the flashlight on', () => {
    const { combat, cat } = setup();
    expect(advance(combat, { x: 1000, y: 800 }, 5000)).toBe(0);
    expect(cat.state).toBe('lurking');
    expect(cat.position).toEqual({ x: 800, y: 800 });
  });
  it('selects clear reachable cover beside obstacles and respects spawn restrictions', () => {
    const coverMap = { ...map, obstacles: [{ x: 850, y: 760, width: 40, height: 80 }] };
    expect(findCatHideout({ x: 800, y: 800 }, coverMap)).toEqual({ x: 826, y: 800 });
    expect(findCatHideout({ x: 800, y: 800 }, { ...coverMap, canSpawn: () => false })).toEqual({
      x: 800,
      y: 800,
    });
    expect(findCatHideout({ x: 800, y: 800 }, coverMap, () => false)).toEqual({ x: 800, y: 800 });
  });
  it('moves toward nearby cover instead of wandering after a distant player', () => {
    const coverMap = { ...map, obstacles: [{ x: 850, y: 760, width: 40, height: 80 }] };
    const { cat } = setup();
    const combat = new NightCombat(
      () => 0.5,
      () => coverMap,
    );
    combat.enemies = [cat];
    advance(combat, { x: 1100, y: 800 }, 1000, coverMap.obstacles);
    expect(cat.home).toEqual({ x: 826, y: 800 });
    expect(cat.position.x).toBeGreaterThan(820);
    expect(cat.state).toBe('lurking');
  });
  it('telegraphs then lunges faster than a patrol and damages only once before vanishing', () => {
    const { combat, cat } = setup();
    advance(combat, undefined, 20);
    expect(cat.state).toBe('windup');
    expect(cat.position.x).toBe(800);
    advance(combat, undefined, COMBAT_RULES.enemy.cat.windupMs);
    expect(cat.state).toBe('pouncing');
    advance(combat, undefined, 100);
    expect(cat.position.x).toBeGreaterThan(830);
    expect(advance(combat, undefined, 200)).toBe(COMBAT_RULES.enemy.patrol.damage);
    expect(cat.state).toBe('vanished');
    expect(advance(combat, undefined, 600)).toBe(0);
  });
  it('locks direction so sidestepping dodges the pounce', () => {
    const { combat, cat } = setup();
    advance(combat, undefined, 20);
    const angle = cat.attackAngle;
    expect(advance(combat, { x: 900, y: 950 }, 700)).toBe(0);
    expect(cat.attackAngle).toBe(angle);
    expect(cat.position.y).toBe(800);
    expect(cat.state).toBe('vanished');
  });
  it('does not detect or damage through a wall, including one met during a pounce', () => {
    const { combat, cat } = setup();
    const wall = [{ x: 840, y: 700, width: 20, height: 200 }];
    expect(advance(combat, undefined, 500, wall)).toBe(0);
    expect(cat.state).toBe('lurking');
    advance(combat, undefined, 20);
    advance(combat, undefined, COMBAT_RULES.enemy.cat.windupMs);
    expect(advance(combat, undefined, 500, wall)).toBe(0);
    expect(cat.position.x).toBeLessThanOrEqual(832);
    expect(cat.state).toBe('vanished');
  });
  it('ends invisibility and returns to hiding with a cooldown', () => {
    const { combat, cat } = setup();
    cat.state = 'vanished';
    cat.timer = 40;
    cat.cooldown = 1800;
    advance(combat, undefined, 60);
    expect(cat.state).toBe('lurking');
    expect(cat.cooldown).toBeGreaterThan(0);
    expect(monsterOpacityFor(cat)).toBeGreaterThan(0);
  });
  it('stun interrupts the pounce; death stops all future attacks', () => {
    const { combat, cat } = setup();
    cat.position = { x: 840, y: 800 };
    cat.state = 'pouncing';
    cat.timer = 300;
    combat.attack({ x: 800, y: 800 }, 0, [], 25, 'stun-baton');
    expect(cat.state).toBe('stunned');
    expect(advance(combat, { x: 800, y: 800 }, 1000)).toBe(0);
    combat.attackCooldown = 0;
    expect(combat.attack({ x: 800, y: 800 }, 0, [], 100)).toEqual([cat]);
    expect(cat.state).toBe('dead');
    expect(advance(combat, { x: 800, y: 800 }, 5000)).toBe(0);
  });
  it('respects player invulnerability without repeating contact damage', () => {
    const { combat, cat } = setup();
    expect(advance(combat, undefined, 1000, [], true)).toBe(0);
    expect(cat.state).toBe('vanished');
  });
  it('reduces the silhouette, conceals passive markers and shows the attack animation', () => {
    const { cat } = setup();
    cat.state = 'lurking';
    expect(monsterScaleFor(cat)).toBe(0.26);
    expect(monsterConcealed(cat)).toBe(true);
    expect(monsterOpacityFor(cat)).toBe(0.18);
    cat.state = 'pouncing';
    expect(monsterAnimationFor(cat, true)).toBe('cat-attack');
    expect(monsterOpacityFor(cat)).toBe(1);
    cat.state = 'vanished';
    expect(monsterOpacityFor(cat)).toBe(0);
    cat.state = 'dead';
    expect(monsterOpacityFor(cat)).toBe(1);
  });
});
