import type { Point, Rect } from '../../shared/types/game';
import { COMBAT_RULES } from '../../config/combat-config';
import { movePlayer } from './movement';
import { activeMap } from '../../config/play-map';
import formal from '../../config/formal-campus.json';

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

/** The combat simulation accepts either campus map without changing global map selection. */
export interface CombatMap {
  width: number;
  height: number;
  spawn: Point;
  obstacles: readonly Rect[];
  extractions: readonly Rect[];
  enemyRoutes: readonly {
    id: string;
    kind: 'patrol' | 'hug' | 'amplifier';
    route: readonly Point[];
    fixedPosition?: boolean;
  }[];
  canSpawn?: (point: Point) => boolean;
}

function nearExtraction(position: Point, gap: number, map: CombatMap): boolean {
  return map.extractions.some((zone) => distanceToRect(position, zone) < gap);
}

export interface LightSource extends Point {
  radius: number;
}
export const LAMPS: readonly LightSource[] = formal.lamps;

export class NightLighting {
  constructor(private readonly lamps?: readonly LightSource[]) {}

  battery = 100;
  enabled = true;
  spareBatteries = 2;
  flareCount = 2;
  private flashlightRangeMultiplier = 1;
  flares: (LightSource & { remainingMs: number })[] = [];
  reset(): void {
    this.battery = 100;
    this.enabled = true;
    this.spareBatteries = 2;
    this.flareCount = 2;
    this.flashlightRangeMultiplier = 1;
    this.flares = [];
  }
  setFlashlightRangeMultiplier(multiplier: number): boolean {
    if (!Number.isFinite(multiplier) || multiplier <= this.flashlightRangeMultiplier) {
      return false;
    }
    this.flashlightRangeMultiplier = multiplier;
    return true;
  }
  flashlightRange(): number {
    return 310 * this.flashlightRangeMultiplier;
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
    return [...(this.lamps ?? activeMap().lamps), ...this.flares];
  }
  visible(target: Point, player: Point, aim: number, walls: readonly Rect[]): boolean {
    if (distance(target, player) <= 62 && lineOfSight(player, target, walls)) {
      return true;
    }
    return this.illuminated(target, player, aim, walls);
  }
  flashlightReveals(target: Point, player: Point, aim: number, walls: readonly Rect[]): boolean {
    return this.enabled && this.battery > 0 && this.inFlashlightCone(target, player, aim, walls);
  }

