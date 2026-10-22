import { describe, expect, it, vi } from 'vitest';
import { WorldScene } from '../../src/scenes/world-scene';
import type { Enemy, EnemyState } from '../../src/modules/world/night-systems';

vi.mock('phaser', () => ({
  default: {
    Scene: class {
      time = { now: 0 };
    },
  },
}));

function setup(kind: Enemy['kind'] = 'hug') {
  const scene = new WorldScene({
    sound: { playHugCry: vi.fn() },
  } as unknown as ConstructorParameters<typeof WorldScene>[0]);
  Object.assign(scene, { anims: { exists: () => true } });
  const enemy: Enemy = {
    id: 'visual-test',
    kind,
    position: { x: 0, y: 0 },
    home: { x: 0, y: 0 },
    route: [],
    waypoint: 0,
    health: 100,
    state: 'patrol',
    timer: 0,
    cooldown: 0,
    hugProgress: 0,
    calmHitCount: 0,
    mutated: false,
    wanders: false,
  };
  const label = {
    setText: vi.fn().mockReturnThis(),
    setColor: vi.fn().mockReturnThis(),
    setVisible: vi.fn().mockReturnThis(),
  };
  const sprite = {
    anims: {
      isPlaying: false,
      play: vi.fn<(key: string) => void>(() => {
        sprite.anims.isPlaying = true;
      }),
    },
    setScale: vi.fn(),
    setFlipX: vi.fn(),
    setAlpha: vi.fn(),
    setTint: vi.fn(),
    clearTint: vi.fn(),
  };
  const parts = {
    sprite,
    'monster-name': label,
    'mutation-warning': { setVisible: vi.fn() },
    shadow: { setScale: vi.fn() },
  };
  const object = { getByName: (key: keyof typeof parts) => parts[key], setRotation: vi.fn() };
  const update = () => Reflect.get(scene, 'updateEnemyVisual').call(scene, enemy, object);
  const current = () =>
    (Reflect.get(scene, 'enemyAnimationKeys') as Map<string, string>).get(enemy.id);
  const deathFinished = Reflect.get(scene, 'enemyDeathFinished') as Set<string>;
  update();
  return { scene, enemy, sprite, label, update, current, deathFinished };
}

describe('monster animation transitions in the world scene', () => {
  it('finishes the transformation before changing to a mutant movement animation', () => {
    const s = setup();
    s.enemy.mutated = true;
    s.enemy.state = 'chase';
    s.update();
    expect(s.current()).toBe('squirrel-mutate');
    for (let frame = 0; frame < 10; frame++) {
      s.enemy.position = { x: s.enemy.position.x + 1, y: 0 };
      s.update();
      expect(s.current()).toBe('squirrel-mutate');
    }
    s.sprite.anims.isPlaying = false;
    s.enemy.position = { x: s.enemy.position.x + 1, y: 0 };
    s.update();
    expect(s.current()).toBe('squirrel-mutant-walk');
    expect(s.label.setText).toHaveBeenLastCalledWith('变异抱抱怪 · 红眼松鼠');
  });

  it.each([
    ['windup', 'squirrel-mutant-attack'],
    ['stunned', 'squirrel-mutant-hurt'],
    ['dead', 'squirrel-mutant-death'],
  ] as const)(
    'allows %s to interrupt transformation without a later stale callback',
    (state: EnemyState, animation: string) => {
      const s = setup();
      s.enemy.mutated = true;
      s.update();
      s.enemy.state = state;
      s.update();
      expect(s.current()).toBe(animation);
      s.sprite.anims.isPlaying = false;
      s.update();
      expect(s.current()).toBe(animation);
      expect(s.deathFinished.has(s.enemy.id)).toBe(state === 'dead');
    },
  );

  it.each([
    ['hug', 'squirrel-death'],
    ['patrol', 'duck-death'],
  ] as const)('plays %s death once using its own animal', (kind, animation) => {
    const s = setup(kind);
    s.enemy.state = 'dead';
    s.update();
    expect(s.current()).toBe(animation);
    expect(s.deathFinished.size).toBe(0);
    s.sprite.anims.isPlaying = false;
    s.update();
    s.update();
    expect(s.deathFinished.has(s.enemy.id)).toBe(true);
    expect(s.sprite.anims.play.mock.calls.filter(([key]) => key === animation)).toHaveLength(1);
    expect(s.label.setVisible).toHaveBeenLastCalledWith(false);
  });
});
