import { ITEM_DEFINITIONS, RAID_RULES } from '../config/game-config';
import { ReferenceInventory } from '../modules/inventory/reference-inventory';
import { RaidController } from '../modules/raid/raid-controller';
import { PersistentSave } from '../modules/save/persistent-save';
import type { StoragePort } from '../modules/save/reference-save';
import { contains, movePlayer } from '../modules/world/movement';
import {
  generateChargingStations,
  CHARGING_STATION_RANGE,
  type ChargingStation,
} from '../modules/world/charging-stations';
import { SearchInteraction } from '../modules/world/search-interaction';
import { EventBus } from '../shared/events/game-events';
import type { ItemInstance, Point, Rect } from '../shared/types/game';
import { facingFromDirection, type Facing } from './animation';
import { EXTRACTION_NAME, TRIAL_MAP, type TrialMap } from './map';
import { trialStorage } from './storage';
import {
  NightLighting,
  NightCombat,
  findEnemySpawnPosition,
  shouldDropPatrolLoot,
  type CombatMap,
  type CombatWeaponId,
  type Enemy,
} from '../modules/world/night-systems';
import { campusLamps, type NightAction } from './night';
import { campusCombatMap } from './combat-map';
import { COMBAT_RULES } from '../config/combat-config';

export interface TrialInput {
  move: Point;
  interact: boolean;
  aim?: Point;
  attack?: boolean;
  hug?: boolean;
}
export const EMPTY_INPUT: TrialInput = { move: { x: 0, y: 0 }, interact: false };
export type { GroundItem, WorldFrame as TrialFrame } from './world-frame';
import type { GroundItem, WorldFrame as TrialFrame } from './world-frame';

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Segment/AABB clipping; the same explicit footprints govern movement and interaction. */
export function unobstructed(a: Point, b: Point, walls: readonly Rect[] = TRIAL_MAP.obstacles) {
  return !walls.some((wall) => {
    let enter = 0;
    let exit = 1;
    for (const [start, direction, min, max] of [
      [a.x, b.x - a.x, wall.x, wall.x + wall.width],
      [a.y, b.y - a.y, wall.y, wall.y + wall.height],
    ] as const) {
      if (Math.abs(direction) < 0.000001) {
        if (start < min || start > max) {
          return false;
        }
      } else {
        const t1 = (min - start) / direction;
        const t2 = (max - start) / direction;
        enter = Math.max(enter, Math.min(t1, t2));
        exit = Math.min(exit, Math.max(t1, t2));
        if (enter > exit) {
          return false;
        }
      }
    }
    return exit >= enter;
  });
}

export class TrialSession {
  readonly lighting: NightLighting;
  private chargingStations: ChargingStation[] = [];
  readonly combat?: NightCombat;
  private readonly combatMap?: CombatMap;
  private readonly deadMs = new Map<string, number>();
  private rewardOrdinal = 0;
  private hugPrompt?: { text: string; progress: number };
  private aim = -Math.PI / 2;
  readonly events = new EventBus();
  readonly save: PersistentSave;
  readonly inventory = new ReferenceInventory(
    this.events,
    RAID_RULES.bagCapacity,
    ITEM_DEFINITIONS,
  );
  readonly controller: RaidController;
  private position: Point;
  private facing: Facing = 'up';
  private moving = false;
  private readonly search: SearchInteraction;
  private readonly ground = new Map<string, GroundItem>();
  private previousInteract = false;
  private prompt = `寻找散落在校园里的八只宝箱，再回到${EXTRACTION_NAME}。`;
  private target: string | null = null;
  private hurtUntil = 0;
  private damaged = false;
  private readonly unsubscribe: () => void;