  inFlashlightCone(target: Point, player: Point, aim: number, walls: readonly Rect[]): boolean {
    return (
      distance(target, player) <= this.flashlightRange() &&
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
      distance(target, player) <= this.flashlightRange() &&
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

export interface SoundWave {
  readonly id: string;
  position: Point;
  readonly angle: number;
  travelled: number;
  hitPlayer?: boolean;
}

export type EnemyState =
  | 'lurking'
  | 'pouncing'
  | 'vanished'
  | 'patrol'
  | 'chase'
  | 'windup'
  | 'recovery'
  | 'request'
  | 'calmed'
  | 'mutation-warning'
  | 'stunned'
  | 'dead';
export type CombatWeaponId =
  | 'training-bat'
  | 'stun-baton'
  | 'folding-ruler'
  | 'long-broom'
  | 'window-breaker'
  | 'night-watch-spear';

const COMBAT_WEAPON_CONFIGS = {
  'training-bat': COMBAT_RULES.player.attack.weapons.trainingBat,
  'stun-baton': COMBAT_RULES.player.attack.weapons.stunBaton,
  'folding-ruler': COMBAT_RULES.player.attack.weapons.foldingRuler,
  'long-broom': COMBAT_RULES.player.attack.weapons.longBroom,
  'window-breaker': COMBAT_RULES.player.attack.weapons.windowBreaker,
  'night-watch-spear': COMBAT_RULES.player.attack.weapons.nightWatchSpear,
} as const;

export function isCombatWeaponId(itemId: string): itemId is CombatWeaponId {
  return Object.hasOwn(COMBAT_WEAPON_CONFIGS, itemId);
}

export function combatWeaponConfig(weaponId: CombatWeaponId) {
  return COMBAT_WEAPON_CONFIGS[weaponId];
}
/** Patrol animals share health and drops; cats use a separate ambush behavior. */
export const PATROL_SPECIES = ['duck', 'cat', 'swan'] as const;
export type PatrolSpecies = (typeof PATROL_SPECIES)[number];
export interface Enemy {
  id: string;
  kind: 'patrol' | 'hug' | 'amplifier';
  /** Set on patrol enemies. Omitted enemies render as ducks. */
  species?: PatrolSpecies;
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
  attackAngle?: number;
  windupLocked?: boolean;
  encounterRegion?: string;
}

/** Choose reachable cover beside tree trunks or building walls, never inside them. */
export function findCatHideout(
  anchor: Point,
  map: CombatMap,
  accepts: (point: Point) => boolean = () => true,
): Point {
  const rules = COMBAT_RULES.enemy.cat;
  const gap = 24;
  const candidates: Point[] = [];
  for (const wall of map.obstacles) {
    if (distanceToRect(anchor, wall) > rules.hideSearchRadius) continue;
    const x = Math.max(wall.x, Math.min(anchor.x, wall.x + wall.width));
    const y = Math.max(wall.y, Math.min(anchor.y, wall.y + wall.height));
    candidates.push(
      { x: wall.x - gap, y },
      { x: wall.x + wall.width + gap, y },
      { x, y: wall.y - gap },
      { x, y: wall.y + wall.height + gap },
    );
  }
  return (
    candidates
      .filter(
        (p) =>
          p.x >= 45 &&
          p.y >= 50 &&
          p.x <= map.width - 45 &&
          p.y <= map.height - 50 &&
          distance(anchor, p) <= rules.hideSearchRadius &&
          !map.obstacles.some((wall) => overlaps(p, 18, wall)) &&
          !nearExtraction(p, COMBAT_RULES.spawning.extractionSafeDistance, map) &&
          (!map.canSpawn || map.canSpawn(p)) &&
          lineOfSight(anchor, p, map.obstacles) &&
          accepts(p),
      )
      .sort((a, b) => distance(anchor, a) - distance(anchor, b))[0] ?? { ...anchor }
  );
}

export function enemyMaxHealth(kind: Enemy['kind']): number {
  if (kind === 'hug') return COMBAT_RULES.hug.health;
  if (kind === 'amplifier') return COMBAT_RULES.enemy.amplifier.health;
  return COMBAT_RULES.enemy.patrol.health;
}

export function encounterRegionKey(position: Point): string {
  const size = COMBAT_RULES.enemy.amplifier.encounterRegionSize;
  return `${Math.floor(position.x / size)}:${Math.floor(position.y / size)}`;
}

export function createEnemies(
  random: () => number = Math.random,
  map: CombatMap = activeMap(),
): Enemy[] {
  const bounds = { x: 45, y: 50, width: map.width - 90, height: map.height - 100 };
  const isClear = (candidate: Point): boolean =>
    candidate.x >= bounds.x + 18 &&
    candidate.x <= bounds.x + bounds.width - 18 &&
    candidate.y >= bounds.y + 18 &&
    candidate.y <= bounds.y + bounds.height - 18 &&
    !map.obstacles.some((obstacle) => overlaps(candidate, 18, obstacle)) &&
    !nearExtraction(candidate, COMBAT_RULES.spawning.extractionSafeDistance, map) &&
    (!map.canSpawn || map.canSpawn(candidate)) &&
    distance(candidate, map.spawn) >= COMBAT_RULES.spawning.minPlayerDistance;

  // Reserve valid fixed positions first so random spawns keep distance from them.
  const reservedPositions = new Map<string, Point>();
  for (const enemyConfig of map.enemyRoutes) {
    const fixed = enemyConfig.fixedPosition ? enemyConfig.route[0] : undefined;
    if (fixed && isClear(fixed)) {
      reservedPositions.set(enemyConfig.id, { ...fixed });
    }
  }
  const usedPositions: Point[] = [...reservedPositions.values()];
  const usedAmplifierRegions = new Set<string>();
  let amplifierCount = 0;
  let patrolOrdinal = 0;
  return map.enemyRoutes.flatMap((enemyConfig) => {
    if (
      enemyConfig.kind === 'amplifier' &&
      amplifierCount >= COMBAT_RULES.enemy.amplifier.maxAlive
    ) {
      return [];
    }
    const amplifierConflict = (candidate: Point): boolean =>
      enemyConfig.kind === 'amplifier' && usedAmplifierRegions.has(encounterRegionKey(candidate));
    let position: Point | null = null;
    const reserved = reservedPositions.get(enemyConfig.id);
    if (reserved && !amplifierConflict(reserved)) {
      position = reserved;
    }
    for (
      let attempt = 0;
      !position && attempt < COMBAT_RULES.spawning.candidateAttempts;
      attempt++
    ) {
      const candidatePosition = {
        x: bounds.x + random() * bounds.width,
        y: bounds.y + random() * bounds.height,
      };
      if (
        !isClear(candidatePosition) ||
        amplifierConflict(candidatePosition) ||
        usedPositions.some(
          (used) => distance(candidatePosition, used) < COMBAT_RULES.spawning.minEnemyDistance,
        )
      ) {
        continue;
      }
      position = candidatePosition;
      break;
    }
    if (!position) {
      for (let y = bounds.y + 24; y < bounds.y + bounds.height - 24 && !position; y += 32) {
        for (let x = bounds.x + 24; x < bounds.x + bounds.width - 24; x += 32) {
          const candidate = { x, y };
          if (
            !isClear(candidate) ||
            amplifierConflict(candidate) ||
            usedPositions.some(
              (used) => distance(candidate, used) < COMBAT_RULES.spawning.minEnemyDistance,
            )
          ) {
            continue;
          }
          position = candidate;
          break;
        }
      }
    }
    if (!position) return [];
    const spawnPosition = position;
    if (!reserved) {
      usedPositions.push(spawnPosition);
    }
    let encounterRegion: string | undefined;
    if (enemyConfig.kind === 'amplifier') {
      amplifierCount++;
      encounterRegion = encounterRegionKey(spawnPosition);
      usedAmplifierRegions.add(encounterRegion);
    }
    const species =
      enemyConfig.kind === 'patrol'
        ? PATROL_SPECIES[patrolOrdinal++ % PATROL_SPECIES.length]
        : undefined;
    return [
      {
        ...enemyConfig,
        species,
        route: [{ ...spawnPosition }],
        position: { ...spawnPosition },
        home: { ...spawnPosition },
        waypoint: 0,
        health: enemyMaxHealth(enemyConfig.kind),
        state: 'patrol',
        timer: 0,
        cooldown: 0,
        hugProgress: 0,
        calmHitCount: 0,
        mutated: false,
        wanders: enemyConfig.kind === 'patrol' || enemyConfig.kind === 'amplifier',
        encounterRegion,
      },
    ];
  });
}

export function findEnemySpawnPosition(
  player: Point,
  aim: number,
  lighting: NightLighting,
  enemies: readonly Enemy[],
  random: () => number = Math.random,
  map: CombatMap = activeMap(),
): Point | null {
  const rules = COMBAT_RULES.spawning;
  const bounds = { x: 45, y: 50, width: map.width - 90, height: map.height - 100 };
  for (let attempt = 0; attempt < rules.candidateAttempts; attempt++) {
    const point = {
      x: bounds.x + random() * bounds.width,
      y: bounds.y + random() * bounds.height,
    };
    if (
      distance(player, point) < rules.minPlayerDistance ||
      lighting.visible(point, player, aim, map.obstacles) ||
      map.obstacles.some((obstacle) => overlaps(point, 18, obstacle)) ||
      nearExtraction(point, rules.extractionSafeDistance, map) ||
      (map.canSpawn && !map.canSpawn(point)) ||
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

function findPatrolWaypoint(
  anchor: Point,
  current: Point,
  random: () => number,
  map: CombatMap,
): Point | null {
  const bounds = { x: 45, y: 50, width: map.width - 90, height: map.height - 100 };
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
      map.obstacles.some((obstacle) => overlaps(point, 18, obstacle)) ||
      nearExtraction(point, COMBAT_RULES.spawning.extractionSafeDistance, map) ||
      (map.canSpawn && !map.canSpawn(point)) ||
      distance(current, point) < COMBAT_RULES.spawning.patrolStepMinDistance ||
      !lineOfSight(current, point, map.obstacles)
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
  private readonly remainingWeaponUses = new Map<string, number>();
  private spawnTimer = 0;
  private hugSpawnTimer: number = COMBAT_RULES.spawning.hugSpawnIntervalMs;
  private nextSpawnId = 1;
  private nextPatrolSpecies = 0;
  private amplifierSpawnTimer = COMBAT_RULES.enemy.amplifier.spawnIntervalMs;
  private nextWaveId = 1;
  readonly soundWaves: SoundWave[] = [];

  constructor(
    private readonly random: () => number = Math.random,
    private readonly map: () => CombatMap = activeMap,
  ) {
    this.enemies = createEnemies(this.random, this.map());
    this.resetSpawnTimer();
  }

  reset(): void {
    this.enemies = createEnemies(this.random, this.map());
    this.attackCooldown = 0;
    this.invulnerability = 0;
    this.swingMs = 0;
    this.attackHit = false;
    this.currentWeaponId = 'training-bat';
    this.weaponUsesRemaining = null;
    this.remainingWeaponUses.clear();
    this.nextSpawnId = 1;
    this.nextPatrolSpecies = 0;
    this.amplifierSpawnTimer = COMBAT_RULES.enemy.amplifier.spawnIntervalMs;
    this.nextWaveId = 1;
    this.soundWaves.length = 0;
    this.resetSpawnTimer();
    this.hugSpawnTimer = COMBAT_RULES.spawning.hugSpawnIntervalMs;
  }

  updateSpawns(deltaMs: number, findPosition: () => Point | null): Enemy[] {
    const elapsed = Math.max(0, deltaMs);
    this.spawnTimer -= elapsed;
    this.hugSpawnTimer -= elapsed;
    this.amplifierSpawnTimer -= elapsed;
    const rules = COMBAT_RULES.spawning;
    const spawned: Enemy[] = [];
    if (this.spawnTimer <= 0) {
      this.resetSpawnTimer();
      for (let i = 0; i < rules.spawnCount && this.aliveEnemyCount() < rules.maxAlive; i++) {
        const position = findPosition();
        if (!position) break;
        const patrolPoint = findPatrolWaypoint(position, position, this.random, this.map());
        if (!patrolPoint) continue;
        const enemy: Enemy = {
          id: `spawn-${this.nextSpawnId++}`,
          kind: 'patrol',
          species: PATROL_SPECIES[this.nextPatrolSpecies++ % PATROL_SPECIES.length],
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
    const amplifierRules = COMBAT_RULES.enemy.amplifier;
    if (this.amplifierSpawnTimer <= 0) {
      this.amplifierSpawnTimer = amplifierRules.spawnIntervalMs;
      if (
        this.aliveEnemyCount() < rules.maxAlive &&
        this.aliveAmplifierCount() < amplifierRules.maxAlive &&
        this.random() < amplifierRules.spawnChance
      ) {
        for (let attempt = 0; attempt < 8; attempt++) {
          const position = findPosition();
          if (!position || this.hasAmplifierInRegion(position)) continue;
          const patrolPoint = findPatrolWaypoint(position, position, this.random, this.map());
          if (!patrolPoint) continue;
          const enemy: Enemy = {
            id: `spawn-amplifier-${this.nextSpawnId++}`,
            kind: 'amplifier',
            position: { ...position },
            home: { ...position },
            route: [patrolPoint],
            waypoint: 0,
            health: amplifierRules.health,
            state: 'patrol',
            timer: 0,
            cooldown: 0,
            hugProgress: 0,
            calmHitCount: 0,
            mutated: false,
            wanders: true,
            encounterRegion: encounterRegionKey(position),
          };
          this.enemies.push(enemy);
          spawned.push(enemy);
          break;
        }
      }
    }
    if (this.hugSpawnTimer <= 0) {
      this.hugSpawnTimer = rules.hugSpawnIntervalMs;
      for (let i = 0; i < rules.hugSpawnCount && this.aliveEnemyCount() < rules.maxAlive; i++) {
        const position = findPosition();
        if (!position) break;
        const enemy: Enemy = {
          id: 'spawn-hug-' + this.nextSpawnId++,
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
    return spawned;
  }

  private aliveAmplifierCount(): number {
    return this.enemies.filter((enemy) => enemy.kind === 'amplifier' && enemy.state !== 'dead')
      .length;
  }

  private hasAmplifierInRegion(position: Point): boolean {
    const region = encounterRegionKey(position);
    return (
      this.enemies.filter(
        (enemy) =>
          enemy.kind === 'amplifier' &&
          enemy.state !== 'dead' &&
          (enemy.encounterRegion ?? encounterRegionKey(enemy.position)) === region,
      ).length >= COMBAT_RULES.enemy.amplifier.maxPerEncounterRegion
    );
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
  private weaponDurabilityKey(weaponId: CombatWeaponId, instanceId?: string): string {
    return instanceId ? `instance:${instanceId}` : weaponId;
  }

  getWeaponUsesRemaining(weaponId: CombatWeaponId, instanceId?: string): number | null {
    const weapon = combatWeaponConfig(weaponId);
    return (
      this.remainingWeaponUses.get(this.weaponDurabilityKey(weaponId, instanceId)) ?? weapon.maxUses
    );
  }

  attack(
    player: Point,
    aim: number,
    walls: readonly Rect[],
    damage: number,
    weaponId: CombatWeaponId = 'training-bat',
    instanceId?: string,
  ): Enemy[] {
    this.attackHit = false;
    const weapon = combatWeaponConfig(weaponId);
    this.weaponUsesRemaining = this.getWeaponUsesRemaining(weaponId, instanceId);
    this.currentWeaponId = weaponId;
    if (this.attackCooldown > 0 || this.weaponUsesRemaining === 0) {
      return [];
    }
    this.attackCooldown = weapon.cooldownMs;
    this.swingMs = COMBAT_RULES.player.attack.swingMs;
    if (this.weaponUsesRemaining !== null) {
      this.weaponUsesRemaining--;
      this.remainingWeaponUses.set(
        this.weaponDurabilityKey(weaponId, instanceId),
        this.weaponUsesRemaining,
      );
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
      if (enemy.kind === 'patrol' && enemy.species === 'cat') {
        enemy.health = Math.max(0, enemy.health - damage);
        enemy.state = enemy.health === 0 ? 'dead' : weapon.stunMs ? 'stunned' : 'windup';
        enemy.timer =
          enemy.health === 0
            ? 0
            : weapon.stunMs
              ? weapon.stunMs.patrol
              : COMBAT_RULES.enemy.cat.windupMs;
        enemy.attackAngle = angleBetween(enemy.position, player);
        if (enemy.health === 0) defeated.push(enemy);
        continue;
      }
      if (enemy.kind === 'hug' && !enemy.mutated) {
        enemy.health = Math.max(0, enemy.health - damage);
        if (enemy.health === 0) {
          enemy.state = 'dead';
          defeated.push(enemy);
        } else if (damage > 0) {
          this.warnMutation(enemy);
        }
        continue;
      }
      if (enemy.kind === 'amplifier') {
        const wasWindup = enemy.state === 'windup';
        enemy.health = Math.max(0, enemy.health - damage);
        if (enemy.health === 0) {
          enemy.state = 'dead';
          enemy.windupLocked = false;
          defeated.push(enemy);
        } else if (weapon.stunMs) {
          enemy.state = 'stunned';
          enemy.timer = weapon.stunMs.amplifier;
          enemy.windupLocked = false;
          if (wasWindup) {
            // Interrupted charge forces at least 1.5s before recharging.
            enemy.cooldown = COMBAT_RULES.enemy.amplifier.interruptCooldownMs;
          }
        } else if (enemy.state !== 'windup' && enemy.state !== 'recovery') {
          enemy.state = 'chase';
          enemy.timer = COMBAT_RULES.enemy.chaseMemoryMs;
        }
        enemy.hugProgress = 0;
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

  private updateCat(
    enemy: Enemy,
    dt: number,
    player: Point,
    walls: readonly Rect[],
    bounds: Rect,
    detectionScale: number,
    playerInvulnerable: boolean,
  ): number {
    const rules = COMBAT_RULES.enemy.cat;
    enemy.cooldown = Math.max(0, enemy.cooldown - dt);
    const beginHiding = () => {
      enemy.state = 'lurking';
      enemy.home = findCatHideout(
        enemy.position,
        this.map(),
        (p) =>
          distance(p, player) >= rules.triggerRange &&
          this.enemies.every(
            (other) =>
              other === enemy || other.state === 'dead' || distance(p, other.position) >= 32,
          ),
      );
    };
    switch (enemy.state) {
      case 'vanished':
        enemy.timer -= dt;
        if (enemy.timer <= 0) beginHiding();
        return 0;
      case 'stunned':
        enemy.timer -= dt;
        if (enemy.timer <= 0) beginHiding();
        return 0;
      case 'windup':
        enemy.timer -= dt;
        if (enemy.timer <= 0) {
          enemy.state = 'pouncing';
          enemy.timer = rules.pounceMs;
        }
        return 0;
      case 'pouncing': {
        // Lock direction at the tell: sidestepping can dodge, walls stop the lunge.
        const angle = enemy.attackAngle ?? angleBetween(enemy.position, player);
        const before = enemy.position;
        const elapsed = Math.min(dt, enemy.timer);
        enemy.position = movePlayer(
          before,
          { x: Math.cos(angle), y: Math.sin(angle) },
          elapsed,
          rules.pounceSpeed,
          rules.collisionRadius,
          bounds,
          walls,
        );
        enemy.timer -= dt;
        const hit =
          distance(enemy.position, player) <= COMBAT_RULES.enemy.attack.contactRange &&
          lineOfSight(enemy.position, player, walls);
        const blocked =
          distance(before, enemy.position) < ((rules.pounceSpeed * elapsed) / 1000) * 0.5;
        let damage = 0;
        if (hit && !playerInvulnerable && this.invulnerability <= 0) {
          this.invulnerability = COMBAT_RULES.player.invulnerabilityMs;
          damage = COMBAT_RULES.enemy.patrol.damage;
        }
        if (hit || blocked || enemy.timer <= 0) {
          enemy.state = 'vanished';
          enemy.timer = rules.vanishMs;
          enemy.cooldown = rules.cooldownMs;
        }
        return damage;
      }
      case 'lurking':
        break;
      default:
        beginHiding();
    }
    if (
      enemy.cooldown === 0 &&
      distance(enemy.position, player) <= rules.triggerRange * detectionScale &&
      lineOfSight(enemy.position, player, walls)
    ) {
      enemy.state = 'windup';
      enemy.timer = rules.windupMs;
      enemy.attackAngle = angleBetween(enemy.position, player);
    } else if (distance(enemy.position, enemy.home) > 6) {
      enemy.position = movePlayer(
        enemy.position,
        { x: enemy.home.x - enemy.position.x, y: enemy.home.y - enemy.position.y },
        dt,
        COMBAT_RULES.enemy.patrol.speed,
        rules.collisionRadius,
        bounds,
        walls,
      );
    }
    return 0;
  }

  private warnMutation(enemy: Enemy): void {
    if (enemy.state === 'mutation-warning') {
      return;
    }
    enemy.state = 'mutation-warning';
    enemy.timer = COMBAT_RULES.hug.mutationWarningMs;
    enemy.hugProgress = 0;
    enemy.calmHitCount = 0;
  }

  /** Only effective player damage during an active hug triggers mutation. */
  onPlayerDamaged(calmingAtStart: ReadonlySet<string> = new Set()): void {
    for (const enemy of this.enemies) {
      if (
        enemy.kind === 'hug' &&
        !enemy.mutated &&
        ((enemy.state === 'request' && enemy.hugProgress > 0) ||
          (calmingAtStart.has(enemy.id) && (enemy.state === 'request' || enemy.state === 'calmed')))
      ) {
        this.warnMutation(enemy);
      }
      enemy.hugProgress = 0;
    }
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
    detectionMultiplierOrInvulnerable: number | boolean = 1,
    playerInvulnerableArg = false,
  ): {
    damage: number;
    calmed: Enemy[];
    slowHit: boolean;
    tinnitusHit: boolean;
    soundWaveHit: boolean;
    amplifierWindups: Enemy[];
  } {
    const dt = Math.max(0, Math.min(deltaMs, 100));
    const detectionMultiplier =
      typeof detectionMultiplierOrInvulnerable === 'number' ? detectionMultiplierOrInvulnerable : 1;
    const playerInvulnerable =
      typeof detectionMultiplierOrInvulnerable === 'boolean'
        ? detectionMultiplierOrInvulnerable
        : playerInvulnerableArg;
    const detectionScale = Number.isFinite(detectionMultiplier)
      ? Math.max(0.1, Math.min(1, detectionMultiplier))
      : 1;
    this.tick(dt);
    let damage = 0;
    let slowHit = false;
    let tinnitusHit = false;
    let soundWaveHit = false;
    const amplifierWindups: Enemy[] = [];
    const ampRules = COMBAT_RULES.enemy.amplifier;
    const waveHalfWidth = ampRules.projectileWidth / 2;
    this.soundWaves.forEach((wave) => {
      const step = (ampRules.projectileSpeed * dt) / 1000;
      const blocked = rayDistance(wave.position, wave.angle, step, walls);
      const moved = Math.min(step, blocked);
      const next = {
        x: wave.position.x + Math.cos(wave.angle) * moved,
        y: wave.position.y + Math.sin(wave.angle) * moved,
      };
      const vx = next.x - wave.position.x;
      const vy = next.y - wave.position.y;
      const length2 = vx * vx + vy * vy;
      const t = length2
        ? Math.max(
            0,
            Math.min(
              1,
              ((player.x - wave.position.x) * vx + (player.y - wave.position.y) * vy) / length2,
            ),
          )
        : 0;
      const closest = { x: wave.position.x + vx * t, y: wave.position.y + vy * t };
      const gap = distance(player, closest);
      if (!wave.hitPlayer && gap <= waveHalfWidth && lineOfSight(closest, player, walls)) {
        wave.hitPlayer = true;
        if (!playerInvulnerable && this.acceptDamage()) {
          damage += ampRules.damage;
          slowHit = true;
          tinnitusHit = true;
          soundWaveHit = true;
          wave.travelled = ampRules.projectileMaxDistance + 1;
          return;
        }
      }
      wave.position = next;
      wave.travelled += moved;
      if (blocked < step) {
        wave.travelled = ampRules.projectileMaxDistance + 1;
      }
    });
    for (let index = this.soundWaves.length - 1; index >= 0; index--) {
      const wave = this.soundWaves[index]!;
      if (wave.travelled >= ampRules.projectileMaxDistance) {
        this.soundWaves.splice(index, 1);
      }
    }
    const calmed: Enemy[] = [];
    const calmingAtStart = new Set(
      this.enemies
        .filter((enemy) => enemy.state === 'request' && enemy.hugProgress > 0)
        .map((enemy) => enemy.id),
    );
    for (const enemy of this.enemies) {
      if (enemy.state === 'dead') {
        continue;
      }
      if (enemy.kind === 'patrol' && enemy.species === 'cat') {
        damage += this.updateCat(
          enemy,
          dt,
          player,
          walls,
          bounds,
          detectionScale,
          playerInvulnerable,
        );
        continue;
      }
      if (enemy.state === 'mutation-warning') {
        enemy.timer -= dt;
        if (enemy.timer <= 0) {
          enemy.mutated = true;
          enemy.health = COMBAT_RULES.hug.health;
          enemy.state = 'chase';
          enemy.timer = COMBAT_RULES.enemy.chaseMemoryMs;
        }
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
        enemy.cooldown = Math.max(0, enemy.cooldown - dt);
        if (enemy.timer <= 0) {
          enemy.state = 'chase';
          enemy.timer = COMBAT_RULES.enemy.chaseMemoryMs;
        }
        continue;
      }
      if (enemy.state === 'recovery') {
        enemy.timer -= dt;
        enemy.cooldown = Math.max(0, enemy.cooldown - dt);
        enemy.windupLocked = false;
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
            this.warnMutation(enemy);
            continue;
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
      if (enemy.kind === 'amplifier') {
        const rules = COMBAT_RULES.enemy.amplifier;
        if (enemy.state === 'windup') {
          enemy.timer -= dt;
          if (enemy.timer > rules.lockBeforeFireMs) {
            enemy.attackAngle = angleBetween(enemy.position, player);
            enemy.windupLocked = false;
          } else {
            enemy.windupLocked = true;
          }
          if (enemy.timer <= 0) {
            const angle = enemy.attackAngle ?? angleBetween(enemy.position, player);
            this.soundWaves.push({
              id: `wave-${this.nextWaveId++}`,
              position: { ...enemy.position },
              angle,
              travelled: 0,
            });
            enemy.state = 'recovery';
            enemy.timer = rules.recoveryMs;
            enemy.windupLocked = false;
          }
          continue;
        }
        const ampDetection = lightOn ? rules.detectionLightRange : rules.detectionDarkRange;
        if (sight && d < ampDetection) {
          enemy.state = 'chase';
          enemy.timer = COMBAT_RULES.enemy.chaseMemoryMs;
        } else if (enemy.state === 'chase') {
          enemy.timer -= dt;
          if (enemy.timer <= 0) {
            enemy.state = 'patrol';
          }
        }
        const beginWindup = () => {
          enemy.attackAngle = angleBetween(enemy.position, player);
          enemy.windupLocked = false;
          enemy.state = 'windup';
          enemy.timer = rules.windupMs;
          enemy.cooldown = rules.cooldownMs;
          amplifierWindups.push(enemy);
        };
        if (enemy.state === 'chase') {
          if (d < rules.attackRangeMin) {
            const away =
              d > 0.001
                ? { x: enemy.position.x - player.x, y: enemy.position.y - player.y }
                : { x: 1, y: 0 };
            const before = enemy.position;
            const nextPos = movePlayer(before, away, dt, rules.retreatSpeed, 12, bounds, walls);
            enemy.position = nextPos;
            const movedDist = distance(before, nextPos);
            const expectedStep = (rules.retreatSpeed * dt) / 1000;
            const retreatBlocked = expectedStep > 0.001 && movedDist < expectedStep * 0.25;
            if (retreatBlocked && enemy.cooldown === 0 && sight) {
              beginWindup();
            }
          } else if (
            enemy.cooldown === 0 &&
            sight &&
            d >= rules.attackRangeMin &&
            d <= rules.attackRangeMax
          ) {
            beginWindup();
          } else if (!sight || d > rules.preferredRangeMax) {
            enemy.position = movePlayer(
              enemy.position,
              { x: player.x - enemy.position.x, y: player.y - enemy.position.y },
              dt,
              rules.chaseSpeed,
              12,
              bounds,
              walls,
            );
          } else if (d < rules.preferredRangeMin) {
            enemy.position = movePlayer(
              enemy.position,
              { x: enemy.position.x - player.x, y: enemy.position.y - player.y },
              dt,
              rules.retreatSpeed,
              12,
              bounds,
              walls,
            );
          }
        } else if (enemy.state === 'patrol') {
          let target = enemy.route[enemy.waypoint]!;
          if (distance(enemy.position, target) < 12) {
            if (enemy.wanders) {
              const next = findPatrolWaypoint(enemy.home, enemy.position, this.random, this.map());
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
          enemy.position = movePlayer(
            enemy.position,
            { x: target.x - enemy.position.x, y: target.y - enemy.position.y },
            dt,
            rules.speed,
            12,
            bounds,
            walls,
          );
        }
        enemy.encounterRegion = encounterRegionKey(enemy.position);
        continue;
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
      if (sight && d < detectionRange * detectionScale) {
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
          const next = findPatrolWaypoint(enemy.home, enemy.position, this.random, this.map());
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
    if (damage > 0) {
      this.onPlayerDamaged(calmingAtStart);
    }
    return {
      damage,
      calmed: calmed.filter((enemy) => enemy.state === 'calmed'),
      slowHit,
      tinnitusHit,
      soundWaveHit,
      amplifierWindups,
    };
  }
}
