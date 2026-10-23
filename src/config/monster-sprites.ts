import type { Enemy } from '../modules/world/night-systems';

export interface MonsterAnimationAsset {
  readonly texture: string;
  readonly frameRate: number;
  readonly repeat: number;
}

export const MONSTER_FRAME_SIZE = 176;

const DUCK_ANIMATIONS = {
  idle: 'duck-idle',
  moving: 'duck-walk',
  attack: 'duck-attack',
  hurt: 'duck-hurt',
  death: 'duck-death',
} as const;

const SQUIRREL_ANIMATIONS = {
  idle: 'squirrel-idle',
  moving: 'squirrel-walk',
  request: 'squirrel-request',
  hurt: 'squirrel-idle',
  death: 'squirrel-death',
} as const;

const MUTANT_ANIMATIONS = {
  idle: 'squirrel-mutant-idle',
  moving: 'squirrel-mutant-walk',
  attack: 'squirrel-mutant-attack',
  hurt: 'squirrel-mutant-hurt',
  death: 'squirrel-mutant-death',
} as const;

export const MONSTER_SPRITE_SHEETS = [
  'duck-idle',
  'duck-walk',
  'duck-attack',
  'duck-hurt',
  'duck-death',
  'squirrel-idle',
  'squirrel-walk',
  'squirrel-request',
  'squirrel-death',
  'squirrel-mutate',
  'squirrel-mutant-idle',
  'squirrel-mutant-walk',
  'squirrel-mutant-attack',
  'squirrel-mutant-hurt',
  'squirrel-mutant-death',
] as const;

export const MONSTER_ANIMATIONS: Readonly<Record<string, MonsterAnimationAsset>> = {
  'duck-idle': { texture: 'duck-idle', frameRate: 5, repeat: -1 },
  'duck-walk': { texture: 'duck-walk', frameRate: 9, repeat: -1 },
  'duck-attack': { texture: 'duck-attack', frameRate: 9, repeat: 0 },
  'duck-hurt': { texture: 'duck-hurt', frameRate: 10, repeat: 0 },
  'duck-death': { texture: 'duck-death', frameRate: 8, repeat: 0 },
  'squirrel-idle': { texture: 'squirrel-idle', frameRate: 6, repeat: -1 },
  'squirrel-walk': { texture: 'squirrel-walk', frameRate: 10, repeat: -1 },
  'squirrel-request': { texture: 'squirrel-request', frameRate: 10, repeat: -1 },
  'squirrel-death': { texture: 'squirrel-death', frameRate: 6, repeat: 0 },
  'squirrel-mutate': { texture: 'squirrel-mutate', frameRate: 14, repeat: 0 },
  'squirrel-mutant-idle': { texture: 'squirrel-mutant-idle', frameRate: 6, repeat: -1 },
  'squirrel-mutant-walk': { texture: 'squirrel-mutant-walk', frameRate: 10, repeat: -1 },
  'squirrel-mutant-attack': { texture: 'squirrel-mutant-attack', frameRate: 12, repeat: 0 },
  'squirrel-mutant-hurt': {
    texture: 'squirrel-mutant-hurt',
    frameRate: 8,
    repeat: 0,
  },
  'squirrel-mutant-death': { texture: 'squirrel-mutant-death', frameRate: 8, repeat: 0 },
};

export function monsterAnimationFor(enemy: Enemy, moving: boolean): string {
  if (enemy.state === 'mutation-warning') {
    return SQUIRREL_ANIMATIONS.request;
  }
  if (enemy.state === 'dead') {
    if (enemy.kind === 'hug' && enemy.mutated) {
      return MUTANT_ANIMATIONS.death;
    }
    return enemy.kind === 'hug' ? SQUIRREL_ANIMATIONS.death : DUCK_ANIMATIONS.death;
  }

  if (enemy.state === 'windup') {
    return enemy.kind === 'hug' && enemy.mutated
      ? MUTANT_ANIMATIONS.attack
      : enemy.kind === 'hug'
        ? SQUIRREL_ANIMATIONS.idle
        : DUCK_ANIMATIONS.attack;
  }

  if (enemy.state === 'stunned') {
    return enemy.kind === 'hug' && enemy.mutated
      ? MUTANT_ANIMATIONS.hurt
      : enemy.kind === 'hug'
        ? SQUIRREL_ANIMATIONS.hurt
        : DUCK_ANIMATIONS.hurt;
  }

  if (enemy.kind === 'hug') {
    if (enemy.mutated) {
      return moving ? MUTANT_ANIMATIONS.moving : MUTANT_ANIMATIONS.idle;
    }
    if (enemy.state === 'request') {
      return SQUIRREL_ANIMATIONS.request;
    }
    return moving ? SQUIRREL_ANIMATIONS.moving : SQUIRREL_ANIMATIONS.idle;
  }

  return moving ? DUCK_ANIMATIONS.moving : DUCK_ANIMATIONS.idle;
}

export function monsterScaleFor(enemy: Enemy): number {
  if (enemy.kind === 'hug' && enemy.mutated) {
    return 0.62;
  }
  return enemy.kind === 'hug' ? 0.48 : 0.5;
}