  constructor(
    storage: StoragePort,
    private readonly clock: () => number = Date.now,
    newId: () => string = () => crypto.randomUUID(),
    private readonly sound: (name: string) => void = () => undefined,
    private readonly map: TrialMap = TRIAL_MAP,
    private readonly night = false,
    private readonly combatEnabled = night,
    private readonly random: () => number = Math.random,
  ) {
    this.lighting = new NightLighting(campusLamps(map));
    if (combatEnabled) {
      this.combatMap = campusCombatMap(map);
      this.combat = new NightCombat(random, () => this.combatMap!);
    }
    this.position = { ...map.spawn };
    this.save = new PersistentSave(trialStorage(storage));
    this.controller = new RaidController(
      this.inventory,
      this.save,
      this.events,
      { ...RAID_RULES, threshold: 100 },
      ITEM_DEFINITIONS,
      clock,
      newId,
    );
    this.search = new SearchInteraction(RAID_RULES.searchDurationMs, clock);
    this.unsubscribe = this.events.on('DamageTaken', () => {
      this.search.cancel();
      this.hurtUntil = this.clock() + 500;
      this.damaged = true;
      this.combat?.onPlayerDamaged();
      this.sound('hurt');
    });
  }

  async start(weapon: CombatWeaponId = 'training-bat') {
    const result = await this.controller.start([], this.combatEnabled ? weapon : undefined);
    if (result.ok) {
      this.reset();
    }
    return result;
  }

  prepareNext(): boolean {
    if (!this.controller.prepareNext()) {
      return false;
    }
    this.reset();
    return true;
  }

  pause(): void {
    this.clearInteractions();
    this.controller.pause();
  }

  clearInteractions(): void {
    this.search.cancel();
    this.previousInteract = false;
    this.moving = false;
    this.target = null;
    this.hugPrompt = undefined;
    if (this.combat) for (const enemy of this.combat.enemies) enemy.hugProgress = 0;
  }

  private bagCount(): number {
    const equipped = new Set(Object.values(this.inventory.getEquipment()).map((p) => p.instanceId));
    return this.inventory
      .getCarriedItems()
      .reduce(
        (n, p) =>
          n + (equipped.has(p.instanceId) ? 0 : (ITEM_DEFINITIONS[p.itemId]?.bagSlots ?? 1)),
        0,
      );
  }

  private spawnReward(itemId: string, enemy: Enemy, suffix: string): void {
    const raidId = this.controller.getView().raidId;
    if (!raidId) return;
    const item: ItemInstance = {
      instanceId: `${raidId}:${suffix}:${enemy.id}:${++this.rewardOrdinal}`,
      itemId,
      origin: { kind: 'raid-loot', obtainedInRaidId: raidId },
    };
    this.ground.set(item.instanceId, { item, position: { ...enemy.position } });
  }

