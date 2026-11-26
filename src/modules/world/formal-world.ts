import { CHEST_TIERS } from '../../config/chest-config';
import { RaidHotbar } from '../inventory/raid-hotbar';
import { COMBAT_RULES } from '../../config/combat-config';
import { RULER_EFFECT, type RulerEffectFrame } from '../../config/weapon-effects';
import {
  BANDAGE_HEALING_EFFECT,
  COFFEE_HEALING_EFFECT,
  QUICK_NOTE_EFFECT,
} from '../../config/item-effects';
import { UtilityItemEffects } from './utility-item-effects';
import { ITEM_DEFINITIONS, itemValueFor, RAID_RULES } from '../../config/game-config';
import { activeMap, inExtraction } from '../../config/play-map';
import { facingFromDirection } from '../../campus-3d/animation';
import type { WorldFrame } from '../../campus-3d/world-frame';
import type { EventBus } from '../../shared/events/game-events';
import type {
  InventoryPort,
  ItemInstance,
  Point,
  RaidControllerPort,
} from '../../shared/types/game';
import type { NetworkSession, PlayerSnapshot } from '../network/network-session';
import type { RelicChestSnapshot, RoomCameraSnapshot } from '../network/network-protocol';
import {
  occupiedSlots,
  sectionCanFit,
  type InventoryCapacities,
} from '../inventory/inventory-sections';
import {
  hasCurrentRaidNotebook,
  hasEvidence,
  isQuestComplete,
  prerequisiteHint,
  questChapterById,
  QUEST_CHAPTER_ID,
} from '../quests/quest-service';
import { evidenceStoryBeat, steleStoryBeat } from '../quests/chapter-content';
import { isTouchLayout } from '../ui/mobile-layout';
import type { SoundManager } from '../ui/sound-manager';
import {
  generateChargingStations,
  CHARGING_STATION_RANGE,
  type ChargingStation,
} from './charging-stations';
import { SearchInteraction } from './search-interaction';
import { generateLootSpawns, questSpawnPlan, roundRandom, type LootSpawn } from './loot-spawns';
import { movePlayer } from './movement';
import {
  STORY_APPROACHES,
  STORY_SITES,
  storyDirection,
  storyTriggers,
  type StoryTrigger,
} from './story-triggers';
import { THIRD_CHAPTER } from '../quests/chapter-content';
import {
  NightCombat,
  NightLighting,
  combatWeaponConfig,
  distance,
  isCombatWeaponId,
  lineOfSight,
  findEnemySpawnPosition,
  shouldDropPatrolLoot,
  type Enemy,
} from './night-systems';

export interface KeyPrompt {
  readonly key: 'E' | 'Q';
  readonly label: string;
}
export interface FormalWorldServices {
  displayName?: string;
  skinId?(): string;
  spectating?(): string | null;
  openRelics?(ownerId: string): void;
  controller: RaidControllerPort;
  inventory: InventoryPort;
  inventoryCapacities?: InventoryCapacities;
  questChapter?: () => string | null;
  events: EventBus;
  notify(message: string): void;
  useItem?(instanceId: string): void;
  sound: SoundManager;
  network?: NetworkSession | null;
  onFrame(interaction: string, progress: number, prompt?: KeyPrompt | null): void;
}
export interface WorldInput {
  camera?: RoomCameraSnapshot;
  quickSlot?: number;
  usePressed?: boolean;
  move: Point;
  aim: number;
  interact: boolean;
  attack: boolean;
  hug: boolean;
  flashlight: boolean;
  refill: boolean;
  flare: boolean;
}

/** Production gameplay owns the account's existing controller and inventory. No trial save. */
export class FormalWorld {
  position: Point = { ...activeMap().spawn };
  aim = -Math.PI / 2;
  readonly lighting = new NightLighting();
  readonly hotbar = new RaidHotbar();
  combat = new NightCombat();
  readonly search: SearchInteraction;
  searchPoints: LootSpawn[] = [];
  chargingStations: ChargingStation[] = [];
  readonly ground = new Map<string, { item: ItemInstance; position: Point }>();
  readonly teammates = new Map<
    string,
    {
      id: string;
      name: string;
      position: Point;
      aim: number;
      moving: boolean;
      target: Point;
      skinId?: string;
    }
  >();
  private lastRaidId: string | null = null;
  private networkInputElapsed = 0;
  private previousInteract = false;
  private previousAttack = false;
  private previousLight = false;
  private previousRefill = false;
  private previousFlare = false;
  private moving = false;
  private hurtThisFrame = false;
  private hurtUntil = 0;
  private attackUntil = 0;
  private rulerAttack: (Omit<RulerEffectFrame, 'elapsedMs'> & { startedAt: number }) | null = null;
  private hitStopMs = 0;
  private interaction = '准备好后，开始本次校园探索';
  private keyPrompt: KeyPrompt | null = null;
  private alertAnchor: { id: string; x: number; y: number } | null = null;
  private banner: { text: string; untilMs: number } | null = null;
  private releaseDamage: () => void;
  private readonly releaseItemConsumed: () => void;
  private bandageHealingStartedAt: number | null = null;
  private coffeeHealingStartedAt: number | null = null;
  private quickNoteStartedAt: number | null = null;
  private readonly utilityItemEffects = new UtilityItemEffects();
  private readonly releaseShieldAbsorbed: () => void;
  private readonly discovered = new Set<string>();
  private readonly investigatedSites = new Set<string>();
  private storyCharmEarned = false;
  private detectorTargetId: string | null = null;
  private detectorStartedAt: number | null = null;
  private detectorUntilMs = 0;
  private compassUntilMs = 0;
  private silentCloakUntilMs = 0;
  private silentCloakDetectionMultiplier = 1;

