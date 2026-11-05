import { isTouchLayout } from '../modules/ui/mobile-layout';
import Phaser from 'phaser';
import { COMBAT_RULES } from '../config/combat-config';
import {
  MONSTER_ANIMATIONS,
  MONSTER_FRAME_SIZE,
  MONSTER_SPRITE_SHEETS,
  monsterAnimationFor,
  monsterScaleFor,
} from '../config/monster-sprites';
import { generateLootSpawns, type LootSpawn } from '../modules/world/loot-spawns';
import { WORLD } from '../config/world-config';
import { ITEM_DEFINITIONS, RAID_RULES } from '../config/game-config';
import { contains, movePlayer } from '../modules/world/movement';
import { SearchInteraction } from '../modules/world/search-interaction';
import {
  NightCombat,
  NightLighting,
  type Enemy,
  type EnemyState,
  angleBetween,
  distance,
  findEnemySpawnPosition,
  lineOfSight,
  LAMPS,
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
import {
  isQuestComplete,
  prerequisiteHint,
  QUEST_COMPLETE_HINT,
} from '../modules/quests/quest-service';
import { evidenceStoryBeat } from '../modules/quests/chapter-content';

export interface KeyPrompt {
  readonly key: 'E' | 'Q';
  readonly label: string;
}

interface SceneServices {
  controller: RaidControllerPort;
  inventory: InventoryPort;
  events: EventBus;
  notify: (message: string) => void;
  touch: TouchControls;
  sound: SoundManager;
  onFrame: (interaction: string, progress: number, prompt: KeyPrompt | null) => void;
  onInput?: (input: PlayerInput) => void;
  isOnline?: () => boolean;
}

const ENTITY_DEPTH_BASE = 100;
const NIGHT_MASK_DEPTH = 4000;
const EFFECTS_DEPTH = 4100;

type CampusBuilding = (typeof WORLD.buildings)[number];
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

export class WorldScene extends Phaser.Scene {
  private position: Point = { ...WORLD.spawn };
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
  private extraction?: Phaser.GameObjects.Rectangle;
  private search = new SearchInteraction(RAID_RULES.searchDurationMs);
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private readonly chestObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly chestSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly enemyObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly enemyVisualStates = new Map<string, EnemyState>();
  private readonly enemyAnimationKeys = new Map<string, string>();
  private readonly enemyDeathFinished = new Set<string>();
  private readonly enemyMutatedStates = new Map<string, boolean>();
  private readonly enemyLastPositions = new Map<string, Point>();
  private readonly remotePlayerObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly remotePlayerTargets = new Map<string, RemotePlayerSnapshot>();
  private onlineSnapshot: GameSnapshot | null = null;
  private readonly ground = new Map<
    string,
    { item: ItemInstance; position: Point; sprite: Phaser.GameObjects.Container }
  >();
  private lastRaidId: string | null = null;
  private previousInteract = false;
  private previousAttack = false;
  private previousFlare = false;
  private previousLight = false;
  private previousRefill = false;
  private readonly lighting = new NightLighting();
  private readonly combat = new NightCombat();
  private readonly exploredMap = createExploredMap();
  private aim = -Math.PI / 2;
  private moving = false;
  private hurtThisFrame = false;
  private hurtFeedbackMs = 0;
  private attackFeedbackMs = 0;
  private hitStopMs = 0;
  private lastNightDraw = -Infinity;
  private readonly bounds = { x: 30, y: 35, width: WORLD.width - 60, height: WORLD.height - 70 };
  private interaction = '在准备页确认风险后开始探索';
  private keyPrompt: KeyPrompt | null = null;
  private releaseDamage?: () => void;
  /** 交互条上的临时反馈：拾取结果、剧情提示等，在有效期内优先于常规提示显示。 */
  private banner: { text: string; untilMs: number } | null = null;

  constructor(private readonly services: SceneServices) {
    super('world');
  }

  preload(): void {
    this.load.image('campus-base', 'assets/maps/campus-night/campus-base.jpg');
    this.load.spritesheet('treasure-chest', 'assets/props/treasure-chest.png', {
      frameWidth: 256,
      frameHeight: 256,
    });
    for (const state of ['idle', 'walk', 'attack', 'hurt', 'death']) {
      this.load.spritesheet(`player-${state}`, `assets/characters/player/player-${state}.png`, {
        frameWidth: 128,
        frameHeight: 160,
      });
    }
    this.load.spritesheet(
      'tiny-town-sheet',
      'assets/environment/kenney-tiny-town/Tilemap/tilemap_packed.png',
      { frameWidth: 16, frameHeight: 16 },
    );
    for (const key of MONSTER_SPRITE_SHEETS) {
      this.load.spritesheet(key, `assets/characters/processed/${key}.png`, {
        frameWidth: MONSTER_FRAME_SIZE,
        frameHeight: MONSTER_FRAME_SIZE,
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

  clearInteractions(): void {
    this.search.cancel();
    this.services.touch.reset();
    this.input?.keyboard?.resetKeys();
    for (const enemy of this.combat.enemies) {
      enemy.hugProgress = 0;
    }
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
    for (const lamp of LAMPS) {
      this.add.rectangle(lamp.x, lamp.y, 10, 18, 0xffd27b).setDepth(this.entityDepth(lamp.y));
    }
    this.extraction = this.add
      .rectangle(
        WORLD.extraction.x + WORLD.extraction.width / 2,
        WORLD.extraction.y + WORLD.extraction.height / 2,
        WORLD.extraction.width,
        WORLD.extraction.height,
        0x74d2b1,
        0.12,
      )
      .setStrokeStyle(2, 0x74d2b1, 0.8);
    this.extraction.setDepth(20);
    this.aura = this.add.circle(0, 0, 23, 0xa9e9d0, 0.12);
    const shadow = this.add.ellipse(0, 10, 25, 9, 0x061f23, 0.35);
    this.playerSprite = this.add
      .sprite(0, 0, 'player-idle', 0)
      .setName('sprite')
      .setOrigin(0.5, 1)
      .setScale(0.44);
    this.player = this.add
      .container(this.position.x, this.position.y, [shadow, this.aura, this.playerSprite])
      .setDepth(this.entityDepth(this.position.y));
    this.playPlayerAnimation('idle', this.playerFacing);
    for (const enemy of this.combat.enemies) {
      this.addEnemyObject(enemy);
    }
    const keyboard = this.input.keyboard;
    if (keyboard) {
      for (const key of [
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
      ]) {
        this.keys[key] = keyboard.addKey(key);
      }
    }
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.cameras.main.setFollowOffset(0, -36);
    const resizeCamera = () => {
      this.cameras.main.setZoom(
        isTouchLayout() ? Math.max(1.12, Math.min(1.5, (this.scale.width / 960) * 1.38)) : 1.7,
      );
    };
    resizeCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, resizeCamera);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (isTouchLayout()) return;
      const target = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.aim = angleBetween(this.position, target);
    });
    this.releaseDamage = this.services.events.on('DamageTaken', ({ amount, health }) => {
      this.services.sound.play('behit');
      this.services.sound.setLoop('alarm', health > 0 && health < 20);
      this.hurtThisFrame = true;
      this.hurtFeedbackMs = COMBAT_RULES.feedback.playerHighlightMs;
      this.setPlayerAction('hurt', COMBAT_RULES.feedback.playerHighlightMs);
      this.search.cancel();
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
        this.search.cancel();
        this.services.controller.cancelExtraction();
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.releaseDamage?.();
      document.removeEventListener('visibilitychange', onHidden);
      keyboard?.removeAllKeys(true);
      this.scale.off(Phaser.Scale.Events.RESIZE, resizeCamera);
    });
  }

  update(_time: number, deltaMs: number): void {
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
    this.services.sound.setLoop('alarm', view.health > 0 && view.health < 20);
    if (view.raidId !== this.lastRaidId) {
      this.resetRaid(view.raidId);
    }
    if (this.services.isOnline?.()) {
      const snapshot = this.onlineSnapshot;
      const focused = document.activeElement;
      const isTyping =
        (focused instanceof HTMLInputElement &&
          !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].includes(
            focused.type,
          )) ||
        focused instanceof HTMLSelectElement;
      const down = (key: string) =>
        this.services.touch.held(key) || (!isTyping && (this.keys[key]?.isDown ?? false));
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
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.aim = angleBetween(this.position, worldPoint);
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
      this.services.touch.finishFrame();
      return;
    }
    const playable =
      !this.services.controller.isPaused() &&
      (view.phase === 'active' || view.phase === 'extracting');
    if (playable && this.hitStopMs <= 0) {
      this.hurtThisFrame = false;
      const focused = document.activeElement;
      const isTyping =
        (focused instanceof HTMLInputElement &&
          !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file'].includes(
            focused.type,
          )) ||
        focused instanceof HTMLSelectElement;
      const down = (key: string) =>
        this.services.touch.held(key) || (!isTyping && (this.keys[key]?.isDown ?? false));
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
      this.moving = Math.hypot(movement.x, movement.y) > 0.1;
      this.services.sound.setLoop('footsteps', this.moving);
      if (this.moving) {
        this.search.cancel();
      }
      this.position = movePlayer(
        this.position,
        movement,
        deltaMs,
        WORLD.playerSpeed,
        WORLD.playerRadius,
        { x: 30, y: 35, width: WORLD.width - 60, height: WORLD.height - 70 },
        WORLD.obstacles,
      );
      this.player?.setPosition(this.position.x, this.position.y);
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
        const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
        this.aim = angleBetween(this.position, worldPoint);
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
        this.search.cancel();
        const carriedItems = this.services.inventory.getCarriedItems();
        const weaponItem = carriedItems.find(
          (item) => ITEM_DEFINITIONS[item.itemId]?.kind === 'weapon',
        );
        if (!weaponItem) {
          if (!this.previousAttack) {
            this.services.notify('未携带武器，无法攻击。');
          }
        } else {
          const stunBaton = weaponItem.itemId === 'stun-baton';
          const weapon = stunBaton
            ? COMBAT_RULES.player.attack.weapons.stunBaton
            : COMBAT_RULES.player.attack.weapons.trainingBat;
          if (
            stunBaton &&
            this.combat.currentWeaponId === 'stun-baton' &&
            this.combat.weaponUsesRemaining === 0
          ) {
            if (!this.previousAttack) {
              this.services.notify('电击器已用尽。');
            }
            this.previousAttack = down('SPACE');
          }
          const previousCooldown = this.combat.attackCooldown;
          const defeated = this.combat.attack(
            this.position,
            this.aim,
            WORLD.obstacles,
            weapon.damage,
            stunBaton ? 'stun-baton' : 'training-bat',
          );
          if (previousCooldown <= 0 && this.combat.attackCooldown > 0) {
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
        WORLD.obstacles,
        this.bounds,
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
      if (combat.damage) {
        this.services.controller.applyDamage(combat.damage);
      }
      if (combat.calmed.length > 0) {
        this.services.notify('抱抱成功，怪物平静约 30 秒，不会掉落物品。');
      }
      this.services.controller.setExtractionPresence(contains(WORLD.extraction, this.position));
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
        WORLD.obstacles,
        this.bounds,
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
      if (combat.damage) {
        this.services.controller.applyDamage(combat.damage);
      }
      if (combat.calmed.length > 0) {
        this.services.notify('抱抱成功，怪物平静约 30 秒，不会掉落物品。');
      }
    } else if (!playable) {
      this.services.sound.setLoop('footsteps', false);
      this.search.cancel();
      if (view.health <= 0) {
        this.setPlayerAction('death', Number.POSITIVE_INFINITY);
      }
      this.interaction = this.services.controller.isPaused()
        ? '已暂停 · 横屏并关闭规则 / 校园图 / 图鉴后继续'
        : view.phase === 'preparing'
          ? '准备好后，开始本次校园探索'
          : '本次探索已结束，请查看结算';
    }
    this.services.controller.tick();
    const current = this.services.controller.getView();
    this.extraction?.setFillStyle(current.value >= current.threshold ? 0x77d4a8 : 0x667a77, 0.24);
    this.extraction?.setStrokeStyle(2, current.value >= current.threshold ? 0x97ecc6 : 0x738984);
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
    this.services.touch.finishFrame();
  }

  private createPlayerAnimations(): void {
    const definitions = [
      { action: 'idle', frames: 5, frameRate: 4, repeat: -1 },
      { action: 'walk', frames: 5, frameRate: 9, repeat: -1 },
      { action: 'attack', frames: 5, frameRate: 14, repeat: 0 },
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

  private directionFromAngle(angle: number): PlayerDirection {
    const horizontal = Math.cos(angle);
    const vertical = Math.sin(angle);
    if (Math.abs(horizontal) > Math.abs(vertical)) {
      return horizontal < 0 ? 'left' : 'right';
    }
    return vertical < 0 ? 'up' : 'down';
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
        WORLD.obstacles,
        origin,
      );
      this.darkness.refresh();
      const overview = document.querySelector<HTMLCanvasElement>('#campus-overview');
      const mapImage = this.textures.get('campus-base').getSourceImage() as CanvasImageSource;
      if (overview) {
        drawCampusOverview(overview, this.position, mapImage, this.exploredMap, {
          followPlayer: true,
          viewRadius: 320,
        });
      }
      const mapDialog = document.querySelector<HTMLDialogElement>('#campus-map-dialog');
      const expanded = document.querySelector<HTMLCanvasElement>('#campus-map-expanded');
      if (mapDialog?.open && expanded) {
        drawCampusOverview(expanded, this.position, mapImage, this.exploredMap);
      }
      this.lastNightDraw = this.time.now;
    }
    this.flashlight.clear();
    if (this.combat.swingMs > 0) {
      const carriedWeapon = this.services.inventory
        .getCarriedItems()
        .find((item) => ITEM_DEFINITIONS[item.itemId]?.kind === 'weapon');
      const swingWeapon =
        carriedWeapon?.itemId === 'stun-baton'
          ? COMBAT_RULES.player.attack.weapons.stunBaton
          : COMBAT_RULES.player.attack.weapons.trainingBat;
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
      const visible = this.lighting.visible(
        enemy.position,
        this.position,
        this.aim,
        WORLD.obstacles,
      );
      const object = this.enemyObjects.get(enemy.id);
      object
        ?.setPosition(enemy.position.x, enemy.position.y)
        .setDepth(this.entityDepth(enemy.position.y));
      const died = enemy.state === 'dead';
      if (object) {
        this.updateEnemyVisual(enemy, object);
        object.setVisible(visible && (!died || !this.enemyDeathFinished.has(enemy.id)));
      }
      if (visible && (!died || !this.enemyDeathFinished.has(enemy.id))) {
        this.flashlight
          .fillStyle(0x40202b)
          .fillRect(enemy.position.x - 18, enemy.position.y - 70, 36, 4);
        this.flashlight
          .fillStyle(enemy.mutated ? 0xff4e68 : 0xe4ae6b)
          .fillRect(
            enemy.position.x - 18,
            enemy.position.y - 70,
            (36 * enemy.health) /
              (enemy.kind === 'hug' ? COMBAT_RULES.hug.health : COMBAT_RULES.enemy.patrol.health),
            4,
          );
        if (enemy.state === 'mutation-warning') {
          this.flashlight
            .lineStyle(4, 0xffb347, 0.65 + Math.sin(this.time.now / 75) * 0.3)
            .strokeCircle(enemy.position.x, enemy.position.y, 48);
        }
        if (enemy.state === 'windup') {
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
    for (const point of this.searchPoints) {
      this.chestObjects
        .get(point.id)
        ?.setVisible(
          this.lighting.flashlightReveals(point, this.position, this.aim, WORLD.obstacles),
        );
    }
    for (const drop of this.ground.values()) {
      drop.sprite.setVisible(
        this.lighting.visible(drop.position, this.position, this.aim, WORLD.obstacles),
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
          lineOfSight(this.position, enemy.position, WORLD.obstacles),
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
    const carried = this.services.inventory.getCarriedItems();
    const bagFull = carried.length >= RAID_RULES.bagCapacity;
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
          lineOfSight(this.position, drop.position, WORLD.obstacles),
      )
      .sort((a, b) => distance(a.position, this.position) - distance(b.position, this.position))[0];
    if (loot) {
      this.search.cancel();
      if (bagFull) {
        this.interaction = `背包已满 · ${ITEM_DEFINITIONS[loot.item.itemId]?.name ?? loot.item.itemId}留在地上，先腾出空间再拾取`;
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
        this.lighting.flashlightReveals(point, this.position, this.aim, WORLD.obstacles),
    );
    if (chest) {
      const prerequisite = prerequisiteHint(chest.itemId, carried, view.raidId);
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
      this.interaction = '长按 E 搜索';
      this.keyPrompt = { key: 'E', label: '搜索' };
      if (!held || this.moving || view.phase !== 'active') {
        this.search.cancel();
        return;
      }
      const wasSearching = this.search.current() === chest.id;
      this.search.begin(chest.id);
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
          this.chestSprites.get(chest.id)?.play('treasure-chest-open');
          this.chestObjects.get(chest.id)?.setAlpha(0.23);
          this.services.events.emit('LocationInteracted', {
            raidId: view.raidId,
            locationId: chest.id,
          });
          if (isQuestComplete(this.services.inventory.getCarriedItems(), view.raidId)) {
            this.services.controller.setQuestComplete(true);
          }
        }
        if (result.ok) {
          const definition = ITEM_DEFINITIONS[chest.itemId];
          const beat = isQuestComplete(this.services.inventory.getCarriedItems(), view.raidId)
            ? QUEST_COMPLETE_HINT
            : evidenceStoryBeat(chest.itemId);
          const pickup =
            beat ??
            `已拾取：${definition?.name ?? chest.itemId}${
              definition ? `（本局价值 ${RAID_RULES.values[definition.rarity]}）` : ''
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
      const lamp = LAMPS.find((source) => distance(source, this.position) < 55);
      if (lamp && this.lighting.battery < 99) {
        this.interaction = '灯站充电';
        if (held && !this.moving && !this.hurtThisFrame) {
          this.search.begin(`charge:${lamp.x}`);
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
        this.interaction = request ? this.hugInstruction(request) : '校园夜巡';
      }
    }
  }

  private resetRaid(raidId: string | null): void {
    this.lastRaidId = raidId;
    this.services.sound.setLoop('alarm', false);
    this.hurtFeedbackMs = 0;
    this.attackFeedbackMs = 0;
    this.hitStopMs = 0;
    this.banner = null;
    this.position = { ...WORLD.spawn };
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
    this.searchPoints = raidId ? generateLootSpawns() : [];
    for (const point of this.searchPoints) {
      const halo = this.add.circle(0, 0, 23, 0xe3bf79, 0.09);
      const chest = this.add
        .sprite(0, 0, 'treasure-chest', 2)
        .setName('chest-sprite')
        .setOrigin(0.5, 1)
        .setScale(0.26);
      this.chestSprites.set(point.id, chest);
      this.chestObjects.set(
        point.id,
        this.add
          .container(point.x, point.y, [halo, chest])
          .setName(`chest-${point.id}`)
          .setDepth(this.entityDepth(point.y) - 1)
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
  }

  private createChestAnimations(): void {
    if (!this.textures.exists('treasure-chest') || this.anims.exists('treasure-chest-open')) {
      return;
    }
    this.anims.create({
      key: 'treasure-chest-open',
      frames: this.anims.generateFrameNumbers('treasure-chest', { start: 3, end: 5 }),
      frameRate: 8,
      repeat: 0,
    });
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
      .sprite(
        0,
        0,
        isMutated ? 'squirrel-mutant-idle' : enemy.kind === 'hug' ? 'squirrel-idle' : 'duck-idle',
      )
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
    (object.getByName('mutation-warning') as Phaser.GameObjects.Text).setVisible(mutationWarning);
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
    if (lastPosition && Math.abs(enemy.position.x - lastPosition.x) > 0.05) {
      sprite.setFlipX(enemy.position.x < lastPosition.x);
    }
    sprite.setAlpha(windup ? 0.72 : calmed ? 0.78 : 1);
    if (mutationWarning) {
      sprite.setTint(0xffb347);
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

  private entityDepth(feetY: number): number {
    return ENTITY_DEPTH_BASE + Math.round(feetY);
  }

  private createCampusForeground(): void {
    this.textures.remove('campus-foreground');
    this.textures.remove('pillar-landmark-foreground');
    this.textures.remove('flagpole-landmark-foreground');
    const texture = this.textures.createCanvas('campus-foreground', WORLD.width, WORLD.height);
    if (!texture) return;

    const context = texture.getContext();
    const mapImage = this.textures.get('campus-base').getSourceImage() as CanvasImageSource;
    context.drawImage(mapImage, 0, 0, WORLD.width, WORLD.height);
    const pixels = context.getImageData(0, 0, WORLD.width, WORLD.height);
    for (let y = 0; y < WORLD.height; y++) {
      for (let x = 0; x < WORLD.width; x++) {
        const index = (y * WORLD.width + x) * 4;
        // Only the green-marked parts sit in front of the player. The upper
        // outer arch remains part of the background so a player above it can
        // appear on top, as marked by the white outline.
        const signBand = x >= 158 && x <= 322 && y >= 1335 && y <= 1420;
        const outerInnerArch = (x - 255) ** 2 / 120 ** 2 + (y - 1465) ** 2 / 132 ** 2 <= 1;
        const doorwayCutout = (x - 255) ** 2 / 82 ** 2 + (y - 1475) ** 2 / 101 ** 2 <= 1;
        const innerArchRim = outerInnerArch && !doorwayCutout && y >= 1400 && y <= 1530;
        const leftPillar = x >= 142 && x <= 181 && y >= 1440 && y <= 1760;
        const rightPillar = x >= 330 && x <= 369 && y >= 1440 && y <= 1760;
        const isSouthGateForeground = signBand || innerArchRim || leftPillar || rightPillar;
        if (!isSouthGateForeground) pixels.data[index + 3] = 0;
      }
    }
    context.putImageData(pixels, 0, 0);
    texture.refresh();
    this.add
      .image(0, 0, 'campus-foreground')
      .setOrigin(0)
      .setDepth(ENTITY_DEPTH_BASE + WORLD.height + 10);

    const pillarTexture = this.textures.createCanvas(
      'pillar-landmark-foreground',
      WORLD.width,
      WORLD.height,
    );
    if (!pillarTexture) return;
    const pillarContext = pillarTexture.getContext();
    pillarContext.drawImage(mapImage, 0, 0, WORLD.width, WORLD.height);
    const pillarPixels = pillarContext.getImageData(0, 0, WORLD.width, WORLD.height);
    for (let y = 0; y < WORLD.height; y++) {
      for (let x = 0; x < WORLD.width; x++) {
        const ringDistance = ((x - 260) / 42) ** 2 + ((y - 978) / 39) ** 2;
        const ringOpening = ((x - 260) / 29) ** 2 + ((y - 978) / 27) ** 2;
        const isRing = ringDistance <= 1 && ringOpening >= 1;
        const isTop = x >= 235 && x <= 286 && y >= 954 && y <= 1025;
        const isCapital = x >= 220 && x <= 302 && y >= 1018 && y <= 1050;
        const isColumn = x >= 230 && x <= 291 && y >= 1040 && y <= 1152;
        const isBase = x >= 204 && x <= 334 && y >= 1142 && y <= 1192;
        const isPillarLandmark = isRing || isTop || isCapital || isColumn || isBase;
        if (!isPillarLandmark) pillarPixels.data[(y * WORLD.width + x) * 4 + 3] = 0;
      }
    }
    pillarContext.putImageData(pillarPixels, 0, 0);
    pillarTexture.refresh();
    this.add
      .image(0, 0, 'pillar-landmark-foreground')
      .setOrigin(0)
      .setDepth(this.entityDepth(1190));

    const flagpoleTexture = this.textures.createCanvas(
      'flagpole-landmark-foreground',
      WORLD.width,
      WORLD.height,
    );
    if (!flagpoleTexture) return;
    const flagpoleContext = flagpoleTexture.getContext();
    flagpoleContext.drawImage(mapImage, 0, 0, WORLD.width, WORLD.height);
    const flagpolePixels = flagpoleContext.getImageData(0, 0, WORLD.width, WORLD.height);
    const flagPolygon = [
      { x: 202, y: 632 },
      { x: 262, y: 614 },
      { x: 263, y: 665 },
      { x: 213, y: 674 },
      { x: 204, y: 662 },
    ];
    const insideFlag = (x: number, y: number) => {
      let inside = false;
      for (let i = 0, j = flagPolygon.length - 1; i < flagPolygon.length; j = i++) {
        const a = flagPolygon[i]!;
        const b = flagPolygon[j]!;
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) {
          inside = !inside;
        }
      }
      return inside;
    };
    for (let y = 0; y < WORLD.height; y++) {
      for (let x = 0; x < WORLD.width; x++) {
        const isFlagpole =
          insideFlag(x, y) ||
          (x >= 260 && x <= 269 && y >= 610 && y <= 833) ||
          (x >= 253 && x <= 279 && y >= 819 && y <= 842) ||
          (x >= 223 && x <= 301 && y >= 831 && y <= 879);
        if (!isFlagpole) flagpolePixels.data[(y * WORLD.width + x) * 4 + 3] = 0;
      }
    }
    flagpoleContext.putImageData(flagpolePixels, 0, 0);
    flagpoleTexture.refresh();
    this.add
      .image(0, 0, 'flagpole-landmark-foreground')
      .setOrigin(0)
      .setDepth(this.entityDepth(879));
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
    this.add.image(0, 0, 'campus-base').setOrigin(0).setDepth(-1);
  }
}
