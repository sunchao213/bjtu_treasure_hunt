import { CHEST_TIERS } from '../config/chest-config';
import {
  occupiedSlots,
  sectionCanFit,
  type InventoryCapacities,
} from '../modules/inventory/inventory-sections';
import { isTouchLayout } from '../modules/ui/mobile-layout';
import { createTypingGuard, isFormFocused } from '../modules/ui/typing-guard';
import { assetUrl } from '../app/asset-url';
import Phaser from 'phaser';
import { CAMPUS_FOREGROUND, foregroundOpacity } from '../modules/world/campus-foreground';
import { COMBAT_RULES } from '../config/combat-config';
import {
  MONSTER_ANIMATIONS,
  MONSTER_SPRITE_SHEETS,
  monsterAnimationFor,
  monsterScaleFor,
  monsterConcealed,
  monsterOpacityFor,
} from '../config/monster-sprites';
import { generateLootSpawns, questSpawnPlan, type LootSpawn } from '../modules/world/loot-spawns';
import {
  activeMap,
  beginRaidMap,
  inExtraction,
  previewUpcomingMap,
  useCampusMap,
} from '../config/play-map';
import { IMAGE_ASSETS, SPRITE_SHEETS } from '../config/game-assets';
import { WORLD } from '../config/world-config';
import { ITEM_DEFINITIONS, itemValueFor, RAID_RULES } from '../config/game-config';
import { movePlayer } from '../modules/world/movement';
import { SearchInteraction } from '../modules/world/search-interaction';
import {
  NightCombat,
  NightLighting,
  type Enemy,
  type EnemyState,
  angleBetween,
  combatWeaponConfig,
  distance,
  enemyMaxHealth,
  findEnemySpawnPosition,
  isCombatWeaponId,
  lineOfSight,
  shouldDropPatrolLoot,
} from '../modules/world/night-systems';
import { renderDarkness } from '../modules/world/night-renderer';
import {
  clearExploredMap,
  createExploredMap,
  drawCampusOverview,
  revealExploredArea,
} from '../modules/world/campus-overview';
import type { EventBus } from '../shared/events/game-events';
import type { InventoryPort, ItemInstance, Point, RaidControllerPort } from '../shared/types/game';
import type { GameSnapshot, PlayerInput, RemotePlayerSnapshot } from '../shared/net/protocol';
import type { TouchControls } from '../modules/world/touch-controls';
import type { SoundManager } from '../modules/ui/sound-manager';
import type { NetworkSession, PlayerSnapshot } from '../modules/network/network-session';
import { RoomLootSearch } from '../modules/network/room-loot-search';
import type { RoomChestSnapshot } from '../modules/network/network-protocol';
import {
  isQuestComplete,
  hasCurrentRaidNotebook,
  prerequisiteHint,
  questChapterById,
  QUEST_CHAPTER_ID,
} from '../modules/quests/quest-service';
import { evidenceStoryBeat, steleStoryBeat } from '../modules/quests/chapter-content';
import {
  ENTITY_DEPTH_BASE,
  NIGHT_MASK_DEPTH,
  PLAY_ALERT_DEPTH,
} from '../modules/world/play-alerts';

export interface KeyPrompt {
  readonly key: 'E' | 'Q';
  readonly label: string;
}

interface SceneServices {
  displayName?: string;
  controller: RaidControllerPort;
  inventory: InventoryPort;
  inventoryCapacities?: InventoryCapacities;
  /** 当前进行中的章节 id，由大厅按存档实时给出（章节推进后下一局自动换章）。 */
  questChapter?: () => string | null;
  events: EventBus;
  notify: (message: string) => void;
  touch: TouchControls;
  sound: SoundManager;
  network?: NetworkSession | null;
  onFrame: (interaction: string, progress: number, prompt?: KeyPrompt | null) => void;
  onReady?: () => void;
  onLoadError?: (message: string) => void;
  onInput?: (input: PlayerInput) => void;
  isOnline?: () => boolean;
}

const EFFECTS_DEPTH = 4100;

type CampusBuilding = {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  sub: string;
  color: number;
};
type PlayerDirection = 'up' | 'down' | 'left' | 'right';
type PlayerAction = 'none' | 'attack' | 'hurt' | 'death';

const DEFAULT_BUILDING_PALETTE = {
  roof: 0x8f786d,
  wall: 0xb79e86,
  facade: 0x765e53,
  accent: 0xe2c09a,
} as const;

const BUILDING_PALETTES: Readonly<
  Record<
    string,
    {
      roof: number;
      wall: number;
      facade: number;
      accent: number;
    }
  >
> = {
  TEACHING: { roof: 0x9a7662, wall: 0xb99679, facade: 0x8d604f, accent: 0xe2c09a },
  DORM: { roof: 0x7b7f67, wall: 0xb4b18c, facade: 0x77795e, accent: 0xe1d19c },
  CANTEEN: { roof: 0x966d56, wall: 0xc19a73, facade: 0x875640, accent: 0xf0d39b },
  SIYUAN: { roof: 0x71838b, wall: 0xaabac0, facade: 0x5c707a, accent: 0xd9e4dd },
  LIBRARY: { roof: 0x71878c, wall: 0xb6c5c9, facade: 0x5c7077, accent: 0xe0e8df },
};

/**
 * 局内按键：注册时开启 capture，防止空格与方向键滚动页面；
 * 焦点进入输入框时由 typing-guard 临时放开 capture，让聊天能正常输入。
 */
const GAME_KEYS = [
  'W',
  'A',
  'S',
  'D',
  'E',
  'Q',
  'L',
  'R',
  'G',
  'SPACE',
  'UP',
  'DOWN',
  'LEFT',
  'RIGHT',
] as const;

export class WorldScene extends Phaser.Scene {
  private position: Point = { ...activeMap().spawn };
  private typingGuardDispose?: () => void;
  private player?: Phaser.GameObjects.Container;
  private playerSprite?: Phaser.GameObjects.Sprite;
  private playerFacing: PlayerDirection = 'down';
  private playerAnimationKey = '';
  private playerAction: PlayerAction = 'none';
  private playerActionMs = 0;
  private aura?: Phaser.GameObjects.Arc;
  private searchPoints: LootSpawn[] = [];
  private darknessImage?: Phaser.GameObjects.Image;
  private darkness?: Phaser.Textures.CanvasTexture;
  private flashlight?: Phaser.GameObjects.Graphics;
  private extractionMarkers: Phaser.GameObjects.Rectangle[] = [];
  private groundImage?: Phaser.GameObjects.Image;
  private steleImage?: Phaser.GameObjects.Image;
  private dressing: Phaser.GameObjects.Image[] = [];
  private lampMarkers: Phaser.GameObjects.Rectangle[] = [];
  private search = new SearchInteraction(RAID_RULES.searchDurationMs);
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private readonly chestObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly chestSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly foregroundObjects: {
    object: Phaser.GameObjects.Image;
    layer: (typeof CAMPUS_FOREGROUND)[number];
  }[] = [];
  private readonly enemyObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly enemyVisualStates = new Map<string, EnemyState>();
  private readonly enemyAnimationKeys = new Map<string, string>();
  private readonly enemyDeathFinished = new Set<string>();
  private readonly enemyMutatedStates = new Map<string, boolean>();
  private readonly enemyLastPositions = new Map<string, Point>();
  private readonly soundWaveSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly remotePlayerObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly remotePlayerTargets = new Map<string, RemotePlayerSnapshot>();
  private onlineSnapshot: GameSnapshot | null = null;
  private readonly ground = new Map<
    string,
    { item: ItemInstance; position: Point; sprite: Phaser.GameObjects.Container }
  >();
  private readonly remotePlayers = new Map<
    string,
    { target: Point; aim: number; object: Phaser.GameObjects.Container }
  >();
  private readonly nameplates = new Map<
    Phaser.GameObjects.Container,
    { text: Phaser.GameObjects.Text; offsetY: number }
  >();
  private networkInputElapsed = 0;
  private roomRoundId: string | null = null;
  private roomLootSearch?: RoomLootSearch;
  private lastRaidId: string | null = null;
  private previousInteract = false;
  private previousAttack = false;
  private previousFlare = false;
  private previousLight = false;
  private previousRefill = false;
  private readonly lighting = new NightLighting();
  private readonly combat = new NightCombat();
  private exploredMap = createExploredMap();
  private aim = -Math.PI / 2;
  private moving = false;
  private hurtThisFrame = false;
  private hurtFeedbackMs = 0;
  private attackFeedbackMs = 0;
  private hitStopMs = 0;
  private lastNightDraw = -Infinity;
  private readonly bounds = {
    x: 30,
    y: 35,
    width: activeMap().width - 60,
    height: activeMap().height - 70,
  };
  private interaction = '在准备页确认风险后开始探索';
  private keyPrompt: KeyPrompt | null = null;
  private releaseDamage?: () => void;
  /** 交互条上的临时反馈：拾取结果、剧情提示等，在有效期内优先于常规提示显示。 */
  private banner: { text: string; untilMs: number } | null = null;
  private startupFailed = false;
  private alerts?: Phaser.GameObjects.Graphics;
  private searchAlert?: Phaser.GameObjects.Text;
  private alertAnchor: { id: string; x: number; y: number } | null = null;
  private detectorTargetId: string | null = null;
  private detectorUntilMs = 0;
  private compassUntilMs = 0;
  private silentCloakUntilMs = 0;
  private silentCloakDetectionMultiplier = 1;
  private readonly warningLabels = new Map<string, Phaser.GameObjects.Text>();

  constructor(private readonly services: SceneServices) {
    super('world');
  }

  /** 当前章节 id；未接线时退回第一章，保证单测与旧调用方行为不变。 */
  private questChapterId(): string | null {
    return this.services.questChapter ? this.services.questChapter() : QUEST_CHAPTER_ID;
  }

