import type { Point, Rect } from '../../shared/types/game';
import { COMBAT_RULES } from '../../config/combat-config';
import { movePlayer } from './movement';
import { WORLD } from '../../config/world-config';

export const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const angleBetween = (a: Point, b: Point): number => Math.atan2(b.y - a.y, b.x - a.x);
export const angleDifference = (a: number, b: number): number =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function shouldDropPatrolLoot(random: () => number = Math.random): boolean {
  return random() < COMBAT_RULES.enemy.patrol.dropChance;
}

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

function overlaps(position: Point, radius: number, rect: Rect): boolean {
  return (
    position.x + radius > rect.x &&
    position.x - radius < rect.x + rect.width &&
    position.y + radius > rect.y &&
    position.y - radius < rect.y + rect.height
  );
}

function distanceToRect(position: Point, rect: Rect): number {
  const dx = Math.max(rect.x - position.x, 0, position.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - position.y, 0, position.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
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

export type EnemyState = 'patrol' | 'chase' | 'windup' | 'request' | 'calmed' | 'stunned' | 'dead';
export type CombatWeaponId = 'training-bat' | 'stun-baton';
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
  calmHitCount: number;
  mutated: boolean;
  wanders: boolean;
}
export function createEnemies(random: () => number = Math.random): Enemy[] {
  const bounds = { x: 45, y: 50, width: WORLD.width - 90, height: WORLD.height - 100 };
  const usedPositions: Point[] = [];
  return WORLD.enemyRoutes.map((enemyConfig) => {
    let position: Point | null = null;
    for (let attempt = 0; attempt < COMBAT_RULES.spawning.candidateAttempts; attempt++) {
      const candidatePosition = {
        x: bounds.x + random() * bounds.width,
        y: bounds.y + random() * bounds.height,
      };
      if (
        candidatePosition.x < bounds.x + 18 ||
        candidatePosition.x > bounds.x + bounds.width - 18 ||
        candidatePosition.y < bounds.y + 18 ||
        candidatePosition.y > bounds.y + bounds.height - 18 ||
        WORLD.obstacles.some((obstacle) => overlaps(candidatePosition, 18, obstacle)) ||
        distanceToRect(candidatePosition, WORLD.extraction) <
          COMBAT_RULES.spawning.extractionSafeDistance ||
        distance(candidatePosition, WORLD.spawn) < COMBAT_RULES.spawning.minPlayerDistance ||
        usedPositions.some(
          (position) =>
            distance(candidatePosition, position) < COMBAT_RULES.spawning.minEnemyDistance,
        )
      ) {
        continue;
      }
      position = candidatePosition;
      break;
    }
    // The map has ample valid space; this fallback only protects against an
    // unusually unlucky deterministic random source in tests.
    const spawnPosition = position ?? {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    usedPositions.push(spawnPosition);
    return {
      ...enemyConfig,
      route: [{ ...spawnPosition }],
      position: { ...spawnPosition },
      home: { ...spawnPosition },
      waypoint: 0,
      health:
        enemyConfig.kind === 'hug' ? COMBAT_RULES.hug.health : COMBAT_RULES.enemy.patrol.health,
      state: 'patrol',
      timer: 0,
      cooldown: 0,
      hugProgress: 0,
      calmHitCount: 0,
      mutated: false,
      wanders: enemyConfig.kind === 'patrol',
    };
  });
}

export function findEnemySpawnPosition(
  player: Point,
  aim: number,
  lighting: NightLighting,
  enemies: readonly Enemy[],
  random: () => number = Math.random,
): Point | null {
  const rules = COMBAT_RULES.spawning;
  const bounds = { x: 45, y: 50, width: WORLD.width - 90, height: WORLD.height - 100 };
  for (let attempt = 0; attempt < rules.candidateAttempts; attempt++) {
    const point = {
      x: bounds.x + random() * bounds.width,
      y: bounds.y + random() * bounds.height,
    };
    if (
      distance(player, point) < rules.minPlayerDistance ||
      lighting.visible(point, player, aim, WORLD.obstacles) ||
      WORLD.obstacles.some((obstacle) => overlaps(point, 18, obstacle)) ||
      distanceToRect(point, WORLD.extraction) < rules.extractionSafeDistance ||
      enemies.some(
        (enemy) =>
          enemy.state !== 'dead' && distance(enemy.position, point) < rules.minEnemyDistance,
      )
    ) {
      continue;
    }
    return point;
  }
  return null;
}

function findPatrolWaypoint(anchor: Point, current: Point, random: () => number): Point | null {
  const bounds = { x: 45, y: 50, width: WORLD.width - 90, height: WORLD.height - 100 };
  for (let attempt = 0; attempt < COMBAT_RULES.spawning.candidateAttempts; attempt++) {
    const angle = random() * Math.PI * 2 + attempt * 2.399963229728653;
    const radius =
      COMBAT_RULES.spawning.patrolStepMinDistance +
      random() *
        (COMBAT_RULES.spawning.patrolWanderRadius - COMBAT_RULES.spawning.patrolStepMinDistance);
    const point = {
      x: current.x + Math.cos(angle) * radius,
      y: current.y + Math.sin(angle) * radius,
    };
    if (
      distance(anchor, point) > COMBAT_RULES.spawning.patrolWanderRadius ||
      point.x < bounds.x + 18 ||
      point.x > bounds.x + bounds.width - 18 ||
      point.y < bounds.y + 18 ||
      point.y > bounds.y + bounds.height - 18 ||
      WORLD.obstacles.some((obstacle) => overlaps(point, 18, obstacle)) ||
      distanceToRect(point, WORLD.extraction) < COMBAT_RULES.spawning.extractionSafeDistance ||
      distance(current, point) < COMBAT_RULES.spawning.patrolStepMinDistance ||
      !lineOfSight(current, point, WORLD.obstacles)
    ) {
      continue;
    }
    return point;
  }
  return null;
}

/** A small, deterministic combat FSM; movement uses the existing collision solver. */
export class NightCombat {
  enemies: Enemy[];
  attackCooldown = 0;
  invulnerability = 0;
  swingMs = 0;
  attackHit = false;
  currentWeaponId: CombatWeaponId = 'training-bat';
  weaponUsesRemaining: number | null = null;
  private spawnTimer = 0;
  private hugSpawnTimer = COMBAT_RULES.spawning.hugSpawnIntervalMs;
  private nextSpawnId = 1;

  constructor(private readonly random: () => number = Math.random) {
    this.enemies = createEnemies(this.random);
    this.resetSpawnTimer();
  }

  reset(): void {
    this.enemies = createEnemies(this.random);
    this.attackCooldown = 0;
    this.invulnerability = 0;
    this.swingMs = 0;
    this.attackHit = false;
    this.currentWeaponId = 'training-bat';
    this.weaponUsesRemaining = null;
    this.nextSpawnId = 1;
    this.resetSpawnTimer();
    this.hugSpawnTimer = COMBAT_RULES.spawning.hugSpawnIntervalMs;
  }

  updateSpawns(deltaMs: number, findPosition: () => Point | null): Enemy[] {
    const elapsed = Math.max(0, deltaMs);
    this.spawnTimer -= elapsed;
    this.hugSpawnTimer -= elapsed;
    const rules = COMBAT_RULES.spawning;
    const spawned: Enemy[] = [];
    if (this.spawnTimer <= 0) {
      this.resetSpawnTimer();
      for (let i = 0; i < rules.spawnCount && this.aliveEnemyCount() < rules.maxAlive; i++) {
        const position = findPosition();
        if (!position) break;
        const patrolPoint = findPatrolWaypoint(position, position, this.random);
        if (!patrolPoint) break;
        const enemy: Enemy = {
          id: `spawn-${this.nextSpawnId++}`,
          kind: 'patrol',
          position: { ...position },
          home: { ...position },
          route: [patrolPoint],
          waypoint: 0,
          health: COMBAT_RULES.enemy.patrol.health,
          state: 'patrol',
          timer: 0,
          cooldown: 0,
          hugProgress: 0,
          calmHitCount: 0,
          mutated: false,
          wanders: true,
        };
        this.enemies.push(enemy);
        spawned.push(enemy);
      }
    }
    if (this.hugSpawnTimer <= 0) {
      this.hugSpawnTimer = rules.hugSpawnIntervalMs;
      if (this.aliveEnemyCount() < rules.maxAlive) {
        const position = findPosition();
        if (position) {
          const enemy: Enemy = {
            id: `spawn-hug-${this.nextSpawnId++}`,
            kind: 'hug',
            position: { ...position },
            home: { ...position },
            route: [{ ...position }],
            waypoint: 0,
            health: COMBAT_RULES.hug.health,
            state: 'patrol',
            timer: 0,
            cooldown: 0,
            hugProgress: 0,
            calmHitCount: 0,
            mutated: false,
            wanders: false,
          };
          this.enemies.push(enemy);
          spawned.push(enemy);
        }
      }
    }
    return spawned;
  }

  private aliveEnemyCount(): number {
    return this.enemies.filter((enemy) => enemy.state !== 'dead').length;
  }

  private resetSpawnTimer(): void {
    const { intervalMinMs, intervalMaxMs } = COMBAT_RULES.spawning;
    this.spawnTimer = intervalMinMs + this.random() * (intervalMaxMs - intervalMinMs);
  }
  tick(deltaMs: number): void {
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaMs);
    this.invulnerability = Math.max(0, this.invulnerability - deltaMs);
    this.swingMs = Math.max(0, this.swingMs - deltaMs);
  }
  attack(
    player: Point,
    aim: number,
    walls: readonly Rect[],
    damage: number,
    weaponId: CombatWeaponId = 'training-bat',
  ): Enemy[] {
    this.attackHit = false;
    const weapon =
      weaponId === 'stun-baton'
        ? COMBAT_RULES.player.attack.weapons.stunBaton
        : COMBAT_RULES.player.attack.weapons.trainingBat;
    if (weaponId !== this.currentWeaponId) {
      this.currentWeaponId = weaponId;
      this.weaponUsesRemaining = weapon.maxUses;
    } else if (this.weaponUsesRemaining === null && weapon.maxUses !== null) {
      this.weaponUsesRemaining = weapon.maxUses;
    }
    if (this.attackCooldown > 0 || this.weaponUsesRemaining === 0) {
      return [];
    }
    this.attackCooldown = weapon.cooldownMs;
    this.swingMs = COMBAT_RULES.player.attack.swingMs;
    if (this.weaponUsesRemaining !== null) {
      this.weaponUsesRemaining--;
    }
    const defeated: Enemy[] = [];
    for (const enemy of this.enemies) {
      if (
        enemy.state === 'dead' ||
        distance(player, enemy.position) > weapon.range ||
        Math.abs(angleDifference(angleBetween(player, enemy.position), aim)) > weapon.arcRadians ||
        !lineOfSight(player, enemy.position, walls)
      ) {
        continue;
      }
      this.attackHit = true;
      if (enemy.kind === 'hug' && !enemy.mutated) {
        enemy.calmHitCount += 1;
        enemy.health = Math.max(0, enemy.health - damage);
        enemy.hugProgress = 0;
        if (enemy.health === 0) {
          enemy.state = 'dead';
          defeated.push(enemy);
        } else if (enemy.calmHitCount >= COMBAT_RULES.hug.calmHitsToMutate) {
          enemy.calmHitCount = 0;
          enemy.mutated = true;
          enemy.health = COMBAT_RULES.hug.health;
          enemy.state = 'chase';
          enemy.timer = COMBAT_RULES.enemy.chaseMemoryMs;
        }
        continue;
      }
      if (enemy.state === 'calmed') {
        enemy.calmHitCount += 1;
        enemy.health = Math.max(0, enemy.health - damage);
        enemy.hugProgress = 0;
        if (enemy.health > 0 && enemy.calmHitCount >= COMBAT_RULES.hug.calmHitsToMutate) {
          enemy.calmHitCount = 0;
          enemy.mutated = true;
          enemy.health = COMBAT_RULES.hug.health;
          enemy.state = 'chase';
          enemy.timer = COMBAT_RULES.enemy.chaseMemoryMs;
        }
        if (enemy.health === 0) {
          enemy.state = 'dead';
          defeated.push(enemy);
        }
        continue;
      }
      enemy.health = Math.max(0, enemy.health - damage);
      enemy.state = enemy.health === 0 ? 'dead' : weapon.stunMs ? 'stunned' : 'chase';
      enemy.timer =
        enemy.health === 0 || !weapon.stunMs
          ? enemy.timer
          : enemy.mutated
            ? weapon.stunMs.mutated
            : weapon.stunMs.patrol;
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
    this.invulnerability = COMBAT_RULES.player.invulnerabilityMs;
    return true;
  }
  hug(enemy: Enemy, held: boolean, deltaMs: number): boolean {
    if (enemy.state !== 'request') {
      return false;
    }
    enemy.hugProgress = held ? enemy.hugProgress + deltaMs : 0;
    if (enemy.hugProgress >= COMBAT_RULES.hug.calmHoldDurationMs) {
      enemy.state = 'calmed';
      enemy.timer = COMBAT_RULES.hug.calmDurationMs;
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
      if (enemy.state === 'dead') {
        continue;
      }
      if (enemy.state === 'calmed') {
        enemy.timer -= dt;
        if (enemy.timer <= 0) {
          enemy.state = 'patrol';
          enemy.timer = 0;
          enemy.hugProgress = 0;
          enemy.calmHitCount = 0;
          enemy.mutated = false;
        }
        continue;
      }
      if (enemy.state === 'stunned') {
        enemy.timer -= dt;
        if (enemy.timer <= 0) {
          enemy.state = 'chase';
          enemy.timer = COMBAT_RULES.enemy.chaseMemoryMs;
        }
        continue;
      }
      const d = distance(player, enemy.position);
      const sight = lineOfSight(enemy.position, player, walls);
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      if (enemy.kind === 'hug' && !enemy.mutated) {
        if (enemy.state === 'patrol' && d < COMBAT_RULES.hug.requestRange && sight) {
          enemy.state = 'request';
          enemy.timer = COMBAT_RULES.hug.requestDurationMs;
          enemy.hugProgress = 0;
          enemy.calmHitCount = 0;
        }
        if (enemy.state === 'request') {
          enemy.timer -= dt;
          if (enemy.timer <= 0) {
            enemy.mutated = true;
            enemy.state = 'chase';
            enemy.hugProgress = 0;
            enemy.calmHitCount = 0;
          } else if (d > COMBAT_RULES.hug.loseTargetRange || !sight) {
            enemy.state = 'patrol';
            enemy.timer = 0;
            enemy.hugProgress = 0;
            enemy.calmHitCount = 0;
            continue;
          } else {
            if (this.hug(enemy, holding && stationary && d < COMBAT_RULES.hug.calmRange, dt)) {
              calmed.push(enemy);
            }
            if (enemy.state === 'request' && d > COMBAT_RULES.hug.followStopDistance) {
              enemy.position = movePlayer(
                enemy.position,
                { x: player.x - enemy.position.x, y: player.y - enemy.position.y },
                dt,
                COMBAT_RULES.hug.followSpeed,
                12,
                bounds,
                walls,
              );
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
          if (d < COMBAT_RULES.enemy.attack.damageRange && sight && this.acceptDamage()) {
            damage += enemy.mutated
              ? COMBAT_RULES.enemy.mutated.damage
              : COMBAT_RULES.enemy.patrol.damage;
          }
          enemy.state = 'chase';
          enemy.cooldown = COMBAT_RULES.enemy.attack.recoveryMs;
        }
        continue;
      }
      const detectionRange =
        enemy.kind === 'hug' && enemy.mutated
          ? lightOn
            ? COMBAT_RULES.enemy.mutated.detectionLightRange
            : COMBAT_RULES.enemy.mutated.detectionDarkRange
          : lightOn
            ? COMBAT_RULES.enemy.patrol.detectionLightRange
            : COMBAT_RULES.enemy.patrol.detectionDarkRange;
      if (sight && d < detectionRange) {
        enemy.state = 'chase';
        enemy.timer = COMBAT_RULES.enemy.chaseMemoryMs;
      } else if (enemy.state === 'chase') {
        enemy.timer -= dt;
        if (enemy.timer <= 0) {
          enemy.state = 'patrol';
        }
      }
      if (
        enemy.state === 'chase' &&
        d <= COMBAT_RULES.enemy.attack.contactRange &&
        sight &&
        enemy.cooldown === 0
      ) {
        enemy.state = 'windup';
        enemy.timer = COMBAT_RULES.enemy.attack.windupMs;
        continue;
      }
      let target = enemy.state === 'chase' ? player : enemy.route[enemy.waypoint]!;
      if (enemy.state === 'patrol' && distance(enemy.position, target) < 12) {
        if (enemy.wanders) {
          const next = findPatrolWaypoint(enemy.home, enemy.position, this.random);
          if (next) {
            enemy.route = [next];
            enemy.waypoint = 0;
            target = next;
          }
        } else {
          enemy.waypoint = (enemy.waypoint + 1) % enemy.route.length;
          target = enemy.route[enemy.waypoint]!;
        }
      }
      if (enemy.state === 'patrol' || d > COMBAT_RULES.enemy.movement.stopDistance) {
        enemy.position = movePlayer(
          enemy.position,
          { x: target.x - enemy.position.x, y: target.y - enemy.position.y },
          dt,
          enemy.state === 'chase'
            ? enemy.mutated
              ? enemy.kind === 'hug'
                ? COMBAT_RULES.hug.mutatedSpeed
                : COMBAT_RULES.enemy.mutated.speed
              : COMBAT_RULES.enemy.patrol.chaseSpeed
            : COMBAT_RULES.enemy.patrol.speed,
          enemy.kind === 'hug' && enemy.mutated ? COMBAT_RULES.hug.mutatedCollisionRadius : 12,
          bounds,
          walls,
        );
      }
    }
    return { damage, calmed };
  }
}
