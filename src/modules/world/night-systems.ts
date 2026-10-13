import type { Point, Rect } from '../../shared/types/game';
import { movePlayer } from './movement';
import { WORLD } from '../../config/world-config';

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const angleBetween = (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x);
export const angleDifference = (a: number, b: number): number =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** Slab intersection is shared by illumination, detection and melee. */
export function rayDistance(
  origin: Point,
  angle: number,
  range: number,
  walls: readonly Rect[],
): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let nearest = range;
  for (const wall of walls) {
    let enter = 0;
    let exit = range;
    for (const [p, d, min, max] of [
      [origin.x, dx, wall.x, wall.x + wall.width],
      [origin.y, dy, wall.y, wall.y + wall.height],
    ] as const) {
      if (Math.abs(d) < 0.000001) {
        if (p < min || p > max) {
          exit = -1;
          break;
        }
      } else {
        const a = (min - p) / d;
        const b = (max - p) / d;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
      }
    }
    if (exit >= enter && enter <= range) {
      nearest = Math.min(nearest, enter);
    }
  }
  return nearest;
}

export function lineOfSight(a: Point, b: Point, walls: readonly Rect[]): boolean {
  const length = distance(a, b);
  return length < 0.001 || rayDistance(a, angleBetween(a, b), length, walls) >= length - 0.1;
}

export interface LightSource extends Point {
  radius: number;
}
export const LAMPS: readonly LightSource[] = WORLD.lamps;

export class NightLighting {
  battery = 100;
  enabled = true;
  spareBatteries = 2;
  flareCount = 2;
  flares: (LightSource & { remainingMs: number })[] = [];
  reset(): void {
    this.battery = 100;
    this.enabled = true;
    this.spareBatteries = 2;
    this.flareCount = 2;
    this.flares = [];
  }
  tick(deltaMs: number): void {
    const elapsed = Math.max(0, Math.min(deltaMs, 100));
    if (this.enabled) {
      this.battery = Math.max(0, this.battery - elapsed / 1800);
    }
    if (this.battery === 0) {
      this.enabled = false;
    }
    this.flares = this.flares
      .map((f) => ({ ...f, remainingMs: f.remainingMs - elapsed }))
      .filter((f) => f.remainingMs > 0);
  }
  toggle(): void {
    this.enabled = !this.enabled && this.battery > 0;
  }
  refill(): boolean {
    if (this.spareBatteries <= 0 || this.battery >= 100) {
      return false;
    }
    this.spareBatteries--;
    this.battery = 100;
    this.enabled = true;
    return true;
  }
  charge(): void {
    this.battery = 100;
    this.enabled = true;
  }
  deploy(position: Point): boolean {
    if (this.flareCount <= 0) {
      return false;
    }
    this.flareCount--;
    this.flares.push({ ...position, radius: 175, remainingMs: 30_000 });
    return true;
  }
  sources(): readonly LightSource[] {
    return [...LAMPS, ...this.flares];
  }
  visible(target: Point, player: Point, aim: number, walls: readonly Rect[]): boolean {
    if (distance(target, player) <= 62 && lineOfSight(player, target, walls)) {
      return true;
    }
    return this.illuminated(target, player, aim, walls);
  }
  flashlightReveals(target: Point, player: Point, aim: number, walls: readonly Rect[]): boolean {
    return (
      this.enabled &&
      this.battery > 0 &&
      distance(target, player) <= 310 &&
      Math.abs(angleDifference(angleBetween(player, target), aim)) <= Math.PI / 5 &&
      lineOfSight(player, target, walls)
    );
  }
  illuminated(target: Point, player: Point, aim: number, walls: readonly Rect[]): boolean {
    if (
      this.enabled &&
      this.battery > 0 &&
      distance(target, player) <= 62 &&
      lineOfSight(player, target, walls)
    ) {
      return true;
    }
    if (
      this.enabled &&
      this.battery > 0 &&
      distance(target, player) <= 310 &&
      Math.abs(angleDifference(angleBetween(player, target), aim)) <= Math.PI / 5 &&
      lineOfSight(player, target, walls)
    ) {
      return true;
    }
    return this.sources().some(
      (source) => distance(source, target) <= source.radius && lineOfSight(source, target, walls),
    );
  }
}

export type EnemyState = 'patrol' | 'chase' | 'windup' | 'request' | 'calmed' | 'dead';
export interface Enemy {
  id: string;
  kind: 'patrol' | 'hug';
  position: Point;
  home: Point;
  route: readonly Point[];
  waypoint: number;
  health: number;
  state: EnemyState;
  timer: number;
  cooldown: number;
  hugProgress: number;
  mutated: boolean;
}
export function createEnemies(): Enemy[] {
  return WORLD.enemyRoutes.map((e) => ({
    ...e,
    position: { ...e.route[0]! },
    home: { ...e.route[0]! },
    waypoint: 0,
    health: e.kind === 'hug' ? 100 : 70,
    state: 'patrol',
    timer: 0,
    cooldown: 0,
    hugProgress: 0,
    mutated: false,
  }));
}

