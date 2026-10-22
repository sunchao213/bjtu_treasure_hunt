import { describe, expect, it } from 'vitest';
import {
  MONSTER_ANIMATIONS,
  MONSTER_SPRITE_SHEETS,
  monsterAnimationFor,
  monsterNameFor,
  monsterScaleFor,
} from '../../src/config/monster-sprites';
import type { Enemy } from '../../src/modules/world/night-systems';

function makeEnemy(overrides: Partial<Enemy> = {}): Enemy {
  return {
    id: 'enemy-test',
    kind: 'patrol',
    route: [{ x: 0, y: 0 }],
    position: { x: 0, y: 0 },
    home: { x: 0, y: 0 },
    waypoint: 0,
    health: 100,
    state: 'patrol',
    timer: 0,
    cooldown: 0,
    hugProgress: 0,
    calmHitCount: 0,
    mutated: false,
    wanders: false,
    ...overrides,
  };
}

describe('monster sprite manifest', () => {
  it('has a texture and animation definition for every loaded sheet', () => {
    expect(Object.keys(MONSTER_ANIMATIONS).sort()).toEqual([...MONSTER_SPRITE_SHEETS].sort());
    for (const key of MONSTER_SPRITE_SHEETS) {
      expect(MONSTER_ANIMATIONS).toHaveProperty(key);
      const texture = MONSTER_ANIMATIONS[key]!.texture;
      expect(MONSTER_SPRITE_SHEETS).toContain(texture);
    }
  });

  it('maps patrol state and combat states to duck animations', () => {
    expect(monsterAnimationFor(makeEnemy(), false)).toBe('duck-idle');
    expect(monsterAnimationFor(makeEnemy(), true)).toBe('duck-walk');
    expect(monsterAnimationFor(makeEnemy({ state: 'windup' }), false)).toBe('duck-attack');
    expect(monsterAnimationFor(makeEnemy({ state: 'stunned' }), false)).toBe('duck-hurt');
    expect(monsterAnimationFor(makeEnemy({ state: 'dead' }), false)).toBe('duck-death');
  });

  it('maps hug and mutated states to squirrel animations', () => {
    const hug = makeEnemy({ kind: 'hug' });
    expect(monsterAnimationFor(hug, false)).toBe('squirrel-idle');
    expect(monsterAnimationFor(hug, true)).toBe('squirrel-walk');
    expect(monsterAnimationFor({ ...hug, state: 'request' }, false)).toBe('squirrel-request');
    expect(monsterAnimationFor({ ...hug, state: 'mutation-warning' }, false)).toBe(
      'squirrel-request',
    );
    expect(monsterAnimationFor({ ...hug, state: 'calmed' }, false)).toBe('squirrel-idle');
    expect(monsterAnimationFor({ ...hug, state: 'stunned' }, false)).toBe('squirrel-idle');
    expect(monsterAnimationFor({ ...hug, state: 'dead' }, false)).toBe('squirrel-death');
    expect(monsterAnimationFor({ ...hug, mutated: true }, false)).toBe('squirrel-mutant-idle');
    expect(monsterAnimationFor({ ...hug, mutated: true }, true)).toBe('squirrel-mutant-walk');
    expect(monsterAnimationFor({ ...hug, mutated: true, state: 'windup' }, false)).toBe(
      'squirrel-mutant-attack',
    );
    expect(monsterAnimationFor({ ...hug, mutated: true, state: 'stunned' }, false)).toBe(
      'squirrel-mutant-hurt',
    );
    expect(monsterAnimationFor({ ...hug, mutated: true, state: 'dead' }, false)).toBe(
      'squirrel-mutant-death',
    );
  });

  it('identifies each supplied appearance in the monster label', () => {
    expect(monsterNameFor(makeEnemy())).toBe('巡游怪 · 灰鸭');
    expect(monsterNameFor(makeEnemy({ kind: 'hug' }))).toBe('抱抱怪 · 棕色松鼠');
    expect(monsterNameFor(makeEnemy({ kind: 'hug', mutated: true }))).toBe('变异抱抱怪 · 红眼松鼠');
  });

  it('keeps the established relative scale for each visual variant', () => {
    expect(monsterScaleFor(makeEnemy())).toBe(0.5);
    expect(monsterScaleFor(makeEnemy({ kind: 'hug' }))).toBe(0.48);
    expect(monsterScaleFor(makeEnemy({ kind: 'hug', mutated: true }))).toBe(0.62);
  });
});