  private updateCombat(deltaMs: number, input: TrialInput): void {
    const combat = this.combat;
    this.hugPrompt = undefined;
    if (!combat) return;
    const dt = Math.max(0, Math.min(deltaMs, 100));
    if (input.attack) {
      this.search.cancel();
      const weapon =
        this.inventory.getEquipment().primary ??
        this.inventory.getCarriedItems().find((p) => ITEM_DEFINITIONS[p.itemId]?.kind === 'weapon');
      if (weapon && combat.attackCooldown <= 0) {
        const stun = weapon.itemId === 'stun-baton';
        const defeated = combat.attack(
          this.position,
          this.aim,
          this.map.obstacles,
          stun
            ? COMBAT_RULES.player.attack.weapons.stunBaton.damage
            : COMBAT_RULES.player.attack.weapons.trainingBat.damage,
          stun ? 'stun-baton' : 'training-bat',
        );
        if (combat.swingMs > 0) this.sound('hit');
        for (const enemy of defeated) {
          const raidId = this.controller.getView().raidId;
          if (raidId) this.events.emit('EnemyDefeated', { raidId, enemyId: enemy.id });
          if (enemy.kind === 'patrol' && shouldDropPatrolLoot(this.random))
            this.spawnReward('school-badge', enemy, 'enemy');
        }
      }
    }
    const result = combat.update(
      dt,
      this.position,
      !this.night || this.lighting.enabled,
      !!input.hug && !input.attack,
      !this.moving,
      this.map.obstacles,
      this.map.bounds,
      this.controller.isInvulnerable(),
    );
    if (result.soundWaveHit) this.controller.applySoundWaveEffect();
    if (result.damage) this.controller.applyDamage(result.damage);
    for (const enemy of result.calmed) {
      this.spawnReward('gpa-charm', enemy, 'hug');
      this.sound('pick');
    }
    combat.updateSpawns(dt, () =>
      findEnemySpawnPosition(
        this.position,
        this.aim,
        this.lighting,
        combat.enemies,
        this.random,
        this.combatMap!,
      ),
    );
    for (const enemy of combat.enemies) {
      if (enemy.state !== 'dead') continue;
      this.deadMs.set(enemy.id, (this.deadMs.get(enemy.id) ?? 0) + dt);
    }
    combat.enemies = combat.enemies.filter((e) => {
      if ((this.deadMs.get(e.id) ?? 0) < 1800) return true;
      this.deadMs.delete(e.id);
      return false;
    });
    const request = combat.enemies
      .filter(
        (e) =>
          e.kind === 'hug' &&
          e.state === 'request' &&
          distance(e.position, this.position) < COMBAT_RULES.hug.calmRange &&
          unobstructed(e.position, this.position, this.map.obstacles),
      )
      .sort((a, b) => distance(a.position, this.position) - distance(b.position, this.position))[0];
    if (request)
      this.hugPrompt = {
        text: `长按 Q 抱抱 1.5 秒 · 剩余 ${Math.ceil(request.timer / 1000)} 秒`,
        progress: request.hugProgress / COMBAT_RULES.hug.calmHoldDurationMs,
      };
  }

  nightAction(action: NightAction): string | undefined {
    const phase = this.controller.getView().phase;
    if (!this.night || this.controller.isPaused() || (phase !== 'active' && phase !== 'extracting'))
      return;
    if (action === 'flashlight') {
      this.lighting.toggle();
      return this.lighting.enabled
        ? '手电已开启'
        : this.lighting.battery <= 0
          ? '手电没电了 · 按 T 换电池'
          : '手电已关闭';
    }
    if (action === 'battery')
      return this.lighting.refill()
        ? '已更换电池 · 电量充满'
        : this.lighting.spareBatteries === 0
          ? '备用电池已用完'
          : '电量已满';
    return this.lighting.deploy(this.position) ? '已放置照明弹 · 持续 30 秒' : '照明弹已用完';
  }

  private reveals(point: Point): boolean {
    return (
      !this.night ||
      this.lighting.flashlightReveals(point, this.position, this.aim, this.map.obstacles)
    );
  }