  constructor(
    readonly services: FormalWorldServices,
    private readonly clock = Date.now,
  ) {
    this.search = new SearchInteraction(RAID_RULES.searchDurationMs, clock);
    this.releaseItemConsumed = services.events.on('ItemConsumed', ({ raidId, itemId }) => {
      const view = services.controller.getView();
      if (
        raidId === view.raidId &&
        view.health > 0 &&
        ['active', 'extracting'].includes(view.phase)
      ) {
        if (itemId === 'bandage') this.bandageHealingStartedAt = this.clock();
        else if (itemId === 'morning-coffee') this.coffeeHealingStartedAt = this.clock();
        else if (itemId === 'quick-note-card') this.quickNoteStartedAt = this.clock();
        else if (itemId === 'simple-detector') this.detectorStartedAt = this.clock();
        else this.utilityItemEffects.consume(itemId, this.clock());
      }
    });
    this.releaseShieldAbsorbed = services.events.on('ShieldAbsorbed', ({ raidId, remaining }) => {
      if (raidId === services.controller.getView().raidId) {
        this.utilityItemEffects.shieldAbsorbed(remaining, this.clock());
      }
    });
    this.releaseDamage = services.events.on('DamageTaken', ({ amount, health }) => {
      this.search.cancel();
      this.hurtThisFrame = true;
      this.hurtUntil = this.clock() + 500;
      this.combat.onPlayerDamaged();
      services.sound.play('behit');
      services.notify(`受到 ${amount} 点伤害，当前生命 ${health}；搜索和撤离读条已中断。`);
    });
  }
  private questChapterId() {
    return this.services.questChapter ? this.services.questChapter() : QUEST_CHAPTER_ID;
  }
  clearInteractions(_preserveMouse = false): void {
    // Rendering adapters may keep start-gesture capture while resetting the new raid.
    void _preserveMouse;
    this.search.cancel();
    this.previousInteract =
      this.previousAttack =
      this.previousLight =
      this.previousRefill =
      this.previousFlare =
        false;
    for (const enemy of this.combat.enemies) enemy.hugProgress = 0;
  }
  syncHotbar(): void {
    this.hotbar.sync(
      this.services.controller.getView().raidId,
      this.services.inventory.getCarriedItems(),
      this.services.inventory.getEquipment().primary,
    );
  }
  selectQuickSlot(index: number): void {
    const view = this.services.controller.getView();
    if (this.services.controller.isPaused() || !['active', 'extracting'].includes(view.phase))
      return;
    this.syncHotbar();
    this.hotbar.select(index);
  }
  assignQuickSlot(index: number, instanceId: string): boolean {
    const view = this.services.controller.getView();
    if (this.services.controller.isPaused() || !['active', 'extracting'].includes(view.phase))
      return false;
    this.syncHotbar();
    return this.hotbar.assign(index, instanceId);
  }
  getLightingStatus() {
    return {
      battery: Math.round(this.lighting.battery),
      enabled: this.lighting.enabled,
      spareBatteries: this.lighting.spareBatteries,
      flares: this.lighting.flareCount,
    };
  }
  syncRemotePlayers(players: readonly PlayerSnapshot[]): void {
    const self = this.services.network?.getPlayerId();
    const ids = new Set<string>();
    for (const player of players) {
      if (player.playerId === self) {
        if (this.services.network?.getRoomState()?.started) this.position = { ...player.position };
        continue;
      }
      if (!player.connected || player.finished) continue;
      ids.add(player.playerId);
      const existing = this.teammates.get(player.playerId);
      if (existing) {
        existing.target = { ...player.position };
        existing.aim = player.aim;
        existing.name = player.displayName;
        existing.skinId = player.skinId;
      } else
        this.teammates.set(player.playerId, {
          id: player.playerId,
          name: player.displayName,
          position: { ...player.position },
          target: { ...player.position },
          aim: player.aim,
          moving: false,
          skinId: player.skinId,
        });
    }
    for (const id of this.teammates.keys()) if (!ids.has(id)) this.teammates.delete(id);
  }
  removeRemotePlayer(id: string) {
    this.teammates.delete(id);
  }
  clearRemotePlayers() {
    this.teammates.clear();
  }
  drop(instanceId: string): void {
    if (!['active', 'extracting'].includes(this.services.controller.getView().phase)) return;
    const removed = this.services.inventory.remove(instanceId);
    if (!removed.ok) return;
    this.spawnLoot(removed.value, this.position);
    this.services.notify('物品已放在脚边。按 E 拾回；丢弃和重拾不会累计刷分。');
  }
  private spawnLoot(item: ItemInstance, position: Point): void {
    if (!this.ground.has(item.instanceId))
      this.ground.set(item.instanceId, { item, position: { ...position } });
  }
  private resetRaid(raidId: string | null): void {
    this.lastRaidId = raidId;
    this.rulerAttack = null;
    this.bandageHealingStartedAt = null;
    this.coffeeHealingStartedAt = null;
    this.quickNoteStartedAt = null;
    this.utilityItemEffects.clear();
    this.position = { ...activeMap().spawn };
    this.aim = -Math.PI / 2;
    const round = this.services.network?.getRoomState()?.roundId;
    this.combat = new NightCombat(roundRandom(round ?? raidId ?? 'preparing'));
    this.lighting.reset();
    this.search.reset();
    this.ground.clear();
    this.clearInteractions(true);
    this.discovered.clear();
    this.investigatedSites.clear();
    this.storyCharmEarned = false;
    this.detectorTargetId = null;
    this.detectorStartedAt = null;
    this.detectorUntilMs = 0;
    this.compassUntilMs = 0;
    this.silentCloakUntilMs = 0;
    this.silentCloakDetectionMultiplier = 1;
    if (raidId && this.questChapterId() === 'soothe-monster') {
      const help = activeMap().chapterThreePoints!.help;
      const enemy = this.combat.enemies.find((e) => e.kind === 'hug')!;
      Object.assign(enemy, {
        id: 'story-garden-help',
        position: { x: help.x, y: help.y },
        home: { x: help.x, y: help.y },
        route: [{ x: help.x, y: help.y }],
        waypoint: 0,
      });
    }
    this.hurtUntil = this.attackUntil = this.hitStopMs = 0;
    const chapterId = this.questChapterId();
    const chapter = chapterId === null ? null : questChapterById(chapterId);
    this.searchPoints = raidId
      ? generateLootSpawns(
          roundRandom(round ?? raidId),
          questSpawnPlan(this.questChapterId()),
        ).filter(
          (p) =>
            p.itemId === 'torn-notebook' || !chapter?.evidence.some((e) => e.itemId === p.itemId),
        )
      : [];
    const map = activeMap();
    this.chargingStations = raidId
      ? generateChargingStations(map, roundRandom(`${round ?? raidId}:charging-stations`), [
          // Use all ordinary slots and authored sites, independent of a player's chapter.
          ...generateLootSpawns(roundRandom(round ?? raidId), []),
          ...STORY_SITES,
          ...(map.stone ? [map.stone] : []),
          ...map.lamps,
        ])
      : [];
    this.banner = null;
    const players = this.services.network?.getRoomState()?.players;
    if (players) this.syncRemotePlayers(players);
  }
  tick(deltaMs: number, input: WorldInput): void {
    const controller = this.services.controller;
    const view = controller.getView();
    if (view.raidId !== this.lastRaidId) this.resetRaid(view.raidId);
    this.syncHotbar();
    this.alertAnchor = null;
    this.keyPrompt = null;
    for (const remote of this.teammates.values()) {
      remote.moving = distance(remote.position, remote.target) > 0.5;
      const t = 1 - Math.exp(-deltaMs / 55);
      remote.position = {
        x: remote.position.x + (remote.target.x - remote.position.x) * t,
        y: remote.position.y + (remote.target.y - remote.position.y) * t,
      };
    }
    const playable = !controller.isPaused() && ['active', 'extracting'].includes(view.phase);
    this.moving = false;
    this.hitStopMs = Math.max(0, this.hitStopMs - deltaMs);
    if (playable) {
      if (input.quickSlot !== undefined) this.hotbar.select(input.quickSlot);
      const selected = this.hotbar.selected();
      const weapon =
        selected.item && ITEM_DEFINITIONS[selected.item.itemId]?.kind === 'weapon'
          ? selected.item
          : null;
      if ((input.usePressed ?? (input.attack && !this.previousAttack)) && !weapon) {
        this.search.cancel();
        if (selected.item) this.services.useItem?.(selected.item.instanceId);
        else this.services.notify('当前为空手，请按 1–4 选择道具。');
      }
      const attacking = input.attack && weapon !== null;
      this.aim = input.aim;
      const map = activeMap();
      this.moving = Math.hypot(input.move.x, input.move.y) > 0.1;
      if (this.moving) this.search.cancel();
      this.networkInputElapsed += deltaMs;
      if (this.networkInputElapsed >= 50) {
        this.networkInputElapsed %= 50;
        this.services.network?.sendInput(
          input.move,
          this.aim,
          [
            ...(input.interact ? ['interact' as const] : []),
            ...(attacking ? ['attack' as const] : []),
            ...(input.hug ? ['hug' as const] : []),
          ],
          input.camera,
        );
      }
      if (
        !(this.services.network?.isInRoom() && this.services.network.getRoomState()?.started) &&
        this.hitStopMs <= 0
      ) {
        this.position = movePlayer(
          this.position,
          input.move,
          deltaMs,
          map.playerSpeed * controller.getMoveSpeedMultiplier(),
          map.playerRadius,
          { x: 30, y: 35, width: map.width - 60, height: map.height - 70 },
          map.obstacles,
        );
      }
      this.lighting.tick(deltaMs);
      if (input.flashlight && !this.previousLight) this.lighting.toggle();
      if (input.refill && !this.previousRefill) this.lighting.refill();
      if (input.flare && !this.previousFlare) this.lighting.deploy(this.position);
      if (attacking && this.hitStopMs <= 0) {
        this.search.cancel();
        if (weapon) {
          const weaponId = isCombatWeaponId(weapon.itemId) ? weapon.itemId : 'training-bat';
          const baton = weaponId === 'stun-baton';
          const stats = combatWeaponConfig(weaponId);
          if (
            baton &&
            this.combat.getWeaponUsesRemaining('stun-baton') === 0 &&
            !this.previousAttack
          ) {
            this.services.notify('电击器次数已耗尽，请切换道具。');
          }
          const before = this.combat.attackCooldown;
          const rulerTargets =
            weaponId === 'folding-ruler' && before <= 0
              ? this.combat.enemies.map((enemy) => ({
                  enemy,
                  health: enemy.health,
                  position: { ...enemy.position },
                }))
              : [];
          const dead = this.combat.attack(
            this.position,
            this.aim,
            map.obstacles,
            stats.damage,
            weaponId,
          );
          if (before <= 0 && this.combat.attackCooldown > 0) {
            if (weaponId === 'folding-ruler') {
              this.rulerAttack = {
                startedAt: this.clock(),
                origin: { ...this.position },
                aim: this.aim,
                hits: rulerTargets
                  .filter(
                    ({ enemy, health, position }) =>
                      enemy.health < health &&
                      this.lighting.visible(position, this.position, this.aim, map.obstacles),
                  )
                  .map(({ position }) => position),
              };
            }
            this.attackUntil = this.clock() + COMBAT_RULES.player.attack.swingMs + 140;
            this.services.sound.play('hit');
            if (baton && this.combat.weaponUsesRemaining === 0) {
              this.services.notify('电击器次数已耗尽，请切换道具。');
            }
            if (this.combat.attackHit) this.hitStopMs = COMBAT_RULES.feedback.playerAttackHitStopMs;
          }
          for (const enemy of dead)
            if (view.raidId) {
              this.services.events.emit('EnemyDefeated', {
                raidId: view.raidId,
                enemyId: enemy.id,
              });
              if (enemy.kind === 'patrol' && shouldDropPatrolLoot())
                this.spawnLoot(
                  {
                    instanceId: `${view.raidId}:enemy:${enemy.id}`,
                    itemId: 'school-badge',
                    origin: { kind: 'raid-loot', obtainedInRaidId: view.raidId },
                  },
                  enemy.position,
                );
            }
        }
      }
      const combat = this.combat.update(
        deltaMs,
        this.position,
        this.lighting.enabled,
        input.hug && !input.attack,
        !this.moving,
        map.obstacles,
        { x: 30, y: 35, width: map.width - 60, height: map.height - 70 },
        this.detectionMultiplier(),
        controller.isInvulnerable?.() ?? false,
      );
      this.combat.updateSpawns(deltaMs, () =>
        findEnemySpawnPosition(this.position, this.aim, this.lighting, this.combat.enemies),
      );
      if (combat.amplifierWindups.length > 0) {
        this.services.sound.playAmplifierCharge?.();
      }
      if (combat.soundWaveHit) {
        controller.applySoundWaveEffect?.();
      }
      if (combat.damage) controller.applyDamage(combat.damage);
      if (combat.calmed.length) this.services.notify('抱抱成功，怪物平静约 30 秒。');
      if (this.questChapterId() === 'soothe-monster') {
        const helper = this.combat.enemies.find((e) => e.id === 'story-garden-help');
        if (
          helper &&
          distance(helper.position, this.position) < 145 &&
          lineOfSight(this.position, helper.position, map.obstacles) &&
          !this.discovered.has('garden-sos')
        )
          this.discover(
            'garden-sos',
            THIRD_CHAPTER.steps[0]!.title,
            THIRD_CHAPTER.steps[0]!.stepBody,
          );
        if (helper?.state === 'calmed' && !this.storyCharmEarned && view.raidId) {
          this.storyCharmEarned = true;
          const item: ItemInstance = {
            instanceId: `${view.raidId}:story-soothe-charm`,
            itemId: 'soothe-charm',
            origin: { kind: 'raid-loot', obtainedInRaidId: view.raidId },
          };
          const result = this.services.inventory.addLoot(item);
          if (!result.ok) {
            this.spawnLoot(item, helper.position);
            this.services.notify('安抚成功，护符留在求助者脚边；整理背包后按 E 拾取。');
          } else this.services.notify('求助者平静下来，把仍有余温的护符交给了你。');
        }
      }
      controller.setExtractionPresence(inExtraction(this.position));
      if (!controller.isPaused())
        this.interact(input.interact && !input.attack && !this.hurtThisFrame);
      this.previousInteract = input.interact;
      this.previousAttack = input.attack;
      this.previousLight = input.flashlight;
      this.previousRefill = input.refill;
      this.previousFlare = input.flare;
    } else {
      this.search.cancel();
      this.interaction = controller.isPaused()
        ? '已暂停 · 关闭设置或当前弹窗后继续'
        : '准备好后，开始本次校园探索';
    }
    this.hurtThisFrame = false;
    this.services.sound.setLoop('footsteps', playable && this.moving);
    this.services.sound.setLoop('alarm', playable && view.health > 0 && view.health < 20);
    const liveView = controller.getView();
    this.services.sound.setTinnitus?.(
      playable && (liveView.statusEffects?.tinnitusRemainingMs ?? 0) > 0,
    );
    if (playable && !controller.isPaused()) {
      const site = this.storyMarkers().find(
        (p) =>
          p.status === 'active' &&
          STORY_APPROACHES[p.id] &&
          distance(p, this.position) < 125 &&
          lineOfSight(this.position, p, activeMap().obstacles),
      );
      if (site) this.discover(site.id, site.title, STORY_APPROACHES[site.id]!);
    }
    controller.tick();
    this.services.onFrame(
      this.nearbyHug()
        ? this.interaction
        : this.banner && this.clock() < this.banner.untilMs
          ? this.banner.text
          : this.interaction,
      this.nearbyHug()
        ? this.nearbyHug()!.hugProgress / COMBAT_RULES.hug.calmHoldDurationMs
        : this.search.progress(),
      this.keyPrompt,
    );
  }
  frame(): WorldFrame {
    const map = activeMap();
    const view = this.services.controller.getView();
    const spectatorId = this.services.spectating?.() ?? '';
    const spectator = this.teammates.get(spectatorId);
    const spectatorSnapshot = this.services.network
      ?.getRoomState()
      ?.players.find((player) => player.playerId === spectatorId);
    const visibleFrom = spectator?.position ?? this.position;
    const visibleAim = spectator?.aim ?? this.aim;
    const flashlight = spectator
      ? (spectatorSnapshot?.camera?.flashlight ?? false)
      : this.lighting.enabled && this.lighting.battery > 0;
    const relics = this.services.network?.getRoomState()?.relics ?? [];
    const relicMarkers = relics.map((relic) => ({
      id: `relic-${relic.ownerId}`,
      x: relic.x,
      y: relic.y,
    }));
    const healingElapsedMs =
      this.bandageHealingStartedAt === null
        ? undefined
        : this.clock() - this.bandageHealingStartedAt;
    const coffeeElapsedMs =
      this.coffeeHealingStartedAt === null ? undefined : this.clock() - this.coffeeHealingStartedAt;
    const detectorTarget = this.searchPoints.find(
      (point) => point.id === this.detectorTargetId && !this.search.isOpened(point.id),
    );
    const detectorRemainingMs = this.detectorUntilMs - this.clock();
    const quickNoteElapsedMs =
      this.quickNoteStartedAt === null ? undefined : this.clock() - this.quickNoteStartedAt;
    const quickNoteStatus = this.search.nextDurationState();
    const rulerElapsedMs = this.rulerAttack ? this.clock() - this.rulerAttack.startedAt : -1;
    return {
      rulerEffect:
        this.rulerAttack &&
        rulerElapsedMs >= 0 &&
        rulerElapsedMs < RULER_EFFECT.slashMs &&
        !this.services.controller.isPaused() &&
        ['active', 'extracting'].includes(view.phase)
          ? {
              elapsedMs: rulerElapsedMs,
              origin: this.rulerAttack.origin,
              aim: this.rulerAttack.aim,
              hits: this.rulerAttack.hits,
            }
          : undefined,
      quickNoteEffect:
        quickNoteElapsedMs !== undefined &&
        quickNoteElapsedMs >= 0 &&
        (quickNoteElapsedMs < QUICK_NOTE_EFFECT.durationMs || quickNoteStatus !== undefined) &&
        view.health > 0 &&
        ['active', 'extracting'].includes(view.phase)
          ? { elapsedMs: quickNoteElapsedMs, status: quickNoteStatus }
          : undefined,
      detectorEffect:
        this.detectorStartedAt !== null &&
        detectorTarget &&
        detectorRemainingMs > 0 &&
        view.health > 0 &&
        ['active', 'extracting'].includes(view.phase)
          ? {
              elapsedMs: this.clock() - this.detectorStartedAt,
              remainingMs: detectorRemainingMs,
              target: { x: detectorTarget.x, y: detectorTarget.y },
            }
          : undefined,
      coffeeHealingElapsedMs:
        coffeeElapsedMs !== undefined &&
        coffeeElapsedMs >= 0 &&
        coffeeElapsedMs < COFFEE_HEALING_EFFECT.durationMs &&
        view.health > 0 &&
        ['active', 'extracting'].includes(view.phase)
          ? coffeeElapsedMs
          : undefined,
      utilityEffects:
        view.health > 0 && ['active', 'extracting'].includes(view.phase)
          ? this.utilityItemEffects.frames(this.clock())
          : [],
      bandageHealingElapsedMs:
        healingElapsedMs !== undefined &&
        healingElapsedMs >= 0 &&
        healingElapsedMs < BANDAGE_HEALING_EFFECT.durationMs &&
        view.health > 0 &&
        ['active', 'extracting'].includes(view.phase)
          ? healingElapsedMs
          : undefined,
      chargingStations: this.chargingStations,
      storyMarkers: this.storyMarkers(),
      extraction: {
        ready: view.value >= view.threshold,
        active: view.phase === 'extracting',
        progress: view.extractionProgress,
      },
      position: { ...this.position },
      skinId: this.services.skinId?.(),
      aim: this.aim,
      facing: facingFromDirection({ x: Math.cos(this.aim), y: Math.sin(this.aim) }),
      moving: this.moving,
      action:
        view.health <= 0
          ? 'death'
          : this.clock() < this.hurtUntil
            ? 'hurt'
            : this.clock() < this.attackUntil
              ? 'attack'
              : this.moving
                ? 'walk'
                : 'idle',
      cameraTarget: spectator?.position,
      camera: spectatorSnapshot?.camera,
      hidePlayer:
        view.health <= 0 &&
        relics.some((relic) => relic.ownerId === this.services.network?.getPlayerId()),
      chests: [...this.searchPoints, ...relicMarkers],
      teammates: [...this.teammates.values()],
      opened: this.searchPoints.filter((p) => this.search.isOpened(p.id)).map((p) => p.id),
      ground: [...this.ground.values()],
      prompt: this.interaction,
      searchProgress: this.search.progress(),
      target: this.search.current() ?? this.alertAnchor?.id ?? null,
      visibleChests: [...this.searchPoints, ...relicMarkers]
        .filter(
          (p) =>
            p.id.startsWith('relic-') ||
            (flashlight &&
              this.lighting.inFlashlightCone(p, visibleFrom, visibleAim, map.obstacles)),
        )
        .map((p) => p.id),
      night: {
        enabled: true,
        flashlight,
        battery: this.lighting.battery,
        spareBatteries: this.lighting.spareBatteries,
        flareCount: this.lighting.flareCount,
        aim: visibleAim,
        flares: spectator ? [] : this.lighting.flares,
      },
      combat: {
        enabled: true,
        enemies: this.combat.enemies,
        visibleEnemies: this.combat.enemies
          .filter((e) =>
            spectator
              ? (distance(e.position, visibleFrom) <= 62 &&
                  lineOfSight(visibleFrom, e.position, map.obstacles)) ||
                (flashlight &&
                  this.lighting.inFlashlightCone(
                    e.position,
                    visibleFrom,
                    visibleAim,
                    map.obstacles,
                  ))
              : this.lighting.visible(e.position, this.position, this.aim, map.obstacles),
          )
          .map((e) => e.id),
        soundWaves: this.combat.soundWaves.map((wave) => ({
          ...wave,
          position: { ...wave.position },
        })),
        swing: this.combat.swingMs,
        cooldown: this.combat.attackCooldown,
        invulnerable: this.combat.invulnerability > 0,
        hit: this.combat.attackHit,
        weapon: this.combat.currentWeaponId,
        bagCount: this.services.inventory.getCarriedItems().length,
        uses: this.combat.weaponUsesRemaining,
      },
    };
  }
  dispose(): void {
    this.rulerAttack = null;
    this.services.sound.setTinnitus?.(false);
    this.releaseDamage();
    this.releaseItemConsumed();
    this.releaseShieldAbsorbed();
    this.utilityItemEffects.clear();
    this.bandageHealingStartedAt = null;
    this.coffeeHealingStartedAt = null;
    this.quickNoteStartedAt = null;
    this.detectorStartedAt = null;
    this.detectorTargetId = null;
    this.detectorUntilMs = 0;
    this.teammates.clear();
  }