/** A small, deterministic combat FSM; movement uses the existing collision solver. */
export class NightCombat {
  enemies = createEnemies();
  attackCooldown = 0;
  invulnerability = 0;
  swingMs = 0;
  reset(): void {
    this.enemies = createEnemies();
    this.attackCooldown = 0;
    this.invulnerability = 0;
    this.swingMs = 0;
  }
  tick(deltaMs: number): void {
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaMs);
    this.invulnerability = Math.max(0, this.invulnerability - deltaMs);
    this.swingMs = Math.max(0, this.swingMs - deltaMs);
  }
  attack(player: Point, aim: number, walls: readonly Rect[], damage: number): Enemy[] {
    if (this.attackCooldown > 0) {
      return [];
    }
    this.attackCooldown = 450;
    this.swingMs = 180;
    const defeated: Enemy[] = [];
    for (const enemy of this.enemies) {
      if (
        enemy.state === 'dead' ||
        enemy.state === 'calmed' ||
        distance(player, enemy.position) > 82 ||
        Math.abs(angleDifference(angleBetween(player, enemy.position), aim)) > 1.25 ||
        !lineOfSight(player, enemy.position, walls)
      ) {
        continue;
      }
      if (enemy.kind === 'hug') {
        enemy.mutated = true;
      }
      enemy.health = Math.max(0, enemy.health - damage);
      enemy.state = enemy.health === 0 ? 'dead' : 'chase';
      enemy.hugProgress = 0;
      if (enemy.health === 0) {
        defeated.push(enemy);
      }
    }
    return defeated;
  }
  acceptDamage(): boolean {
    if (this.invulnerability > 0) {
      return false;
    }
    this.invulnerability = 800;
    return true;
  }
  hug(enemy: Enemy, held: boolean, deltaMs: number): boolean {
    if (enemy.state !== 'request') {
      return false;
    }
    enemy.hugProgress = held ? enemy.hugProgress + deltaMs : 0;
    if (enemy.hugProgress >= 1500) {
      enemy.state = 'calmed';
      enemy.hugProgress = 0;
      return true;
    }
    return false;
  }

  update(
    deltaMs: number,
    player: Point,
    lightOn: boolean,
    holding: boolean,
    stationary: boolean,
    walls: readonly Rect[],
    bounds: Rect,
  ): { damage: number; calmed: Enemy[] } {
    const dt = Math.max(0, Math.min(deltaMs, 100));
    this.tick(dt);
    let damage = 0;
    const calmed: Enemy[] = [];
    for (const enemy of this.enemies) {
      if (enemy.state === 'dead' || enemy.state === 'calmed') {
        continue;
      }
      const d = distance(player, enemy.position);
      const sight = lineOfSight(enemy.position, player, walls);
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      if (enemy.kind === 'hug' && !enemy.mutated) {
        if (enemy.state === 'patrol' && d < 85 && sight) {
          enemy.state = 'request';
          enemy.timer = 6000;
        }
        if (enemy.state === 'request') {
          enemy.timer -= dt;
          if (enemy.timer <= 0 || d > 110 || !sight) {
            enemy.mutated = true;
            enemy.state = 'chase';
            enemy.hugProgress = 0;
          } else {
            if (this.hug(enemy, holding && stationary && d < 85, dt)) {
              calmed.push(enemy);
            }
            continue;
          }
        } else {
          continue;
        }
      }
      if (enemy.state === 'windup') {
        enemy.timer -= dt;
        if (enemy.timer <= 0) {
          if (d < 60 && sight && this.acceptDamage()) {
            damage += enemy.mutated ? 22 : 14;
          }
          enemy.state = 'chase';
          enemy.cooldown = 1100;
        }
        continue;
      }
      if (sight && d < (lightOn ? 240 : 90)) {
        enemy.state = 'chase';
        enemy.timer = 5000;
      } else if (enemy.state === 'chase') {
        enemy.timer -= dt;
        if (enemy.timer <= 0) {
          enemy.state = 'patrol';
        }
      }
      if (enemy.state === 'chase' && d <= 45 && sight && enemy.cooldown === 0) {
        enemy.state = 'windup';
        enemy.timer = 450;
        continue;
      }
      const target = enemy.state === 'chase' ? player : enemy.route[enemy.waypoint]!;
      if (enemy.state === 'patrol' && distance(enemy.position, target) < 8) {
        enemy.waypoint = (enemy.waypoint + 1) % enemy.route.length;
      }
      if (enemy.state === 'patrol' || d > 35) {
        enemy.position = movePlayer(
          enemy.position,
          { x: target.x - enemy.position.x, y: target.y - enemy.position.y },
          dt,
          enemy.state === 'chase' ? (enemy.mutated ? 140 : 115) : 55,
          12,
          bounds,
          walls,
        );
      }
    }
    return { damage, calmed };
  }
}