  update(deltaMs: number, input: TrialInput): void {
    this.controller.tick();
    const view = this.controller.getView();
    if (this.controller.isPaused() || (view.phase !== 'active' && view.phase !== 'extracting')) {
      this.clearInteractions();
      return;
    }
    const oldPosition = this.position;
    if (this.night) this.lighting.tick(deltaMs);
    this.position = movePlayer(
      this.position,
      input.move,
      deltaMs,
      this.map.playerSpeed * this.controller.getMoveSpeedMultiplier(),
      this.map.playerRadius,
      this.map.bounds,
      this.map.obstacles,
    );
    this.moving = distance(oldPosition, this.position) > 0.001;
    const direction =
      input.aim && distance(input.aim, this.position) > 8
        ? { x: input.aim.x - this.position.x, y: input.aim.y - this.position.y }
        : input.move;
    // Mouse/camera aim owns orientation even while strafing or walking backwards.
    // Movement supplies a fallback only for adapters without an aim direction.
    if (direction.x || direction.y) {
      this.aim = Math.atan2(direction.y, direction.x);
      this.facing = facingFromDirection(direction);
    }
    this.updateCombat(deltaMs, input);
    const phase = this.controller.getView().phase;
    if (phase !== 'active' && phase !== 'extracting') {
      this.clearInteractions();
      return;
    }
    this.controller.setExtractionPresence(contains(this.map.extraction, this.position));
    this.target = null;
    const station = this.chargingStations.find(
      (source) =>
        distance(source, this.position) < CHARGING_STATION_RANGE &&
        unobstructed(this.position, source, this.map.obstacles),
    );
    const drop = [...this.ground.values()].find(
      (entry) =>
        distance(this.position, entry.position) < 42 &&
        unobstructed(this.position, entry.position, this.map.obstacles),
    );
    const chest = this.map.chests
      .filter(
        (entry) =>
          !this.search.isOpened(entry.id) &&
          this.reveals(entry) &&
          distance(this.position, entry) < 60 &&
          unobstructed(this.position, entry, this.map.obstacles),
      )
      .sort((a, b) => distance(this.position, a) - distance(this.position, b))[0];
    const full = this.bagCount() >= RAID_RULES.bagCapacity;
    const held = input.interact && !this.damaged && !input.attack && !input.hug;
    if (drop) {
      this.search.cancel();
      this.prompt = full ? '背包已满 · 按 B 丢弃一件物品后拾取' : '按 E 拾回地上的物品';
      if (!full && held && !this.previousInteract && this.inventory.addLoot(drop.item).ok) {
        this.ground.delete(drop.item.instanceId);
        if (
          ITEM_DEFINITIONS[drop.item.itemId]?.kind === 'weapon' &&
          !this.inventory.getEquipment().primary
        )
          this.inventory.equip(drop.item.instanceId, 'primary');
        this.sound('pick');
      }
    } else if (chest && view.phase === 'active') {
      this.target = chest.id;
      this.prompt = full ? '背包已满 · 宝箱保留，按 B 管理背包' : '停下脚步 · 长按 E 搜索 2 秒';
      if (full || !held || this.moving) {
        this.search.cancel();
      } else {
        if (this.search.current() !== chest.id) {
          this.sound('box');
        }
        this.search.begin(chest.id);
        if (this.search.progress() >= 1 && view.raidId) {
          const item: ItemInstance = {
            instanceId: `${view.raidId}:${chest.id}`,
            itemId: chest.itemId,
            origin: { kind: 'raid-loot', obtainedInRaidId: view.raidId },
          };
          if (this.search.finish(item, (entry) => this.inventory.addLoot(entry)).ok) {
            this.sound('pick');
            this.events.emit('LocationInteracted', { raidId: view.raidId, locationId: chest.id });
          }
        }
      }
    } else if (station && !this.controller.getView().inExtractionZone) {
      this.target = `charge:${station.id}`;
      this.prompt =
        this.lighting.battery >= 99 ? '充电桩 · 手电筒电量已满' : '停下脚步 · 长按 E 充电 2 秒';
      if (this.lighting.battery >= 99 || !held || this.moving) this.search.cancel();
      else {
        this.search.begin(this.target);
        if (this.search.progress() >= 1) {
          this.lighting.charge();
          this.search.cancel();
          this.prompt = '手电筒已充满';
          this.sound('pick');
        }
      }
    } else {
      this.search.cancel();
      const current = this.controller.getView();
      this.prompt = current.inExtractionZone
        ? current.phase === 'extracting'
          ? `正在撤离 · 请留在${EXTRACTION_NAME}区域内`
          : current.value >= current.threshold
            ? '按 E 开始撤离 · 在区域内停留 5 秒'
            : `${EXTRACTION_NAME} · 还需 ${current.threshold - current.value} 价值`
        : `寻找金色宝箱 · 收集 100 价值后回到${EXTRACTION_NAME}`;
      if (
        current.inExtractionZone &&
        held &&
        !this.previousInteract &&
        this.controller.startExtraction().ok
      ) {
        this.sound('home');
      }
    }
    if (this.hugPrompt) {
      this.search.cancel();
      this.prompt = this.hugPrompt.text;
      this.target = null;
    }
    if (input.attack || input.hug) this.search.cancel();
    this.previousInteract = input.interact;
    this.damaged = false;
    this.controller.tick();
  }