  activateSearchBoost(reductionMs: number): boolean {
    const phase = this.services.controller.getView().phase;
    if (phase !== 'active' && phase !== 'extracting') return false;
    const duration = Math.max(250, RAID_RULES.searchDurationMs - reductionMs);
    return this.search.setNextDuration(duration);
  }

  activateDetector(durationMs: number): boolean {
    const phase = this.services.controller.getView().phase;
    if (phase !== 'active' && phase !== 'extracting') return false;
    const now = this.clock();
    if (this.detectorTargetId !== null && now < this.detectorUntilMs) return false;
    const target = this.searchPoints
      .filter((point) => !this.search.isOpened(point.id))
      .sort((a, b) => distance(this.position, a) - distance(this.position, b))[0];
    if (!target || !Number.isFinite(durationMs) || durationMs <= 0) return false;
    this.detectorTargetId = target.id;
    this.detectorUntilMs = now + durationMs;
    return true;
  }

  activateCompass(durationMs: number): boolean {
    const phase = this.services.controller.getView().phase;
    if (phase !== 'active' && phase !== 'extracting') return false;
    const now = this.clock();
    if (now < this.compassUntilMs) return false;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
    this.compassUntilMs = now + durationMs;
    return true;
  }

  activateSilentCloak(durationMs: number, detectionMultiplier: number): boolean {
    const phase = this.services.controller.getView().phase;
    if (phase !== 'active' && phase !== 'extracting') return false;
    const now = this.clock();
    if (now < this.silentCloakUntilMs) return false;
    if (
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      !Number.isFinite(detectionMultiplier) ||
      detectionMultiplier <= 0
    ) {
      return false;
    }
    this.silentCloakUntilMs = now + durationMs;
    this.silentCloakDetectionMultiplier = detectionMultiplier;
    return true;
  }