  preload(): void {
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      this.startupFailed = true;
      this.services.onLoadError?.(`素材缺失：${file.key}`);
    });
    for (const [key, path] of Object.entries(IMAGE_ASSETS)) {
      this.load.image(key, assetUrl(path));
    }
    for (const sheet of SPRITE_SHEETS) {
      this.load.spritesheet(sheet.key, assetUrl(sheet.path), {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight,
      });
    }
  }

  getLightingStatus(): Readonly<{
    battery: number;
    enabled: boolean;
    spareBatteries: number;
    flares: number;
  }> {
    return {
      battery: Math.round(this.lighting.battery),
      enabled: this.lighting.enabled,
      spareBatteries: this.lighting.spareBatteries,
      flares: this.lighting.flareCount,
    };
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
    if (this.detectorTargetId !== null && this.time.now < this.detectorUntilMs) return false;
    const target = this.searchPoints
      .filter((point) => !this.search.isOpened(point.id))
      .sort((a, b) => distance(this.position, a) - distance(this.position, b))[0];
    if (!target || !Number.isFinite(durationMs) || durationMs <= 0) return false;
    this.detectorTargetId = target.id;
    this.detectorUntilMs = this.time.now + durationMs;
    return true;
  }

  activateCompass(durationMs: number): boolean {
    const phase = this.services.controller.getView().phase;
    if (phase !== 'active' && phase !== 'extracting') return false;
    if (this.time.now < this.compassUntilMs) return false;
    if (!this.compassQuestTarget() && !this.extractionTarget()) return false;
    if (!Number.isFinite(durationMs) || durationMs <= 0) return false;
    this.compassUntilMs = this.time.now + durationMs;
    return true;
  }

  activateSilentCloak(durationMs: number, detectionMultiplier: number): boolean {
    const phase = this.services.controller.getView().phase;
    if (phase !== 'active' && phase !== 'extracting') return false;
    if (this.time.now < this.silentCloakUntilMs) return false;
    if (
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      !Number.isFinite(detectionMultiplier) ||
      detectionMultiplier <= 0
    ) {
      return false;
    }
    this.silentCloakUntilMs = this.time.now + durationMs;
    this.silentCloakDetectionMultiplier = detectionMultiplier;
    return true;
  }

  activateReflectiveFilter(multiplier: number): boolean {
    const phase = this.services.controller.getView().phase;
    if (phase !== 'active' && phase !== 'extracting') return false;
    return this.lighting.setFlashlightRangeMultiplier(multiplier);
  }

  private detectionMultiplier(): number {
    if (this.time.now >= this.silentCloakUntilMs) {
      this.silentCloakDetectionMultiplier = 1;
      return 1;
    }
    return this.silentCloakDetectionMultiplier;
  }

  private hasCurrentQuestEvidence(itemId: string): boolean {
    const raidId = this.services.controller.getView().raidId;
    return this.services.inventory
      .getCarriedItems()
      .some(
        (item) =>
          item.itemId === itemId &&
          item.origin.kind === 'raid-loot' &&
          item.origin.obtainedInRaidId === raidId,
      );
  }

  private compassQuestTarget(): Point | null {
    const view = this.services.controller.getView();
    const chapterId = this.questChapterId();
    if (chapterId === null) return null;
    const pending = questChapterById(chapterId).evidence.find(
      (entry) => !this.hasCurrentQuestEvidence(entry.itemId),
    );
    if (!pending) return null;
    if (pending.itemId === 'anomalous-feather' && view.steleInvestigated) return null;
    const stone = activeMap().stone;
    if (pending.itemId === 'anomalous-feather' && stone) {
      return { ...stone };
    }
    const target = this.searchPoints.find(
      (point) => point.itemId === pending.itemId && !this.search.isOpened(point.id),
    );
    return target ? { x: target.x, y: target.y } : null;
  }

  private extractionTarget(): Point | null {
    const zone = activeMap().extractions[0];
    return zone ? { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2 } : null;
  }

  clearInteractions(): void {
    this.cancelSearch();
    this.services.touch.reset();
    this.input?.keyboard?.resetKeys();
    for (const enemy of this.combat.enemies) {
      enemy.hugProgress = 0;
    }
  }

  syncRemotePlayers(players: readonly PlayerSnapshot[]): void {
    const localId = this.services.network?.getPlayerId();
    const received = new Set<string>();
    for (const snapshot of players) {
      if (snapshot.playerId === localId) {
        if (this.services.network?.getRoomState()?.started)
          this.position = { ...snapshot.position };
        continue;
      }
      if (!snapshot.connected) continue;
      received.add(snapshot.playerId);
      const existing = this.remotePlayers.get(snapshot.playerId);
      if (existing) {
        existing.target = { ...snapshot.position };
        existing.aim = snapshot.aim;
        this.nameplates.get(existing.object)?.text.setText(snapshot.displayName.slice(0, 18));
        continue;
      }
      const sprite = this.createPlayerSprite();
      sprite.anims.play(`player-idle-${this.directionFromAngle(snapshot.aim)}`);
      const marker = this.add
        .container(snapshot.position.x, snapshot.position.y, [
          this.add.ellipse(0, 10, 25, 9, 0x061f23, 0.35),
          sprite,
        ])
        .setName(`remote-player-${snapshot.playerId}`)
        .setDepth(this.entityDepth(snapshot.position.y));
      this.createNameplate(snapshot.displayName, marker, -sprite.displayHeight - 6);
      this.remotePlayers.set(snapshot.playerId, {
        target: { ...snapshot.position },
        aim: snapshot.aim,
        object: marker,
      });
    }
    for (const [playerId, remote] of this.remotePlayers) {
      if (received.has(playerId)) continue;
      remote.object.destroy();
      this.remotePlayers.delete(playerId);
    }
  }

  removeRemotePlayer(playerId: string): void {
    const remote = this.remotePlayers.get(playerId);
    remote?.object.destroy();
    this.remotePlayers.delete(playerId);
  }

  clearRemotePlayers(): void {
    for (const remote of this.remotePlayers.values()) remote.object.destroy();
    this.remotePlayers.clear();
  }

  setRemotePlayers(players: readonly RemotePlayerSnapshot[]): void {
    const ids = new Set(players.map((player) => player.playerId));
    for (const [playerId, object] of this.remotePlayerObjects) {
      if (!ids.has(playerId)) {
        object.destroy();
        this.remotePlayerObjects.delete(playerId);
      }
    }
    this.remotePlayerTargets.clear();
    for (const player of players) {
      this.remotePlayerTargets.set(player.playerId, structuredClone(player));
      let object = this.remotePlayerObjects.get(player.playerId);
      if (!object) {
        object = this.createRemotePlayerObject(player);
        this.remotePlayerObjects.set(player.playerId, object);
      }
      this.updateRemotePlayerLabel(object, player);
    }
  }

  setOnlineSnapshot(snapshot: GameSnapshot): void {
    this.onlineSnapshot = structuredClone(snapshot);
    this.position = { x: snapshot.self.x, y: snapshot.self.y };
    this.player?.setPosition(this.position.x, this.position.y);
    this.player?.setDepth(this.entityDepth(this.position.y));
    this.setRemotePlayers(snapshot.players);
  }

  create(): void {
    if (this.startupFailed) return;
    try {
      this.createWorld();
      this.services.onReady?.();
    } catch (error) {
      this.startupFailed = true;
      console.error('Campus initialization failed', error);
      this.services.onLoadError?.('校园初始化失败，请重新加载；当前装备和仓库尚未带入。');
    }
  }

  private createWorld(): void {
    if (this.services.network) {
      this.roomLootSearch = new RoomLootSearch(
        this.services.network,
        (chest) => this.receiveRoomLoot(chest),
        (message) => this.services.notify(message),
      );
    }
    for (const key of MONSTER_SPRITE_SHEETS) {
      if (!this.textures.exists(key) || !this.textures.get(key).has('0')) {
        throw new Error(`Missing animation frames: ${key}`);
      }
    }
    this.createPlayerAnimations();
    this.createChestAnimations();
    this.createEnemyAnimations();
    this.drawCampus();
    this.createCampusForeground();
    if (this.textures.exists('night-mask')) {
      this.textures.remove('night-mask');
    }
    this.darkness = this.textures.createCanvas('night-mask', 1, 1) ?? undefined;
    this.darknessImage = this.add.image(0, 0, 'night-mask').setOrigin(0).setDepth(NIGHT_MASK_DEPTH);
    this.flashlight = this.add.graphics().setDepth(EFFECTS_DEPTH);
    this.alerts = this.add.graphics().setDepth(PLAY_ALERT_DEPTH);
    this.searchAlert = this.add
      .text(0, 0, '搜索', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '14px',
        color: '#f0d9a6',
        backgroundColor: '#14181ae6',
        padding: { x: 6, y: 3 },
      })
      .setOrigin(0.5, 1)
      .setDepth(PLAY_ALERT_DEPTH)
      .setVisible(false);
    this.layoutExtractions();
    this.aura = this.add.circle(0, 0, 23, 0xa9e9d0, 0.12);
    const shadow = this.add.ellipse(0, 10, 25, 9, 0x061f23, 0.35);
    this.playerSprite = this.createPlayerSprite();
    this.player = this.add
      .container(this.position.x, this.position.y, [shadow, this.aura, this.playerSprite])
      .setDepth(this.entityDepth(this.position.y));
    this.playPlayerAnimation('idle', this.playerFacing);
    if (this.services.displayName) {
      this.createNameplate(
        this.services.displayName,
        this.player,
        -this.playerSprite.displayHeight - 6,
      );
    }
    for (const enemy of this.combat.enemies) {
      this.addEnemyObject(enemy);
    }
    const keyboard = this.input.keyboard;
    if (keyboard) {
      for (const key of GAME_KEYS) {
        this.keys[key] = keyboard.addKey(key);
      }
      // 输入框获得焦点时先放开这些键的 capture，否则 W/A/S/D/E/Q/L/R/G 会被 preventDefault，
      // 在大厅聊天框里根本打不出这些字母；失焦后再恢复，避免游戏中空格/方向键滚动页面。
      const captures = GAME_KEYS.map((key) => Phaser.Input.Keyboard.KeyCodes[key]);
      this.typingGuardDispose = createTypingGuard({
        onStart: () => keyboard.clearCaptures(),
        onEnd: () => keyboard.addCapture(captures),
      });
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.typingGuardDispose?.();
        this.typingGuardDispose = undefined;
      });
    }
    this.cameras.main.setBounds(0, 0, activeMap().width, activeMap().height);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    // 角色容器的原点在脚底，而 160×0.44 的贴图身体中心在脚底上方约 35px。
    // 正向偏移让镜头对准身体中心；旧的 -36 会把人物整体顶到上半屏。
    this.cameras.main.setFollowOffset(0, 35);
    const resizeCamera = () => {
      this.cameras.main.setZoom(
        isTouchLayout() ? Math.max(1.12, Math.min(1.5, (this.scale.width / 960) * 1.38)) : 1.7,
      );
      this.syncNameplates();
    };
    resizeCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, resizeCamera);
    this.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncNameplates, this);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (isTouchLayout()) return;
      this.aimAtPointer(pointer);
    });
    this.releaseDamage = this.services.events.on('DamageTaken', ({ amount, health }) => {
      this.services.sound.play('behit');
      this.services.sound.setLoop('alarm', health > 0 && health < 20);
      this.hurtThisFrame = true;
      this.silentCloakUntilMs = 0;
      this.silentCloakDetectionMultiplier = 1;
      this.hurtFeedbackMs = COMBAT_RULES.feedback.playerHighlightMs;
      this.setPlayerAction('hurt', COMBAT_RULES.feedback.playerHighlightMs);
      this.cancelSearch();
      this.combat.onPlayerDamaged();
      this.services.notify(`受到 ${amount} 点伤害，当前生命 ${health}；搜索和撤离读条已中断。`);
      this.cameras.main.flash(COMBAT_RULES.feedback.cameraFlashMs, 255, 72, 72, false);
      this.cameras.main.shake(
        COMBAT_RULES.feedback.cameraShakeMs,
        COMBAT_RULES.feedback.cameraShakeIntensity,
      );
    });
    const onHidden = () => {
      if (document.hidden) {
        this.services.touch.reset();
        this.cancelSearch();
        this.services.controller.cancelExtraction();
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.roomLootSearch?.dispose();
      this.releaseDamage?.();
      document.removeEventListener('visibilitychange', onHidden);
      keyboard?.removeAllKeys(true);
      this.scale.off(Phaser.Scale.Events.RESIZE, resizeCamera);
      this.events.off(Phaser.Scenes.Events.POST_UPDATE, this.syncNameplates, this);
      this.nameplates.clear();
    });
  }

  update(_time: number, deltaMs: number): void {
    if (this.startupFailed) return;
    this.playerActionMs = Math.max(0, this.playerActionMs - Math.max(0, deltaMs));
    if (this.playerAction !== 'death' && this.playerActionMs <= 0) {
      this.playerAction = 'none';
    }
    this.hurtFeedbackMs = Math.max(0, this.hurtFeedbackMs - Math.max(0, deltaMs));
    this.attackFeedbackMs = Math.max(0, this.attackFeedbackMs - Math.max(0, deltaMs));
    this.hitStopMs = Math.max(0, this.hitStopMs - Math.max(0, deltaMs));
    this.updateRemotePlayers(deltaMs);
    const view = this.services.controller.getView();
    this.keyPrompt = null;
    this.alertAnchor = null;
    this.services.sound.setLoop('alarm', view.health > 0 && view.health < 20);
    if (view.raidId !== this.lastRaidId) {
      this.resetRaid(view.raidId);
    }

    this.updateRoomPlayers(deltaMs);
    this.syncRoomLoot();
    if (this.services.isOnline?.()) {
      const snapshot = this.onlineSnapshot;
      // 焦点在输入框/下拉框时不消费按键（typing-guard 同时会放开 capture）。
      const isTyping = isFormFocused();
      const focused = document.activeElement;
      const inInventory =
        focused !== null &&
        'closest' in focused &&
        (focused as HTMLElement).closest('#inventory-panel') !== null;
      const down = (key: string) =>
        this.services.touch.held(key) ||
        (!isTyping &&
          !(inInventory && ['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE'].includes(key)) &&
          (this.keys[key]?.isDown ?? false));
      const movement = {
        x:
          Number(down('D') || down('RIGHT')) -
          Number(down('A') || down('LEFT')) +
          this.services.touch.movement.x,
        y:
          Number(down('S') || down('DOWN')) -
          Number(down('W') || down('UP')) +
          this.services.touch.movement.y,
      };
      const touchLayout = isTouchLayout();
      const pointer = this.input.activePointer;
      if (touchLayout && this.services.touch.aim) {
        this.aim = Math.atan2(this.services.touch.aim.y, this.services.touch.aim.x);
      } else if (touchLayout && (movement.x || movement.y)) {
        this.aim = Math.atan2(movement.y, movement.x);
      } else if (pointer && !touchLayout) {
        this.aimAtPointer(pointer);
      }
      this.playerFacing = this.directionFromAngle(this.aim);
      this.updatePlayerAnimation(this.moving);
      this.services.onInput?.({
        moveX: Math.max(-1, Math.min(1, movement.x)),
        moveY: Math.max(-1, Math.min(1, movement.y)),
        aimX: Math.cos(this.aim),
        aimY: Math.sin(this.aim),
        interact: down('E'),
        attack: down('SPACE'),
        hug: down('Q'),
        flashlight: down('L'),
        refill: down('R'),
        flare: down('G'),
      });
      if (snapshot) {
        this.position = { x: snapshot.self.x, y: snapshot.self.y };
        this.player?.setPosition(this.position.x, this.position.y);
        this.player?.setDepth(this.entityDepth(this.position.y));
        this.interaction =
          snapshot.phase === 'extracting'
            ? '正在撤离 · 请留在区域内'
            : snapshot.phase === 'active'
              ? '等待服务端确认交互'
              : '本次探索已结束，请查看结算';
      } else {
        this.interaction = '等待服务端对局快照…';
      }
      this.services.onFrame(
        this.interaction,
        snapshot?.self.extractionProgress ?? 0,
        this.keyPrompt,
      );
      this.drawNight();
      this.drawPlayAlerts();
      this.services.touch.finishFrame();
      return;
    }
    const playable =
      !this.services.controller.isPaused() &&
      (view.phase === 'active' || view.phase === 'extracting');
    if (playable && this.hitStopMs <= 0) {
      this.hurtThisFrame = false;
      // 焦点在输入框/下拉框时不消费按键（typing-guard 同时会放开 capture）。
      const isTyping = isFormFocused();
      const focused = document.activeElement;
      const inInventory =
        focused !== null &&
        'closest' in focused &&
        (focused as HTMLElement).closest('#inventory-panel') !== null;
      const down = (key: string) =>
        this.services.touch.held(key) ||
        (!isTyping &&
          !(inInventory && ['UP', 'DOWN', 'LEFT', 'RIGHT', 'SPACE'].includes(key)) &&
          (this.keys[key]?.isDown ?? false));
      const movement = {
        x:
          Number(down('D') || down('RIGHT')) -
          Number(down('A') || down('LEFT')) +
          this.services.touch.movement.x,
        y:
          Number(down('S') || down('DOWN')) -
          Number(down('W') || down('UP')) +
          this.services.touch.movement.y,
      };
      this.networkInputElapsed += deltaMs;
      if (this.networkInputElapsed >= 50) {
        this.networkInputElapsed %= 50;
        this.services.network?.sendInput(movement, this.aim, [
          ...(down('E') ? (['interact'] as const) : []),
          ...(down('SPACE') ? (['attack'] as const) : []),
          ...(down('Q') ? (['hug'] as const) : []),
        ]);
      }
      this.moving = Math.hypot(movement.x, movement.y) > 0.1;
      this.services.sound.setLoop('footsteps', this.moving);
      if (this.moving) {
        this.cancelSearch();
      }
      const map = activeMap();
      this.position =
        this.services.network?.isInRoom() && this.services.network.getRoomState()?.started
          ? this.position
          : movePlayer(
              this.position,
              movement,
              deltaMs,
              map.playerSpeed * this.services.controller.getMoveSpeedMultiplier(),
              map.playerRadius,
              { x: 30, y: 35, width: map.width - 60, height: map.height - 70 },
              map.obstacles,
            );
      if (this.player) {
        const blend = this.services.network?.isInRoom()
          ? 1 - Math.exp(-Math.max(0, deltaMs) / 55)
          : 1;
        this.player.setPosition(
          this.player.x + (this.position.x - this.player.x) * blend,
          this.player.y + (this.position.y - this.player.y) * blend,
        );
      }
      this.player?.setDepth(this.entityDepth(this.position.y));
      revealExploredArea(this.exploredMap, this.position);
      const pointer = this.input.activePointer;
      const touchLayout = isTouchLayout();
      if (touchLayout && this.services.touch.aim) {
        this.aim = Math.atan2(this.services.touch.aim.y, this.services.touch.aim.x);
      } else if (touchLayout && this.services.touch.aimDirection) {
        this.aim = Math.atan2(
          this.services.touch.aimDirection.y,
          this.services.touch.aimDirection.x,
        );
      } else if (touchLayout && (movement.x || movement.y)) {
        this.aim = Math.atan2(movement.y, movement.x);
      } else if (pointer && !touchLayout) {
        this.aimAtPointer(pointer);
      }
      this.playerFacing = this.directionFromAngle(this.aim);
      this.updatePlayerAnimation(this.moving);
      this.services.onInput?.({
        moveX: Math.max(-1, Math.min(1, movement.x)),
        moveY: Math.max(-1, Math.min(1, movement.y)),
        aimX: Math.cos(this.aim),
        aimY: Math.sin(this.aim),
        interact: down('E'),
        attack: down('SPACE'),
        hug: down('Q'),
        flashlight: down('L'),
        refill: down('R'),
        flare: down('G'),
      });
      this.lighting.tick(deltaMs);
      if (down('L') && !this.previousLight) {
        this.lighting.toggle();
        this.services.notify(
          this.lighting.enabled ? '手电筒已打开。' : '手电筒已关闭，注意黑暗中的敌人。',
        );
      }
      if (down('R') && !this.previousRefill && this.lighting.refill()) {
        this.services.notify('更换电池，手电筒恢复满电。');
      }
      if (down('G') && !this.previousFlare && this.lighting.deploy(this.position)) {
        this.services.notify('照明棒已部署，附近区域将保持可见 30 秒。');
      }
      if (down('SPACE')) {
        // cancelSearch 内部已含 this.search.cancel()，且额外取消房战搜刮
        this.cancelSearch();
        this.silentCloakUntilMs = 0;
        this.silentCloakDetectionMultiplier = 1;
        const carriedItems = this.services.inventory.getCarriedItems();
        const equippedWeapon = this.services.inventory.getEquipment().primary;
        const weaponItem =
          equippedWeapon && ITEM_DEFINITIONS[equippedWeapon.itemId]?.kind === 'weapon'
            ? equippedWeapon
            : carriedItems.find((item) => ITEM_DEFINITIONS[item.itemId]?.kind === 'weapon');
        if (!weaponItem) {
          if (!this.previousAttack) {
            this.services.notify('未携带武器，无法攻击。');
          }
        } else {
          const weaponId = isCombatWeaponId(weaponItem.itemId) ? weaponItem.itemId : 'training-bat';
          const weapon = combatWeaponConfig(weaponId);
          if (
            weapon.maxUses !== null &&
            this.combat.getWeaponUsesRemaining(weaponId, weaponItem.instanceId) === 0
          ) {
            if (!this.previousAttack) {
              this.services.notify(`${ITEM_DEFINITIONS[weaponId]?.name ?? weaponId}已用尽。`);
            }
            this.previousAttack = down('SPACE');
          }
          const previousCooldown = this.combat.attackCooldown;
          const defeated = this.combat.attack(
            this.position,
            this.aim,
            activeMap().obstacles,
            weapon.damage,
            weaponId,
            weaponItem.instanceId,
          );
          if (previousCooldown <= 0 && this.combat.attackCooldown > 0) {
            if (this.combat.weaponUsesRemaining === 0) {
              this.services.inventory.remove(weaponItem.instanceId);
              this.services.notify(`${ITEM_DEFINITIONS[weaponId]?.name ?? weaponId}已报废。`);
            }
            this.setPlayerAction('attack', COMBAT_RULES.player.attack.swingMs + 140);
            this.services.sound.play('hit');
            this.attackFeedbackMs = COMBAT_RULES.feedback.playerAttackFlashMs;
            if (this.combat.attackHit) {
              this.hitStopMs = COMBAT_RULES.feedback.playerAttackHitStopMs;
              this.cameras.main.shake(
                COMBAT_RULES.feedback.playerAttackShakeMs,
                COMBAT_RULES.feedback.playerAttackShakeIntensity,
              );
            }
          }
          for (const enemy of defeated) {
            if (view.raidId) {
              this.services.events.emit('EnemyDefeated', {
                raidId: view.raidId,
                enemyId: enemy.id,
              });
              if (enemy.kind === 'patrol' && shouldDropPatrolLoot()) {
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
        }
      }
      const combat = this.combat.update(
        deltaMs,
        this.position,
        this.lighting.enabled,
        down('Q') && !down('SPACE'),
        !this.moving,
        activeMap().obstacles,
        this.bounds,
        this.detectionMultiplier(),
        this.services.controller.isInvulnerable?.() ?? false,
      );
      const spawnedEnemies = this.combat.updateSpawns(deltaMs, () =>
        findEnemySpawnPosition(this.position, this.aim, this.lighting, this.combat.enemies),
      );
      for (const enemy of spawnedEnemies) {
        this.addEnemyObject(enemy);
      }
      if (spawnedEnemies.length > 0) {
        this.services.notify(`远处出现了${spawnedEnemies.length}只新的怪物。`);
      }
      if (combat.amplifierWindups.length > 0) {
        this.services.sound.playAmplifierCharge?.();
      }
      if (combat.damage) {
        this.services.controller.applyDamage(combat.damage);
      }
      if (combat.soundWaveHit) {
        this.services.controller.applySoundWaveEffect?.();
      }
      if (combat.calmed.length > 0) {
        this.services.notify('抱抱成功，怪物平静约 30 秒，不会掉落物品。');
      }
      this.services.controller.setExtractionPresence(inExtraction(this.position));
      this.interact(down('E') && !down('SPACE') && !this.hurtThisFrame);
      this.previousInteract = down('E');
      this.previousAttack = down('SPACE');
      this.previousLight = down('L');
      this.previousRefill = down('R');
      this.previousFlare = down('G');
    } else if (playable) {
      // Hit-stop freezes player input/movement, not the enemy simulation.
      const combat = this.combat.update(
        deltaMs,
        this.position,
        this.lighting.enabled,
        false,
        true,
        activeMap().obstacles,
        this.bounds,
        this.detectionMultiplier(),
        this.services.controller.isInvulnerable?.() ?? false,
      );
      const spawnedEnemies = this.combat.updateSpawns(deltaMs, () =>
        findEnemySpawnPosition(this.position, this.aim, this.lighting, this.combat.enemies),
      );
      for (const enemy of spawnedEnemies) {
        this.addEnemyObject(enemy);
      }
      if (spawnedEnemies.length > 0) {
        this.services.notify(`远处出现了${spawnedEnemies.length}只新的怪物。`);
      }
      if (combat.amplifierWindups.length > 0) {
        this.services.sound.playAmplifierCharge?.();
      }
      if (combat.damage) {
        this.services.controller.applyDamage(combat.damage);
      }
      if (combat.soundWaveHit) {
        this.services.controller.applySoundWaveEffect?.();
      }
      if (combat.calmed.length > 0) {
        this.services.notify('抱抱成功，怪物平静约 30 秒，不会掉落物品。');
      }
    } else if (!playable) {
      this.services.sound.setLoop('footsteps', false);
      this.services.sound.setTinnitus?.(false);
      this.cancelSearch();
      if (view.health <= 0) {
        this.setPlayerAction('death', Number.POSITIVE_INFINITY);
      }
      this.interaction = this.services.controller.isPaused()
        ? '已暂停 · 关闭设置或当前弹窗后继续'
        : view.phase === 'preparing'
          ? '准备好后，开始本次校园探索'
          : '本次探索已结束，请查看结算';
    }
    this.services.controller.tick();
    const current = this.services.controller.getView();
    this.services.sound.setTinnitus?.(
      playable && (current.statusEffects?.tinnitusRemainingMs ?? 0) > 0,
    );
    const extractionFill = current.value >= current.threshold ? 0x77d4a8 : 0x667a77;
    const extractionStroke = current.value >= current.threshold ? 0x97ecc6 : 0x738984;
    for (const marker of this.extractionMarkers) {
      marker.setFillStyle(extractionFill, 0.24);
      marker.setStrokeStyle(2, extractionStroke);
    }
    const hug = this.nearbyHug();
    const activeBanner =
      this.banner !== null && this.time.now < this.banner.untilMs ? this.banner.text : null;
    this.services.onFrame(
      hug || this.interaction.includes('抱抱')
        ? this.interaction
        : (activeBanner ?? this.interaction),
      hug ? hug.hugProgress / COMBAT_RULES.hug.calmHoldDurationMs : this.search.progress(),
      this.keyPrompt,
    );
    this.drawNight();
    this.drawPlayAlerts();
    this.services.touch.finishFrame();
  }

  private mapTeammates() {
    const network = this.services.network;
    return network?.isInRoom()
      ? (network.getRoomState()?.players ?? [])
          .filter((player) => player.connected && player.playerId !== network.getPlayerId())
          .map((player) => ({ position: player.position, name: player.displayName }))
      : [];
  }

  private createPlayerAnimations(): void {
    const definitions = [
      { action: 'idle', frames: 5, frameRate: 4, repeat: -1 },
      { action: 'walk', frames: 5, frameRate: 9, repeat: -1 },
      { action: 'attack', frames: 4, frameRate: 12, repeat: 0 },
      { action: 'hurt', frames: 5, frameRate: 10, repeat: 0 },
      { action: 'death', frames: 5, frameRate: 8, repeat: 0 },
    ] as const;
    const directions: PlayerDirection[] = ['up', 'down', 'left', 'right'];
    for (const definition of definitions) {
      for (const [row, direction] of directions.entries()) {
        const key = `player-${definition.action}-${direction}`;
        if (this.anims.exists(key)) {
          continue;
        }
        this.anims.create({
          key,
          frames: this.anims.generateFrameNumbers(`player-${definition.action}`, {
            start: row * definition.frames,
            end: row * definition.frames + definition.frames - 1,
          }),
          frameRate: definition.frameRate,
          repeat: definition.repeat,
        });
      }
    }
  }

  private createPlayerSprite(): Phaser.GameObjects.Sprite {
    return this.add
      .sprite(0, 0, 'player-idle', 0)
      .setName('sprite')
      .setOrigin(0.5, 1)
      .setScale(0.44);
  }

  private updateRoomPlayers(deltaMs: number): void {
    const blend = 1 - Math.exp(-Math.max(0, deltaMs) / 55);
    for (const remote of this.remotePlayers.values()) {
      const dx = remote.target.x - remote.object.x;
      const dy = remote.target.y - remote.object.y;
      const moving = Math.hypot(dx, dy) > 0.5;
      remote.object.x += dx * blend;
      remote.object.y += dy * blend;
      remote.object.setDepth(this.entityDepth(remote.object.y));
      const sprite = remote.object.getByName<Phaser.GameObjects.Sprite>('sprite');
      const key = `player-${moving ? 'walk' : 'idle'}-${this.directionFromAngle(remote.aim)}`;
      if (sprite && sprite.anims.currentAnim?.key !== key) {
        sprite.anims.play(key, true);
      }
    }
  }

  private playPlayerAnimation(
    action: Exclude<PlayerAction, 'none'> | 'idle' | 'walk',
    direction: PlayerDirection,
  ): void {
    const key = `player-${action}-${direction}`;
    if (!this.playerSprite || !this.anims.exists(key) || this.playerAnimationKey === key) {
      return;
    }
    this.playerAnimationKey = key;
    this.playerSprite.anims.play(key, true);
  }

  private updatePlayerAnimation(moving: boolean): void {
    if (this.playerAction === 'death') {
      this.playPlayerAnimation('death', this.playerFacing);
      return;
    }
    if (this.playerAction === 'attack' || this.playerAction === 'hurt') {
      this.playPlayerAnimation(this.playerAction, this.playerFacing);
      return;
    }
    this.playPlayerAnimation(moving ? 'walk' : 'idle', this.playerFacing);
  }

  private setPlayerAction(action: PlayerAction, durationMs: number): void {
    this.playerAction = action;
    this.playerActionMs = durationMs;
    this.updatePlayerAnimation(this.moving);
  }

  private aimAtPointer(pointer: Phaser.Input.Pointer): void {
    // A pointer transformed while the canvas is hidden can contain NaN/Infinity.
    // Keep the last valid direction until a visible canvas supplies valid coordinates.
    if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y)) return;
    const target = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    if (Number.isFinite(target.x) && Number.isFinite(target.y)) {
      this.aim = angleBetween(this.position, target);
    }
  }

  private directionFromAngle(angle: number): PlayerDirection {
    const horizontal = Math.cos(angle);
    const vertical = Math.sin(angle);
    if (Math.abs(horizontal) > Math.abs(vertical)) {
      return horizontal < 0 ? 'left' : 'right';
    }
    return vertical < 0 ? 'up' : 'down';
  }

  private createNameplate(
    displayName: string,
    owner: Phaser.GameObjects.Container,
    offsetY: number,
  ): void {
    const text = this.add
      .text(owner.x, owner.y + offsetY, displayName.slice(0, 18), {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '12px',
        color: '#f5f0d3',
        backgroundColor: '#16312dcc',
        padding: { x: 4, y: 2 },
      })
      .setName('nameplate')
      .setDepth(EFFECTS_DEPTH + 1)
      .setOrigin(0.5, 1)
      .setResolution(Math.max(2, window.devicePixelRatio || 1))
      .setScale(1 / this.cameras.main.zoom);
    this.nameplates.set(owner, { text, offsetY });
  }

  private syncNameplates(): void {
    const placed: { left: number; right: number; top: number; bottom: number }[] = [];
    const gap = 2 / this.cameras.main.zoom;
    for (const [owner, { text, offsetY }] of this.nameplates) {
      if (!owner.scene) {
        text.destroy();
        this.nameplates.delete(owner);
        continue;
      }
      // Labels follow feet positions but render above the night mask at a fixed screen size.
      text
        .setPosition(owner.x, owner.y + offsetY)
        .setScale(1 / this.cameras.main.zoom)
        .setVisible(owner.visible)
        .setAlpha(owner.alpha);
      if (!owner.visible || owner.alpha <= 0) continue;
      const bounds = {
        left: text.x - text.displayWidth / 2,
        right: text.x + text.displayWidth / 2,
        top: text.y - text.displayHeight,
        bottom: text.y,
      };
      for (let attempt = 0; attempt < placed.length; attempt++) {
        const overlap = placed.find(
          (other) =>
            bounds.left < other.right + gap &&
            bounds.right + gap > other.left &&
            bounds.top < other.bottom + gap &&
            bounds.bottom + gap > other.top,
        );
        if (!overlap) break;
        bounds.bottom = overlap.top - gap;
        bounds.top = bounds.bottom - text.displayHeight;
      }
      text.setY(bounds.bottom);
      placed.push(bounds);
    }
  }

  private createRemotePlayerObject(player: RemotePlayerSnapshot): Phaser.GameObjects.Container {
    const shadow = this.add.ellipse(0, 13, 30, 12, 0x061f23, 0.35);
    const body = this.add.rectangle(0, 0, 22, 28, 0x78b6d1).setStrokeStyle(2, 0xd3f2ff, 0.65);
    const head = this.add.circle(0, -16, 10, 0xffedd2);
    const healthBack = this.add.rectangle(0, -42, 38, 4, 0x251d1c, 0.9);
    const healthFill = this.add.rectangle(-19, -42, 38, 4, 0x75d2a0, 0.95).setOrigin(0, 0.5);
    healthFill.setName('health-fill');
    const label = this.add
      .text(0, -57, player.displayName, {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '12px',
        color: '#d9f0ee',
        backgroundColor: '#102b2dcc',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setName('label');
    return this.add
      .container(player.x, player.y, [shadow, body, head, healthBack, healthFill, label])
      .setDepth(this.entityDepth(player.y));
  }

  private updateRemotePlayers(deltaMs: number): void {
    const alpha = Math.min(1, Math.max(0.08, deltaMs / 100));
    for (const [playerId, target] of this.remotePlayerTargets) {
      const object = this.remotePlayerObjects.get(playerId);
      if (!object) continue;
      object.x += (target.x - object.x) * alpha;
      object.y += (target.y - object.y) * alpha;
      object.setDepth(this.entityDepth(object.y));
      object.setAlpha(target.connected ? 1 : 0.5);
      const healthFill = object.getByName('health-fill') as Phaser.GameObjects.Rectangle;
      healthFill.width =
        38 * Math.max(0, Math.min(1, target.health / Math.max(1, target.maxHealth)));
      this.updateRemotePlayerLabel(object, target);
    }
  }

  private updateRemotePlayerLabel(
    object: Phaser.GameObjects.Container,
    player: RemotePlayerSnapshot,
  ): void {
    const label = object.getByName('label') as Phaser.GameObjects.Text;
    label.setText(`${player.displayName}${player.action === 'downed' ? ' · 倒地' : ''}`);
  }

  private drawNight(): void {
    const players = [
      this.position,
      ...Array.from(this.remotePlayers.values(), (remote) => remote.object),
      ...this.remotePlayerObjects.values(),
    ];
    for (const { object, layer } of this.foregroundObjects)
      object.setAlpha(foregroundOpacity(layer, players));
    if (!this.darkness || !this.flashlight) {
      return;
    }
    if (this.time.now - this.lastNightDraw >= 32) {
      const camera = this.cameras.main;
      const origin = { x: camera.worldView.x - 128, y: camera.worldView.y - 128 };
      const width = Math.ceil(camera.width / camera.zoom) + 256;
      const height = Math.ceil(camera.height / camera.zoom) + 256;
      if (this.darkness.width !== width || this.darkness.height !== height)
        this.darkness.setSize(width, height);
      this.darknessImage?.setPosition(origin.x, origin.y);
      renderDarkness(
        this.darkness.context,
        width,
        height,
        this.lighting,
        this.position,
        this.aim,
        activeMap().obstacles,
        origin,
        this.searchPoints.filter((point) =>
          this.lighting.flashlightReveals(point, this.position, this.aim, activeMap().obstacles),
        ),
      );
      this.darkness.refresh();
      const overview = document.querySelector<HTMLCanvasElement>('#campus-overview');
      const mapImage = this.textures
        .get(activeMap().imageKey)
        .getSourceImage() as CanvasImageSource;
      if (overview) {
        drawCampusOverview(overview, this.position, mapImage, this.exploredMap, {
          followPlayer: true,
          viewRadius: 320,
          teammates: this.mapTeammates(),
        });
      }
      const mapDialog = document.querySelector<HTMLDialogElement>('#campus-map-dialog');
      const expanded = document.querySelector<HTMLCanvasElement>('#campus-map-expanded');
      if (mapDialog?.open && expanded) {
        drawCampusOverview(expanded, this.position, mapImage, this.exploredMap, {
          teammates: this.mapTeammates(),
        });
      }
      this.lastNightDraw = this.time.now;
    }
    this.flashlight.clear();
    if (this.combat.swingMs > 0) {
      const equippedWeapon = this.services.inventory.getEquipment().primary;
      const carriedWeapon =
        equippedWeapon && ITEM_DEFINITIONS[equippedWeapon.itemId]?.kind === 'weapon'
          ? equippedWeapon
          : this.services.inventory
              .getCarriedItems()
              .find((item) => ITEM_DEFINITIONS[item.itemId]?.kind === 'weapon');
      const swingWeaponId =
        carriedWeapon && isCombatWeaponId(carriedWeapon.itemId)
          ? carriedWeapon.itemId
          : 'training-bat';
      const swingWeapon = combatWeaponConfig(swingWeaponId);
      this.flashlight.fillStyle(0xf2edbc, 0.35);
      this.flashlight.beginPath();
      this.flashlight.moveTo(this.position.x, this.position.y);
      this.flashlight.arc(
        this.position.x,
        this.position.y,
        swingWeapon.range,
        this.aim - swingWeapon.arcRadians,
        this.aim + swingWeapon.arcRadians,
        false,
      );
      this.flashlight.closePath().fillPath();
      if (this.attackFeedbackMs > 0) {
        this.flashlight.fillStyle(0xfff3b0, 0.75);
        this.flashlight.fillCircle(
          this.position.x + Math.cos(this.aim) * 38,
          this.position.y + Math.sin(this.aim) * 38,
          9,
        );
      }
    }
    for (const enemy of this.combat.enemies) {
      const visible =
        enemy.state !== 'vanished' &&
        this.lighting.visible(enemy.position, this.position, this.aim, activeMap().obstacles);
      const object = this.enemyObjects.get(enemy.id);
      object
        ?.setPosition(enemy.position.x, enemy.position.y)
        .setDepth(this.entityDepth(enemy.position.y));
      const died = enemy.state === 'dead';
      if (object) {
        this.updateEnemyVisual(enemy, object);
        object.setVisible(visible && (!died || !this.enemyDeathFinished.has(enemy.id)));
      }
      if (
        visible &&
        !monsterConcealed(enemy) &&
        (!died || !this.enemyDeathFinished.has(enemy.id))
      ) {
        this.flashlight
          .fillStyle(0x40202b)
          .fillRect(enemy.position.x - 18, enemy.position.y - 70, 36, 4);
        this.flashlight
          .fillStyle(enemy.mutated ? 0xff4e68 : enemy.kind === 'amplifier' ? 0xff6b7d : 0xe4ae6b)
          .fillRect(
            enemy.position.x - 18,
            enemy.position.y - 70,
            (36 * Math.max(0, enemy.health)) / enemyMaxHealth(enemy.kind),
            4,
          );
        if (enemy.state === 'mutation-warning') {
          this.flashlight
            .lineStyle(4, 0xffb347, 0.65 + Math.sin(this.time.now / 75) * 0.3)
            .strokeCircle(enemy.position.x, enemy.position.y, 48);
        }
        if (enemy.state === 'windup') {
          if (enemy.kind === 'amplifier' && enemy.attackAngle !== undefined) {
            const ampRules = COMBAT_RULES.enemy.amplifier;
            const angle = enemy.attackAngle;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const halfWidth = ampRules.projectileWidth / 2;
            const length = ampRules.projectileMaxDistance;
            const perpX = -sin * halfWidth;
            const perpY = cos * halfWidth;
            const endX = enemy.position.x + cos * length;
            const endY = enemy.position.y + sin * length;
            const locked = Boolean(enemy.windupLocked);
            const progress = Math.max(0, Math.min(1, 1 - enemy.timer / ampRules.windupMs));
            this.flashlight.fillStyle(
              locked ? 0xff2b43 : 0xff5a6a,
              locked ? 0.3 + Math.sin(this.time.now / 50) * 0.08 : 0.14 + progress * 0.14,
            );
            this.flashlight.beginPath();
            this.flashlight.moveTo(enemy.position.x + perpX, enemy.position.y + perpY);
            this.flashlight.lineTo(endX + perpX, endY + perpY);
            this.flashlight.lineTo(endX - perpX, endY - perpY);
            this.flashlight.lineTo(enemy.position.x - perpX, enemy.position.y - perpY);
            this.flashlight.closePath().fillPath();
            this.flashlight
              .lineStyle(locked ? 3 : 2, locked ? 0xffd2d6 : 0xff7b88, locked ? 0.95 : 0.72)
              .lineBetween(enemy.position.x, enemy.position.y, endX, endY);
          } else {
            const warning = COMBAT_RULES.feedback.enemyWarning;
            const direction = angleBetween(enemy.position, this.position);
            const tip = {
              x: enemy.position.x + Math.cos(direction) * warning.lineLength,
              y: enemy.position.y + Math.sin(direction) * warning.lineLength,
            };
            const left = {
              x: tip.x - Math.cos(direction - Math.PI / 6) * warning.arrowSize,
              y: tip.y - Math.sin(direction - Math.PI / 6) * warning.arrowSize,
            };
            const right = {
              x: tip.x - Math.cos(direction + Math.PI / 6) * warning.arrowSize,
              y: tip.y - Math.sin(direction + Math.PI / 6) * warning.arrowSize,
            };
            this.flashlight
              .lineStyle(3, 0xff5269, 0.8)
              .strokeCircle(enemy.position.x, enemy.position.y, warning.ringRadius)
              .lineStyle(warning.lineWidth, 0xff5269, 0.95)
              .lineBetween(enemy.position.x, enemy.position.y, tip.x, tip.y)
              .lineBetween(tip.x, tip.y, left.x, left.y)
              .lineBetween(tip.x, tip.y, right.x, right.y);
          }
        }
      }
    }
    const activeWaveIds = new Set(this.combat.soundWaves.map((wave) => wave.id));
    for (const [waveId, sprite] of this.soundWaveSprites) {
      if (!activeWaveIds.has(waveId)) {
        sprite.destroy();
        this.soundWaveSprites.delete(waveId);
      }
    }
    for (const wave of this.combat.soundWaves) {
      let sprite = this.soundWaveSprites.get(wave.id);
      if (!sprite) {
        sprite = this.add
          .sprite(wave.position.x, wave.position.y, 'amplifier-wave', 0)
          .setOrigin(0.5, 0.5)
          .setDisplaySize(
            COMBAT_RULES.enemy.amplifier.projectileWidth,
            COMBAT_RULES.enemy.amplifier.projectileWidth,
          );
        if (this.anims.exists('amplifier-wave')) {
          sprite.anims.play('amplifier-wave', true);
        }
        this.soundWaveSprites.set(wave.id, sprite);
      }
      sprite
        .setPosition(wave.position.x, wave.position.y)
        .setRotation(wave.angle)
        .setDepth(this.entityDepth(wave.position.y) + 2);
    }
    for (const point of this.searchPoints) {
      this.chestObjects
        .get(point.id)
        ?.setVisible(
          this.lighting.flashlightReveals(point, this.position, this.aim, activeMap().obstacles),
        );
    }
    for (const drop of this.ground.values()) {
      drop.sprite.setVisible(
        this.lighting.visible(drop.position, this.position, this.aim, activeMap().obstacles),
      );
    }
    this.player?.setAlpha(
      this.combat.invulnerability > 0 ? (Math.floor(this.time.now / 90) % 2 ? 0.5 : 1) : 1,
    );
    this.aura?.setFillStyle(
      this.hurtFeedbackMs > 0 ? 0xff5668 : 0xa9e9d0,
      this.hurtFeedbackMs > 0 ? 0.38 : 0.12,
    );
    if (this.attackFeedbackMs > 0) {
      this.flashlight.fillStyle(0xfff8c2, 0.18);
      this.flashlight.fillCircle(this.position.x, this.position.y, 25);
    }
  }

  drop(instanceId: string): void {
    const view = this.services.controller.getView();
    if (view.phase !== 'active' && view.phase !== 'extracting') {
      return;
    }
    const removed = this.services.inventory.remove(instanceId);
    if (!removed.ok) {
      return;
    }
    this.spawnLoot(removed.value, this.position);
    this.services.notify('物品已放在脚边。按 E 拾回；丢弃和重拾不会累计刷分。');
  }

  private spawnLoot(item: ItemInstance, position: Point): void {
    if (this.ground.has(item.instanceId)) {
      return;
    }
    const point = { ...position };
    const definition = ITEM_DEFINITIONS[item.itemId];
    const sprite = this.add
      .container(point.x, point.y, [
        this.add.circle(0, 0, 22, 0xffcc7c, 0.2),
        this.add.circle(0, 0, 14, 0x453d2d).setStrokeStyle(2, 0xffcc7c),
        this.add
          .text(0, 0, '拾', {
            fontFamily: 'Microsoft YaHei',
            fontSize: '12px',
            color: '#ffffff',
          })
          .setOrigin(0.5),
        this.add
          .text(0, 22, definition?.name ?? item.itemId, {
            fontFamily: 'Microsoft YaHei',
            fontSize: '13px',
            color: '#ffeed3',
            backgroundColor: '#171221',
            padding: { x: 5, y: 3 },
          })
          .setOrigin(0.5, 0),
      ])
      .setDepth(this.entityDepth(point.y));
    this.ground.set(item.instanceId, { item, position: point, sprite });
  }

  private nearbyHug(): Enemy | undefined {
    const hug = this.requestingHug();
    return hug && distance(hug.position, this.position) < COMBAT_RULES.hug.calmRange
      ? hug
      : undefined;
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

  private cancelSearch(): void {
    this.search.cancel();
    this.roomLootSearch?.cancel();
  }

  private syncRoomLoot(): void {
    const state = this.services.network?.getRoomState();
    if (!this.roomRoundId || state?.roundId !== this.roomRoundId) return;
    for (const chest of state.chests ?? []) {
      if (chest.claimedBy && !this.search.isOpened(chest.id)) {
        if (this.search.current() === chest.id) this.cancelSearch();
        this.openChest(chest.id);
      }
    }
  }

  private openChest(id: string): void {
    this.search.markOpened(id);
    this.chestSprites.get(id)?.play('treasure-chest-open');
    this.chestObjects.get(id)?.setAlpha(0.23);
  }

  private receiveRoomLoot(chest: RoomChestSnapshot): boolean {
    const view = this.services.controller.getView();
    if (
      view.phase !== 'active' ||
      !view.raidId ||
      this.services.controller.isPaused() ||
      !this.services.network?.isInRoom() ||
      this.services.network.getRoomState()?.roundId !== this.roomRoundId ||
      this.search.isOpened(chest.id)
    )
      return false;
    const result = this.services.inventory.addLoot({
      instanceId: `${view.raidId}:room:${chest.id}`,
      itemId: chest.itemId,
      origin: { kind: 'raid-loot', obtainedInRaidId: view.raidId },
    });
    this.cancelSearch();
    if (!result.ok) {
      this.services.notify('背包已满，宝箱已保留；腾出空间后可以重新搜索。');
      return false;
    }
    this.openChest(chest.id);
    this.services.events.emit('LocationInteracted', { raidId: view.raidId, locationId: chest.id });
    this.banner = {
      text: `已拾取：${ITEM_DEFINITIONS[chest.itemId]?.name ?? chest.itemId}`,
      untilMs: this.time.now + 3200,
    };
    this.services.notify('搜索完成，物资进入本局背包。');
    return true;
  }

  private interact(held: boolean): void {
    const view = this.services.controller.getView();
    if (view.phase !== 'active' && view.phase !== 'extracting') {
      this.cancelSearch();
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
      : carried
          .filter((item) => !equippedIds.has(item.instanceId))
          .reduce((slots, item) => slots + (ITEM_DEFINITIONS[item.itemId]?.bagSlots ?? 1), 0) >=
        RAID_RULES.bagCapacity;
    const hug = this.nearbyHug();
    if (hug) {
      this.cancelSearch();
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
      this.cancelSearch();
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
          loot.sprite.destroy();
          this.ground.delete(loot.item.instanceId);
          this.banner = {
            text: `已拾回：${ITEM_DEFINITIONS[loot.item.itemId]?.name ?? loot.item.itemId}`,
            untilMs: this.time.now + 2600,
          };
        }
        this.services.notify(result.ok ? '已拾回物品。' : '背包已满或来源无效，请先腾出空间。');
      }
      return;
    }
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
        this.cancelSearch();
        this.interaction = prerequisite;
        return;
      }
      // 满包时不启动搜索进度：否则每次 2 秒读条失败重来，玩家只看得到进度条循环。
      if (bagFull) {
        this.cancelSearch();
        this.interaction = '背包已满 · 先丢弃或替换物品再搜索';
        if (held && !this.previousInteract) {
          this.services.notify('背包已满，搜索点保留在原地；丢弃或替换物品后可以重新搜索。');
        }
        return;
      }
      this.interaction = `${CHEST_TIERS[chest.tier ?? 'normal'].name} · 长按 E 搜索 ${CHEST_TIERS[chest.tier ?? 'normal'].durationMs / 1000} 秒`;
      this.keyPrompt = { key: 'E', label: '搜索' };
      if (!held || this.moving || view.phase !== 'active') {
        this.cancelSearch();
        return;
      }
      if (this.roomRoundId) {
        const network = this.services.network;
        const sharedChest = network?.getRoomState()?.chests?.find((point) => point.id === chest.id);
        if (
          !network?.isInRoom() ||
          network.getRoomState()?.roundId !== this.roomRoundId ||
          !sharedChest
        ) {
          this.cancelSearch();
          this.interaction = '联机连接中断，暂时无法搜索';
          return;
        }
        if (this.search.current() !== chest.id) {
          this.search.begin(chest.id);
          this.services.sound.play('box');
        }
        this.roomLootSearch?.hold(sharedChest);
        if (this.roomLootSearch?.current() !== chest.id) this.search.cancel();
        if (this.search.progress() >= 1) this.interaction = '搜索完成 · 等待领取确认…';
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
          this.chestSprites
            .get(chest.id)
            ?.play(`${CHEST_TIERS[chest.tier ?? 'normal'].texture}-open`);
          this.chestObjects.get(chest.id)?.setAlpha(0.23);
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
          this.banner = { text: pickup, untilMs: this.time.now + (beat === null ? 3200 : 6000) };
          this.services.notify('搜索完成，物资进入本局背包。');
        } else {
          this.banner = {
            text: '背包已满 · 先丢弃或替换物品再搜索',
            untilMs: this.time.now + 3200,
          };
          this.services.notify('背包已满，搜索点已保留；丢弃或替换物品后可以重新搜索。');
        }
      }
      return;
    }
    const stele = activeMap().stone;
    if (chapter?.id === QUEST_CHAPTER_ID && stele) {
      const steleDistance = distance(stele, this.position);
      if (steleDistance < 78) {
        this.cancelSearch();
        if (!hasCurrentRaidNotebook(carried, view.raidId)) {
          this.interaction = '明湖石碑 · 先取得本局残缺手记';
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
        if (held && !this.previousInteract && view.phase === 'active' && view.raidId) {
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
            this.banner = { text: steleStoryBeat(), untilMs: this.time.now + 6000 };
            this.services.notify('明湖石碑调查完成。');
          }
        }
        return;
      }
    }
    if (view.inExtractionZone) {
      this.cancelSearch();
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
      const lamp = activeMap().lamps.find((source) => distance(source, this.position) < 55);
      if (lamp && this.lighting.battery < 99) {
        this.interaction = '灯站充电';
        if (held && !this.moving && !this.hurtThisFrame) {
          this.search.begin(`charge:${lamp.x}`, false);
          if (this.search.progress() >= 1) {
            this.lighting.charge();
            this.cancelSearch();
            this.services.notify('手电筒已充满。');
          }
        } else {
          this.cancelSearch();
        }
      } else {
        this.cancelSearch();
        const request = this.requestingHug();
        this.interaction = request ? this.hugInstruction(request) : '校园夜巡';
      }
    }
  }

  private presentActiveMap(): void {
    const map = activeMap();
    this.bounds.width = map.width - 60;
    this.bounds.height = map.height - 70;
    this.cameras.main.setBounds(0, 0, map.width, map.height);
    this.groundImage?.setTexture(map.imageKey);
    const campusArt = map.id === 'campus';
    for (const image of this.dressing) image.setVisible(campusArt);
    this.steleImage?.setVisible(map.hasStory);
    for (const lamp of this.lampMarkers) lamp.setVisible(campusArt);
    this.layoutExtractions();
    this.exploredMap = createExploredMap();
  }

  private layoutExtractions(): void {
    for (const marker of this.extractionMarkers) marker.destroy();
    this.extractionMarkers = activeMap().extractions.map((zone) =>
      this.add
        .rectangle(
          zone.x + zone.width / 2,
          zone.y + zone.height / 2,
          zone.width,
          zone.height,
          0x74d2b1,
          0.12,
        )
        .setStrokeStyle(2, 0x74d2b1, 0.8)
        .setDepth(20),
    );
  }

  private resetRaid(raidId: string | null): void {
    if (this.services.isOnline?.()) {
      useCampusMap();
    } else if (raidId) {
      beginRaidMap();
      if (!activeMap().hasStory) useCampusMap();
    } else {
      previewUpcomingMap();
    }
    this.presentActiveMap();
    this.roomLootSearch?.reset();
    this.lastRaidId = raidId;
    this.services.sound.setLoop('alarm', false);
    this.services.sound.setTinnitus?.(false);
    for (const sprite of this.soundWaveSprites.values()) {
      sprite.destroy();
    }
    this.soundWaveSprites.clear();
    this.hurtFeedbackMs = 0;
    this.attackFeedbackMs = 0;
    this.hitStopMs = 0;
    this.banner = null;
    const network = this.services.network;
    const roundId = network?.isInRoom() ? network.getRoomState()?.roundId : null;
    this.roomRoundId = raidId ? (roundId ?? null) : null;
    this.position = {
      ...(roundId ? (network?.getLocalPlayer()?.position ?? activeMap().spawn) : activeMap().spawn),
    };
    this.networkInputElapsed = 0;
    clearExploredMap(this.exploredMap);
    revealExploredArea(this.exploredMap, this.position);
    this.search.reset();
    this.lighting.reset();
    this.combat.reset();
    this.enemyVisualStates.clear();
    this.enemyAnimationKeys.clear();
    this.enemyDeathFinished.clear();
    this.enemyMutatedStates.clear();
    this.enemyLastPositions.clear();
    const enemyIds = new Set(this.combat.enemies.map((enemy) => enemy.id));
    for (const [enemyId, object] of this.enemyObjects) {
      if (!enemyIds.has(enemyId)) {
        object.destroy();
        this.warningLabels.get(enemyId)?.destroy();
        this.warningLabels.delete(enemyId);
        this.enemyObjects.delete(enemyId);
      }
    }
    this.aim = -Math.PI / 2;
    this.playerFacing = 'down';
    this.playerAction = 'none';
    this.playerActionMs = 0;
    this.playerAnimationKey = '';
    this.lastNightDraw = -Infinity;
    this.player?.setPosition(this.position.x, this.position.y);
    this.player?.setDepth(this.entityDepth(this.position.y));
    this.playPlayerAnimation('idle', this.playerFacing);
    for (const object of this.chestObjects.values()) {
      object.destroy();
    }
    this.chestObjects.clear();
    this.chestSprites.clear();
    this.searchPoints = raidId
      ? roundId
        ? (network?.getRoomState()?.chests ?? []).map((chest) => ({ ...chest }))
        : generateLootSpawns(
            Math.random,
            activeMap().hasStory ? questSpawnPlan(this.questChapterId()) : [],
          )
      : [];
    for (const point of this.searchPoints) {
      const halo = this.add.circle(0, 0, 23, CHEST_TIERS[point.tier ?? 'normal'].color, 0.09);
      const chest = this.add
        .sprite(0, 0, CHEST_TIERS[point.tier ?? 'normal'].texture, 2)
        .setName('chest-sprite')
        .setOrigin(0.5, 1)
        .setScale(0.26);
      this.chestSprites.set(point.id, chest);
      this.chestObjects.set(
        point.id,
        this.add
          .container(point.x, point.y, [halo, chest])
          .setName(`chest-${point.id}`)
          .setDepth(this.entityDepth(point.y))
          .setVisible(false),
      );
    }
    for (const drop of this.ground.values()) {
      drop.sprite.destroy();
    }
    this.ground.clear();
    this.previousInteract = false;
    this.previousAttack = false;
    this.previousLight = false;
    this.previousRefill = false;
    this.previousFlare = false;
    this.services.touch.reset();
    this.detectorTargetId = null;
    this.detectorUntilMs = 0;
    this.compassUntilMs = 0;
    this.silentCloakUntilMs = 0;
    this.silentCloakDetectionMultiplier = 1;
  }

  private createChestAnimations(): void {
    for (const { texture } of Object.values(CHEST_TIERS)) {
      if (!this.textures.exists(texture) || this.anims.exists(`${texture}-open`)) continue;
      this.anims.create({
        key: `${texture}-open`,
        frames: this.anims.generateFrameNumbers(texture, { start: 3, end: 5 }),
        frameRate: 8,
        repeat: 0,
      });
    }
  }

  private createEnemyAnimations(): void {
    for (const [key, { texture, frameRate, repeat }] of Object.entries(MONSTER_ANIMATIONS)) {
      if (!this.textures.exists(texture) || this.anims.exists(key)) {
        continue;
      }
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(texture),
        frameRate,
        repeat,
      });
    }
  }

  private addEnemyObject(enemy: (typeof this.combat.enemies)[number]): void {
    const isMutated = enemy.kind === 'hug' && enemy.mutated;
    const shadow = this.add.ellipse(0, 0, 28, 8, 0x061f23, 0.38).setName('shadow');
    const sprite = this.add
      .sprite(0, 0, isMutated ? 'squirrel-mutant-idle' : monsterAnimationFor(enemy, false), 0)
      .setName('sprite')
      .setOrigin(0.5, 1);
    const warning = this.add
      .text(0, -82, '即将变异 · 远离', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '14px',
        color: '#ffcc7c',
        backgroundColor: '#301914',
        padding: { x: 5, y: 3 },
      })
      .setName('mutation-warning')
      .setOrigin(0.5, 1)
      .setVisible(false);
    this.warningLabels.set(
      enemy.id,
      this.add
        .text(enemy.position.x, enemy.position.y - 96, '即将变异 · 远离', {
          fontFamily: 'Microsoft YaHei, sans-serif',
          fontSize: '14px',
          color: '#ffcc7c',
          backgroundColor: '#301914',
          padding: { x: 5, y: 3 },
        })
        .setOrigin(0.5, 1)
        .setDepth(PLAY_ALERT_DEPTH)
        .setVisible(false),
    );
    const object = this.add
      .container(enemy.position.x, enemy.position.y, [shadow, sprite, warning])
      .setName(`enemy-${enemy.id}`)
      .setDepth(this.entityDepth(enemy.position.y));
    this.enemyObjects.set(enemy.id, object);
    this.enemyVisualStates.set(enemy.id, enemy.state);
    this.enemyMutatedStates.set(enemy.id, enemy.mutated);
    this.enemyLastPositions.set(enemy.id, { ...enemy.position });
    this.updateEnemyVisual(enemy, object);
  }

  private updateEnemyVisual(enemy: Enemy, object: Phaser.GameObjects.Container): void {
    const previousState = this.enemyVisualStates.get(enemy.id);
    const sprite = object.getByName('sprite') as Phaser.GameObjects.Sprite;
    const shadow = object.getByName('shadow') as Phaser.GameObjects.Ellipse;
    const isHug = enemy.kind === 'hug';
    const isMutated = isHug && enemy.mutated;
    const requesting = isHug && enemy.state === 'request';
    const calmed = isHug && enemy.state === 'calmed';
    const windup = enemy.state === 'windup';
    const mutationWarning = enemy.state === 'mutation-warning';
    // 容器里的字会跟着怪物被建筑和夜色盖住，真正的预警画在素材之上。
    (object.getByName('mutation-warning') as Phaser.GameObjects.Text).setVisible(false);
    const previousPosition = this.enemyLastPositions.get(enemy.id);
    const isMoving = !!previousPosition && distance(previousPosition, enemy.position) > 0.2;
    const mutatedNow = isMutated && !this.enemyMutatedStates.get(enemy.id);

    const desiredAnimation = monsterAnimationFor(enemy, isMoving);
    const currentAnimation = this.enemyAnimationKeys.get(enemy.id);

    if (enemy.state === 'dead') {
      if (currentAnimation !== desiredAnimation) {
        this.enemyAnimationKeys.set(enemy.id, desiredAnimation);
        sprite.anims.play(desiredAnimation, true);
      } else if (!sprite.anims.isPlaying) {
        this.enemyDeathFinished.add(enemy.id);
      }
    } else if (mutatedNow && this.anims.exists('squirrel-mutate')) {
      this.enemyAnimationKeys.set(enemy.id, 'squirrel-mutate');
      sprite.anims.play('squirrel-mutate', true);
      this.enemyMutatedStates.set(enemy.id, true);
    } else if (
      currentAnimation !== desiredAnimation &&
      this.anims.exists(desiredAnimation) &&
      // Finish the transformation unless combat needs an attack/hurt/death pose.
      !(
        currentAnimation === 'squirrel-mutate' &&
        sprite.anims.isPlaying &&
        !windup &&
        enemy.state !== 'stunned'
      )
    ) {
      this.enemyAnimationKeys.set(enemy.id, desiredAnimation);
      sprite.anims.play(desiredAnimation, true);
    }

    const baseScale = monsterScaleFor(enemy);
    const mutatedPulse = isMutated ? 1 + Math.sin(this.time.now / 190) * 0.025 : 1;
    sprite.setScale(baseScale * mutatedPulse);
    const lastPosition = this.enemyLastPositions.get(enemy.id);
    if (enemy.kind === 'amplifier' && windup && enemy.attackAngle !== undefined) {
      const cos = Math.cos(enemy.attackAngle);
      if (Math.abs(cos) > 0.05) sprite.setFlipX(cos < 0);
    } else if (lastPosition && Math.abs(enemy.position.x - lastPosition.x) > 0.05) {
      sprite.setFlipX(enemy.position.x < lastPosition.x);
    }
    sprite.setAlpha(
      monsterConcealed(enemy)
        ? monsterOpacityFor(enemy)
        : windup && enemy.kind !== 'amplifier'
          ? 0.72
          : calmed
            ? 0.78
            : 1,
    );
    if (mutationWarning) {
      sprite.setTint(0xffb347);
    } else if (enemy.kind === 'amplifier' && windup && enemy.windupLocked) {
      sprite.setTint(0xffb5be);
    } else {
      sprite.clearTint();
    }
    object.setRotation(requesting ? Math.sin(this.time.now / 45) * 0.035 : 0);
    shadow.setScale(isMutated ? 1.3 : isHug ? 1.05 : 0.9, 1);
    if (requesting && previousState !== 'request') this.playHugCry();
    this.enemyVisualStates.set(enemy.id, enemy.state);
    this.enemyMutatedStates.set(enemy.id, enemy.mutated);
    this.enemyLastPositions.set(enemy.id, { ...enemy.position });
  }

  private playHugCry(): void {
    this.services.sound.playHugCry();
  }

  private drawDirectionArrow(target: Point, color: number): void {
    if (!this.alerts) return;
    const direction = angleBetween(this.position, target);
    const base = {
      x: this.position.x + Math.cos(direction) * 28,
      y: this.position.y + Math.sin(direction) * 28,
    };
    const tip = {
      x: this.position.x + Math.cos(direction) * 62,
      y: this.position.y + Math.sin(direction) * 62,
    };
    const left = {
      x: tip.x - Math.cos(direction - Math.PI / 6) * 14,
      y: tip.y - Math.sin(direction - Math.PI / 6) * 14,
    };
    const right = {
      x: tip.x - Math.cos(direction + Math.PI / 6) * 14,
      y: tip.y - Math.sin(direction + Math.PI / 6) * 14,
    };
    this.alerts
      .lineStyle(4, color, 0.95)
      .strokeCircle(this.position.x, this.position.y, 24)
      .lineBetween(base.x, base.y, tip.x, tip.y)
      .lineBetween(tip.x, tip.y, left.x, left.y)
      .lineBetween(tip.x, tip.y, right.x, right.y);
  }

  private drawPlayAlerts(): void {
    for (const enemy of this.combat.enemies) {
      const label = this.warningLabels.get(enemy.id);
      if (!label) continue;
      const object = this.enemyObjects.get(enemy.id);
      const show = enemy.state === 'mutation-warning' && object?.visible === true;
      label.setVisible(show);
      if (!show) continue;
      label.setPosition(enemy.position.x, enemy.position.y - 96);
      label.setDepth(PLAY_ALERT_DEPTH);
    }
    const anchor = this.alertAnchor;
    this.alerts?.clear();
    if (anchor && this.alerts) {
      this.alerts.lineStyle(3, 0xeed5a4, 0.95).strokeCircle(anchor.x, anchor.y, 26);
      this.alerts.lineStyle(2, 0xf0d9a6, 0.85).strokeCircle(anchor.x, anchor.y, 40);
    }
    const view = this.services.controller.getView();
    const detectorTarget =
      this.detectorTargetId !== null &&
      this.time.now < this.detectorUntilMs &&
      (view.phase === 'active' || view.phase === 'extracting')
        ? this.searchPoints.find(
            (point) => point.id === this.detectorTargetId && !this.search.isOpened(point.id),
          )
        : undefined;
    if (detectorTarget) {
      this.drawDirectionArrow(detectorTarget, 0x8de0bd);
    } else if (this.detectorTargetId !== null) {
      this.detectorTargetId = null;
      this.detectorUntilMs = 0;
    }
    if (
      this.time.now < this.compassUntilMs &&
      (view.phase === 'active' || view.phase === 'extracting')
    ) {
      const questTarget = this.compassQuestTarget();
      const extractionTarget = this.extractionTarget();
      if (questTarget) this.drawDirectionArrow(questTarget, 0xf0d9a6);
      if (extractionTarget) this.drawDirectionArrow(extractionTarget, 0xc2a2ee);
    } else if (this.compassUntilMs !== 0) {
      this.compassUntilMs = 0;
    }
    const showSearch = anchor !== null && this.keyPrompt?.label === '搜索';
    this.searchAlert?.setVisible(showSearch);
    if (showSearch && anchor && this.searchAlert) {
      this.searchAlert.setPosition(anchor.x, anchor.y - 78);
      this.searchAlert.setDepth(PLAY_ALERT_DEPTH);
    }
  }

  private entityDepth(feetY: number): number {
    return ENTITY_DEPTH_BASE + Math.round(feetY);
  }

  private createCampusForeground(): void {
    this.foregroundObjects.length = 0;
    const mapImage = this.textures.get('campus-base').getSourceImage() as CanvasImageSource;
    for (const layer of CAMPUS_FOREGROUND) {
      this.textures.remove(layer.key);
      const texture = this.textures.createCanvas(layer.key, WORLD.width, WORLD.height);
      if (!texture) continue;
      const context = texture.getContext();
      context.save();
      context.beginPath();
      for (const outline of layer.outlines) {
        context.moveTo(outline[0]!.x, outline[0]!.y);
        for (const point of outline.slice(1)) context.lineTo(point.x, point.y);
        context.closePath();
      }
      context.clip();
      context.drawImage(mapImage, 0, 0, WORLD.width, WORLD.height);
      context.restore();
      texture.refresh();
      const object = this.add
        .image(0, 0, layer.key)
        .setOrigin(0)
        .setDepth(this.entityDepth(layer.feetY));
      this.foregroundObjects.push({ object, layer });
    }
  }

  drawBuilding(building: CampusBuilding): void {
    if (building.sub === 'SIYUAN') {
      this.drawSiyuanBuilding(building);
      return;
    }
    const palette = BUILDING_PALETTES[building.sub] ?? DEFAULT_BUILDING_PALETTE;
    const facadeHeight = Math.min(32, Math.max(20, Math.round(building.height * 0.12)));
    const g = this.add.graphics().setDepth(this.entityDepth(building.y + building.height));

    g.fillStyle(0x142d2d, 0.62);
    g.fillRoundedRect(building.x + 10, building.y + 12, building.width, building.height, 8);
    g.fillStyle(palette.wall);
    g.fillRoundedRect(building.x, building.y, building.width, building.height, 8);
    g.fillStyle(palette.roof);
    g.fillRoundedRect(
      building.x + 6,
      building.y + 5,
      building.width - 12,
      building.height - facadeHeight - 8,
      7,
    );
    g.fillStyle(palette.accent, 0.8);
    for (let x = building.x + 22; x < building.x + building.width - 18; x += 42) {
      g.fillRect(x, building.y + 24, 18, 10);
    }
    g.fillStyle(palette.facade);
    g.fillRect(
      building.x,
      building.y + building.height - facadeHeight,
      building.width,
      facadeHeight,
    );
    g.fillStyle(palette.accent, 0.9);
    g.fillRect(
      building.x + building.width / 2 - 16,
      building.y + building.height - facadeHeight + 5,
      32,
      facadeHeight - 5,
    );
    g.lineStyle(2, 0x3b3930, 0.5);
    g.strokeRoundedRect(building.x, building.y, building.width, building.height, 8);

    const roofFrame = building.sub === 'CANTEEN' || building.sub === 'TEACHING' ? 52 : 48;
    const roofDepth = this.entityDepth(building.y + building.height) + 1;
    const roofTop = building.y + 6;
    const roofBottom = building.y + building.height - facadeHeight - 8;
    for (let y = roofTop; y < roofBottom; y += 32) {
      for (let x = building.x + 8; x < building.x + building.width - 8; x += 32) {
        this.add
          .image(x, y, 'tiny-town-sheet', roofFrame)
          .setOrigin(0, 0)
          .setScale(2)
          .setDepth(roofDepth);
      }
    }
  }

  private drawSiyuanBuilding(building: CampusBuilding): void {
    const depth = this.entityDepth(building.y + building.height);
    const g = this.add.graphics().setDepth(depth);
    const centerX = building.x + building.width / 2;
    const roofX = building.x + 12;
    const roofY = building.y + 12;
    const roofWidth = building.width - 24;
    const roofHeight = building.height - 68;
    const facadeY = building.y + building.height - 56;
    const towerWidth = 52;

    g.fillStyle(0x10282d, 0.7);
    g.fillRoundedRect(building.x + 14, building.y + 18, building.width, building.height, 8);
    g.fillStyle(0xdbe4df);
    g.fillRect(building.x, building.y + 8, building.width, building.height - 8);
    g.fillStyle(0xb7c3bf);
    g.fillRect(building.x, facadeY, building.width, building.height - (facadeY - building.y));

    g.fillStyle(0x53666d);
    g.fillRect(roofX, roofY, roofWidth, roofHeight);
    g.fillStyle(0x6e7f83, 0.9);
    g.fillRect(roofX + 8, roofY + 8, roofWidth - 16, 9);
    g.lineStyle(2, 0x202f35, 0.9).strokeRect(roofX, roofY, roofWidth, roofHeight);
    g.lineStyle(1, 0x9aabad, 0.25);
    for (let y = roofY + 24; y < roofY + roofHeight; y += 18) {
      g.lineBetween(roofX + 8, y, roofX + roofWidth - 8, y);
    }

    for (const towerX of [building.x + 22, building.x + building.width - towerWidth - 22]) {
      g.fillStyle(0xcbd6d2);
      g.fillRect(towerX, building.y + 2, towerWidth, 58);
      g.fillStyle(0x87999d);
      g.fillRect(towerX + 8, building.y + 10, towerWidth - 16, 9);
      g.fillStyle(0x40555e);
      g.fillRect(towerX + 15, building.y + 26, towerWidth - 30, 24);
      g.fillStyle(0xb4d3d7, 0.65);
      g.fillRect(towerX + 20, building.y + 31, towerWidth - 40, 4);
    }
    g.fillStyle(0xcbd6d2);
    g.fillTriangle(
      centerX - 34,
      building.y + 42,
      centerX,
      building.y + 4,
      centerX + 34,
      building.y + 42,
    );
    g.fillStyle(0x4b626a);
    g.fillRect(centerX - 12, building.y + 6, 24, 28);
    g.fillStyle(0xa9d1d3, 0.65);
    g.fillRect(centerX - 6, building.y + 11, 12, 13);
    g.lineStyle(2, 0xcfd9d4, 0.9);
    g.lineBetween(centerX, building.y - 12, centerX, building.y + 4);

    const glassX = centerX - 30;
    const glassY = roofY + 28;
    const glassWidth = 60;
    const glassHeight = roofHeight - 44;
    g.fillStyle(0x1d536b);
    g.fillRect(glassX, glassY, glassWidth, glassHeight);
    g.fillStyle(0x73b8c8, 0.72);
    for (let x = glassX + 10; x < glassX + glassWidth; x += 13) {
      g.fillRect(x, glassY, 3, glassHeight);
    }
    for (let y = glassY + 15; y < glassY + glassHeight; y += 18) {
      g.fillRect(glassX, y, glassWidth, 3);
    }

    g.fillStyle(0xeff4ed);
    g.fillRect(building.x + 20, facadeY, building.width - 40, 40);
    g.fillStyle(0x668b96);
    for (let x = building.x + 32; x < building.x + building.width - 32; x += 32) {
      g.fillRect(x, facadeY + 9, 18, 12);
    }
    g.fillStyle(0x324e58);
    g.fillRect(centerX - 26, facadeY - 4, 52, 32);
    g.fillStyle(0x8ec8d0, 0.8);
    g.fillRect(centerX - 19, facadeY + 2, 38, 25);
    g.fillStyle(0xeff4ed);
    g.fillTriangle(centerX - 34, facadeY - 4, centerX, facadeY - 25, centerX + 34, facadeY - 4);
    g.lineStyle(2, 0x91a39f, 0.9).strokeRect(
      building.x,
      building.y + 8,
      building.width,
      building.height - 8,
    );
    this.add
      .text(centerX, building.y + 56, '北京交通大学', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '13px',
        fontStyle: 'bold',
        color: '#7b3644',
        stroke: '#f5f7f1',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setDepth(depth + 1);
  }

  private drawCampus(): void {
    this.groundImage = this.add.image(0, 0, 'campus-base').setOrigin(0).setDepth(-1);
    const stele = activeMap().stone;
    if (stele && this.textures.exists('minghu-stele')) {
      this.steleImage = this.add
        .image(stele.x, stele.y, 'minghu-stele')
        .setOrigin(0.5, 1)
        .setScale(0.82)
        .setDepth(this.entityDepth(stele.y) + 2);
    }
  }
}