  drop(instanceId: string): boolean {
    const phase = this.controller.getView().phase;
    if (phase !== 'active' && phase !== 'extracting') {
      return false;
    }
    const result = this.inventory.remove(instanceId);
    if (!result.ok) {
      return false;
    }
    this.search.cancel();
    this.ground.set(instanceId, { item: result.value, position: { ...this.position } });
    return true;
  }

  frame(): TrialFrame {
    return {
      chargingStations: this.chargingStations,
      position: { ...this.position },
      facing: this.facing,
      moving: this.moving,
      action:
        this.controller.getView().health <= 0
          ? 'death'
          : this.clock() < this.hurtUntil
            ? 'hurt'
            : this.combat && this.combat.swingMs > 0
              ? 'attack'
              : this.moving
                ? 'walk'
                : 'idle',
      opened: this.map.chests
        .filter((entry) => this.search.isOpened(entry.id))
        .map((entry) => entry.id),
      ground: structuredClone([...this.ground.values()]),
      prompt: this.prompt,
      searchProgress: this.hugPrompt?.progress ?? this.search.progress(),
      target: this.target,
      visibleChests: this.map.chests.filter((p) => this.reveals(p)).map((p) => p.id),
      combat: {
        enabled: this.combatEnabled,
        enemies:
          this.combat?.enemies.map((e) => ({
            ...e,
            position: { ...e.position },
            home: { ...e.home },
            route: [...e.route],
          })) ?? [],
        visibleEnemies:
          this.combat?.enemies
            .filter(
              (e) =>
                !this.night ||
                this.lighting.visible(e.position, this.position, this.aim, this.map.obstacles),
            )
            .map((e) => e.id) ?? [],
        soundWaves:
          this.combat?.soundWaves.map((wave) => ({
            ...wave,
            position: { ...wave.position },
          })) ?? [],
        swing: this.combat?.swingMs ?? 0,
        cooldown: this.combat?.attackCooldown ?? 0,
        invulnerable: (this.combat?.invulnerability ?? 0) > 0,
        hit: this.combat?.attackHit ?? false,
        weapon: this.inventory.getEquipment().primary?.itemId ?? '',
        bagCount: this.bagCount(),
        uses:
          this.combat?.getWeaponUsesRemaining(
            this.inventory.getEquipment().primary?.itemId === 'stun-baton'
              ? 'stun-baton'
              : 'training-bat',
          ) ?? null,
      },
      night: {
        enabled: this.night,
        flashlight: this.lighting.enabled && this.lighting.battery > 0,
        battery: this.lighting.battery,
        spareBatteries: this.lighting.spareBatteries,
        flareCount: this.lighting.flareCount,
        aim: this.aim,
        flares: this.lighting.flares.map((f) => ({ ...f })),
      },
    };
  }

  dispose(): void {
    this.unsubscribe();
    this.controller.dispose();
  }

  private reset(): void {
    this.chargingStations = generateChargingStations(this.map, this.random, this.map.chests);
    this.position = { ...this.map.spawn };
    this.facing = 'up';
    this.ground.clear();
    this.search.reset();
    this.clearInteractions();
    this.hurtUntil = 0;
    this.damaged = false;
    this.lighting.reset();
    this.aim = -Math.PI / 2;
    this.combat?.reset();
    this.deadMs.clear();
    this.hugPrompt = undefined;
    this.rewardOrdinal = 0;
    this.prompt = `寻找金色宝箱 · 收集 100 价值后回到${EXTRACTION_NAME}`;
  }
}