  activateReflectiveFilter(multiplier: number): boolean {
    const phase = this.services.controller.getView().phase;
    if (phase !== 'active' && phase !== 'extracting') return false;
    return this.lighting.setFlashlightRangeMultiplier(multiplier);
  }

  private detectionMultiplier(): number {
    if (this.clock() >= this.silentCloakUntilMs) {
      this.silentCloakDetectionMultiplier = 1;
      return 1;
    }
    return this.silentCloakDetectionMultiplier;
  }
  private nearbyHug(): Enemy | undefined {
    const hug = this.requestingHug();
    return hug && distance(hug.position, this.position) < COMBAT_RULES.hug.calmRange
      ? hug
      : undefined;
  }
  private discover(locationId: string, title: string, text: string): void {
    const raidId = this.services.controller.getView().raidId;
    const chapterId = this.questChapterId();
    if (!raidId || chapterId === null || this.discovered.has(locationId)) return;
    this.discovered.add(locationId);
    this.services.events.emit('StoryDiscovered', {
      raidId,
      locationId,
      chapterId,
      title,
      text,
    });
  }

  storyMarkers(): StoryTrigger[] {
    const view = this.services.controller.getView();
    return storyTriggers(
      this.questChapterId(),
      this.services.inventory.getCarriedItems(),
      view.raidId,
    ).map((marker) => {
      const helper =
        marker.kind === 'help' && this.combat.enemies.find((e) => e.id === 'story-garden-help');
      return helper && helper.state !== 'dead' ? { ...marker, ...helper.position } : marker;
    });
  }

  storyObjective(): { title: string; hint: string } {
    const chapterId = this.questChapterId();
    if (chapterId === null)
      return { title: '自由探索', hint: '全部剧情已完成，搜集物资并安全撤离' };
    const markers = this.storyMarkers();
    const target = markers.find((p) => p.status === 'active');
    if (!target) return { title: '思源记录册', hint: '开始探索，寻找校园中的剧情线索' };
    const chapter = questChapterById(chapterId);
    const evidence = chapter.evidence.find(
      (e) => !hasEvidence(this.services.inventory.getCarriedItems(), e.itemId, this.lastRaidId),
    );
    const dropped =
      evidence &&
      [...this.ground.values()].find(
        (d) =>
          d.item.itemId === evidence.itemId &&
          d.item.origin.kind === 'raid-loot' &&
          d.item.origin.obtainedInRaidId === this.lastRaidId,
      );
    const point = dropped?.position ?? target;
    return {
      title: dropped ? `拾回${evidence.label}` : target.title,
      hint: `${storyDirection(this.position, point)} · ${Math.round(distance(this.position, point) / 32)} 米 · ${dropped ? '按 E 拾回证据' : target.action}`,
    };
  }

  private storyInteraction(held: boolean): boolean {
    const view = this.services.controller.getView();
    const items = this.services.inventory.getCarriedItems();
    const markers = this.storyMarkers();
    const near = markers
      .filter(
        (p) =>
          p.kind !== 'exit' &&
          distance(p, this.position) < 85 &&
          lineOfSight(this.position, p, activeMap().obstacles),
      )
      .sort((a, b) => distance(a, this.position) - distance(b, this.position))[0];
    if (!near || near.kind === 'chest' || near.kind === 'stele') return false;
    if (near.status === 'inactive') {
      this.interaction = `${near.title} · 线索会在对应章节开启`;
      return true;
    }
    if (near.kind === 'help') {
      const helper = this.combat.enemies.find((e) => e.id === 'story-garden-help');
      if (
        helper &&
        !this.storyCharmEarned &&
        (helper.mutated || helper.state === 'dead' || helper.state === 'mutation-warning')
      ) {
        this.interaction = '求助信号中断 · 停住按 E 再次呼唤求助者';
        this.keyPrompt = { key: 'E', label: '再次呼唤' };
        if (held && !this.previousInteract && !this.moving) {
          const point = activeMap().chapterThreePoints!.help;
          Object.assign(helper, {
            position: { x: point.x, y: point.y },
            state: 'patrol',
            health: COMBAT_RULES.hug.health,
            timer: 0,
            cooldown: 0,
            hugProgress: 0,
            calmHitCount: 0,
            mutated: false,
          });
          this.services.notify('求助者重新回应了你。靠近并停住，长按 Q 安抚。');
        }
        return true;
      }
      this.interaction =
        near.status === 'done'
          ? '芳华园求助者 · 已安抚，前往中心广场记录台'
          : '芳华园求助者 · 靠近并停住，长按 Q 安抚';
      return true;
    }
    this.search.cancel();
    this.interaction = `${near.title} · ${near.status === 'done' ? '本局已调查' : near.status === 'locked' ? `先取得本局${questChapterById(near.chapterId).evidence[0].label}` : near.action}`;
    if (near.status === 'done') return true;
    if (this.investigatedSites.has(near.id)) {
      this.interaction = `${near.title} · 已取走证据，请拾回丢下的证据`;
      return true;
    }
    this.keyPrompt = { key: 'E', label: near.status === 'locked' ? '查看线索' : '调查' };
    if (!held || this.previousInteract || this.moving) return true;
    if (near.status === 'locked') {
      this.discover(`${near.id}:locked`, `${near.title} · 缺少线索`, this.interaction);
      return true;
    }
    const itemId =
      near.kind === 'board'
        ? 'marked-campus-map'
        : near.kind === 'door'
          ? 'siyuan-key'
          : 'complete-record';
    const item: ItemInstance = {
      instanceId: `${view.raidId}:${near.id}`,
      itemId,
      origin: { kind: 'raid-loot', obtainedInRaidId: view.raidId! },
    };
    const fits = this.services.inventoryCapacities
      ? sectionCanFit(items, item, ITEM_DEFINITIONS, this.services.inventoryCapacities)
      : occupiedSlots(items, ITEM_DEFINITIONS) < RAID_RULES.bagCapacity;
    if (!fits) {
      this.services.notify('背包已满，请先腾出空间再调查。');
      return true;
    }
    if (this.services.inventory.addLoot(item).ok) {
      this.investigatedSites.add(near.id);
      this.services.events.emit('LocationInteracted', {
        raidId: view.raidId!,
        locationId: near.id,
      });
      this.services.sound.play('pick');
    }
    return true;
  }

  private requestingHug(): Enemy | undefined {
    return this.combat.enemies
      .filter(
        (enemy) =>
          enemy.kind === 'hug' &&
          enemy.state === 'request' &&
          distance(enemy.position, this.position) <= COMBAT_RULES.hug.loseTargetRange &&
          lineOfSight(this.position, enemy.position, activeMap().obstacles),
      )
      .sort((a, b) => distance(a.position, this.position) - distance(b.position, this.position))[0];
  }

  private hugInstruction(hug: Enemy): string {
    const action = isTouchLayout() ? '长按抱抱按钮' : '长按 Q';
    const inRange = distance(hug.position, this.position) < COMBAT_RULES.hug.calmRange;
    const instruction = inRange
      ? `${this.moving ? '停住后' : ''}${action}安抚抱抱怪`
      : '靠近抱抱怪，再停住长按抱抱';
    return `${instruction} · 剩余 ${Math.ceil(hug.timer / 1000)} 秒 · 抱满 1.5 秒平静约 30 秒`;
  }

  private interact(held: boolean): void {
    const view = this.services.controller.getView();
    if (view.phase !== 'active' && view.phase !== 'extracting') {
      this.search.cancel();
      return;
    }
    const relic = this.nearbyRelic();
    if (relic) {
      this.search.cancel();
      this.keyPrompt = { key: 'E', label: '遗物箱' };
      this.interaction = '打开队友遗物箱';
      if (held && !this.previousInteract) this.services.openRelics?.(relic.ownerId);
      return;
    }
    const carried = this.services.inventory.getCarriedItems();
    const equippedIds = new Set(
      Object.values(this.services.inventory.getEquipment()).map((item) => item.instanceId),
    );
    const chapterId = this.questChapterId();
    const chapter = chapterId === null ? null : questChapterById(chapterId);
    const bagFull = this.services.inventoryCapacities
      ? occupiedSlots(carried, ITEM_DEFINITIONS, 'bag') >= this.services.inventoryCapacities.bag
      : carried.filter((item) => !equippedIds.has(item.instanceId)).length >=
        RAID_RULES.bagCapacity;
    const hug = this.nearbyHug();
    if (hug) {
      this.search.cancel();
      this.interaction = this.hugInstruction(hug);
      this.keyPrompt = { key: 'Q', label: '安抚' };
      return;
    }
    const loot = [...this.ground.values()]
      .filter(
        (drop) =>
          distance(drop.position, this.position) < 70 &&
          lineOfSight(this.position, drop.position, activeMap().obstacles),
      )
      .sort((a, b) => distance(a.position, this.position) - distance(b.position, this.position))[0];
    if (loot) {
      this.search.cancel();
      const lootFits = this.services.inventoryCapacities
        ? sectionCanFit(carried, loot.item, ITEM_DEFINITIONS, this.services.inventoryCapacities)
        : occupiedSlots(carried, ITEM_DEFINITIONS) +
            (ITEM_DEFINITIONS[loot.item.itemId]?.bagSlots ?? 1) <=
          RAID_RULES.bagCapacity;
      if (!lootFits) {
        const sectionName =
          loot.item.origin.kind === 'carry-in' && this.services.inventoryCapacities
            ? '道具栏'
            : '背包';
        this.interaction = `${sectionName}已满 · ${ITEM_DEFINITIONS[loot.item.itemId]?.name ?? loot.item.itemId}留在地上，先腾出空间再拾取`;
        return;
      }
      this.interaction = `按 E 拾取：${ITEM_DEFINITIONS[loot.item.itemId]?.name ?? loot.item.itemId}`;
      this.keyPrompt = { key: 'E', label: '拾取' };
      if (held && !this.previousInteract) {
        // Carry-in drops retain provenance: only the inventory transfer method may reinsert them.
        const result = this.services.inventory.addLoot(loot.item);
        if (result.ok) {
          this.services.sound.play('pick');
          this.ground.delete(loot.item.instanceId);
          this.banner = {
            text: `已拾回：${ITEM_DEFINITIONS[loot.item.itemId]?.name ?? loot.item.itemId}`,
            untilMs: this.clock() + 2600,
          };
        }
        this.services.notify(result.ok ? '已拾回物品。' : '背包已满或来源无效，请先腾出空间。');
      }
      return;
    }
    if (this.storyInteraction(held)) return;
    const chest = this.searchPoints.find(
      (point) =>
        !this.search.isOpened(point.id) &&
        distance(point, this.position) < 60 &&
        this.lighting.flashlightReveals(point, this.position, this.aim, activeMap().obstacles),
    );
    if (chest) {
      this.alertAnchor = { id: chest.id, x: chest.x, y: chest.y };
      const prerequisite = prerequisiteHint(chest.itemId, carried, view.raidId, chapterId);
      if (prerequisite !== null) {
        this.search.cancel();
        this.interaction = prerequisite;
        return;
      }
      // 满包时不启动搜索进度：否则每次 2 秒读条失败重来，玩家只看得到进度条循环。
      if (bagFull) {
        this.search.cancel();
        this.interaction = '背包已满 · 先丢弃或替换物品再搜索';
        if (held && !this.previousInteract) {
          this.services.notify('背包已满，搜索点保留在原地；丢弃或替换物品后可以重新搜索。');
        }
        return;
      }
      this.interaction =
        chest.id === activeMap().questChest?.id
          ? '思源楼前手记宝箱 · 长按 E 搜索'
          : `${CHEST_TIERS[chest.tier ?? 'normal'].name} · 长按 E 搜索 ${CHEST_TIERS[chest.tier ?? 'normal'].durationMs / 1000} 秒`;
      this.keyPrompt = { key: 'E', label: '搜索' };
      if (!held || this.moving || view.phase !== 'active') {
        this.search.cancel();
        return;
      }
      const wasSearching = this.search.current() === chest.id;
      this.search.begin(chest.id, CHEST_TIERS[chest.tier ?? 'normal'].durationMs);
      if (!wasSearching) {
        this.services.sound.play('box');
      }
      if (this.search.progress() >= 1 && view.raidId) {
        const item: ItemInstance = {
          instanceId: `${view.raidId}:${chest.id}`,
          itemId: chest.itemId,
          origin: { kind: 'raid-loot', obtainedInRaidId: view.raidId },
        };
        const result = this.search.finish(item, (entry) => this.services.inventory.addLoot(entry));
        if (result.ok) {
          this.services.events.emit('LocationInteracted', {
            raidId: view.raidId,
            locationId: chest.id,
          });
          // RaidController derives questComplete from the authoritative raid state.
        }
        if (result.ok) {
          const definition = ITEM_DEFINITIONS[chest.itemId];
          const beat = isQuestComplete(
            this.services.inventory.getCarriedItems(),
            view.raidId,
            chapterId,
            view.steleInvestigated,
          )
            ? chapter?.completeHint
            : evidenceStoryBeat(chest.itemId);
          const pickup =
            beat ??
            `已拾取：${definition?.name ?? chest.itemId}${
              definition && itemValueFor(definition) !== null
                ? `（本局价值 ${itemValueFor(definition)}）`
                : ''
            }`;
          this.banner = { text: pickup, untilMs: this.clock() + (beat === null ? 3200 : 6000) };
          this.services.notify('搜索完成，物资进入本局背包。');
        } else {
          this.banner = {
            text: '背包已满 · 先丢弃或替换物品再搜索',
            untilMs: this.clock() + 3200,
          };
          this.services.notify('背包已满，搜索点已保留；丢弃或替换物品后可以重新搜索。');
        }
      }
      return;
    }
    const stele = activeMap().stone;
    if (chapter?.id === QUEST_CHAPTER_ID && stele) {
      const steleDistance = distance(stele, this.position);
      if (steleDistance < 78 && lineOfSight(this.position, stele, activeMap().obstacles)) {
        this.search.cancel();
        if (!hasCurrentRaidNotebook(carried, view.raidId)) {
          this.interaction = '明湖石碑 · 先取得本局残缺手记';
          this.keyPrompt = { key: 'E', label: '查看石碑' };
          if (held && !this.previousInteract && !this.moving)
            this.discover(
              'minghu-stele:locked',
              '明湖石碑 · 模糊的刻痕',
              '石碑背面有一处浅刻痕，手电照过时像有字浮现。你还读不懂它——先到思源楼前寻找残缺手记，再回来调查。',
            );
          return;
        }
        if (view.steleInvestigated) {
          this.interaction = '明湖石碑 · 已调查';
          return;
        }
        if (bagFull) {
          this.interaction = '背包已满 · 调查后无法收取异常羽毛';
          return;
        }
        this.interaction = '按 E 调查明湖石碑';
        this.keyPrompt = { key: 'E', label: '调查' };
        if (
          held &&
          !this.previousInteract &&
          !this.moving &&
          view.phase === 'active' &&
          view.raidId
        ) {
          if (this.services.controller.investigateStele()) {
            const feather = this.services.inventory.addLoot({
              instanceId: `${view.raidId}:anomalous-feather`,
              itemId: 'anomalous-feather',
              origin: { kind: 'raid-loot', obtainedInRaidId: view.raidId },
            });
            if (!feather.ok) {
              this.services.notify('背包已满或羽毛已存在，请先整理背包。');
              return;
            }
            this.services.events.emit('SteleInvestigated', { raidId: view.raidId });
            this.banner = { text: steleStoryBeat(), untilMs: this.clock() + 6000 };
            this.services.notify('明湖石碑调查完成。');
          }
        }
        return;
      }
    }
    if (view.inExtractionZone) {
      this.search.cancel();
      this.interaction =
        view.phase === 'extracting'
          ? '正在撤离 · 请留在区域内'
          : view.value >= view.threshold
            ? '按 E 开始撤离 · 保持 5 秒'
            : `撤离未解锁 · 还差 ${view.threshold - view.value} 价值`;
      if (held && !this.previousInteract && view.phase === 'active') {
        const result = this.services.controller.startExtraction();
        if (result.ok) {
          this.services.sound.play('home');
        }
        if (!result.ok) {
          this.services.notify('本局携带价值不足，先搜索物资再回来。');
        }
      }
    } else {
      const station = this.chargingStations.find(
        (source) =>
          distance(source, this.position) < CHARGING_STATION_RANGE &&
          lineOfSight(this.position, source, activeMap().obstacles),
      );
      if (station && this.lighting.battery < 99) {
        this.interaction = '停下脚步 · 长按 E 充电 2 秒';
        this.keyPrompt = { key: 'E', label: '充电' };
        if (held && !this.moving && !this.hurtThisFrame) {
          this.search.begin(`charge:${station.id}`, false);
          if (this.search.progress() >= 1) {
            this.lighting.charge();
            this.search.cancel();
            this.services.notify('手电筒已充满。');
          }
        } else {
          this.search.cancel();
        }
      } else {
        this.search.cancel();
        const request = this.requestingHug();
        this.interaction = station
          ? '充电桩 · 手电筒电量已满'
          : request
            ? this.hugInstruction(request)
            : '校园夜巡';
      }
    }
  }

  nearbyRelic(): RelicChestSnapshot | undefined {
    return this.services.network
      ?.getRoomState()
      ?.relics?.find(
        (relic) =>
          distance(relic, this.position) < 60 &&
          lineOfSight(this.position, relic, activeMap().obstacles),
      );
  }
}
