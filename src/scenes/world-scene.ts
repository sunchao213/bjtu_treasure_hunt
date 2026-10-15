import { isTouchLayout } from '../modules/ui/mobile-layout';
import Phaser from 'phaser';
import { COMBAT_RULES } from '../config/combat-config';
import {
  MONSTER_ANIMATIONS,
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
import { drawCampusOverview } from '../modules/world/campus-overview';
import type { RaidController } from '../modules/raid/raid-controller';
import type { EventBus } from '../shared/events/game-events';
import type { InventoryPort, ItemInstance, Point } from '../shared/types/game';
import type { TouchControls } from '../modules/world/touch-controls';
import type { SoundManager } from '../modules/ui/sound-manager';
import {
  isQuestComplete,
  prerequisiteHint,
  QUEST_COMPLETE_HINT,
} from '../modules/quests/quest-service';
import { evidenceStoryBeat } from '../modules/quests/chapter-content';

interface SceneServices {
  controller: RaidController;
  inventory: InventoryPort;
  events: EventBus;
  notify: (message: string) => void;
  touch: TouchControls;
  sound: SoundManager;
  onFrame: (interaction: string, progress: number) => void;
}

export class WorldScene extends Phaser.Scene {
  private position: Point = { ...WORLD.spawn };
  private player?: Phaser.GameObjects.Container;
  private aura?: Phaser.GameObjects.Arc;
  private searchPoints: LootSpawn[] = [];
  private darknessImage?: Phaser.GameObjects.Image;
  private darkness?: Phaser.Textures.CanvasTexture;
  private flashlight?: Phaser.GameObjects.Graphics;
  private extraction?: Phaser.GameObjects.Rectangle;
  private search = new SearchInteraction(RAID_RULES.searchDurationMs);
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private readonly chestObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly enemyObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly enemyVisualStates = new Map<string, EnemyState>();
  private readonly enemyAnimationKeys = new Map<string, string>();
  private readonly enemyDeathFinished = new Set<string>();
  private readonly enemyMutatedStates = new Map<string, boolean>();
  private readonly enemyLastPositions = new Map<string, Point>();
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
  private aim = -Math.PI / 2;
  private moving = false;
  private hurtThisFrame = false;
  private hurtFeedbackMs = 0;
  private attackFeedbackMs = 0;
  private hitStopMs = 0;
  private lastNightDraw = -Infinity;
  private readonly bounds = { x: 30, y: 35, width: WORLD.width - 60, height: WORLD.height - 70 };
  private interaction = '从右侧准备面板开始探索';
  private releaseDamage?: () => void;
  /** 交互条上的临时反馈：拾取结果、剧情提示等，在有效期内优先于常规提示显示。 */
  private banner: { text: string; untilMs: number } | null = null;

  constructor(private readonly services: SceneServices) {
    super('world');
  }

  preload(): void {
    for (const key of MONSTER_SPRITE_SHEETS) {
      this.load.spritesheet(key, `assets/characters/processed/${key}.png`, {
        frameWidth: 128,
        frameHeight: 128,
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

  create(): void {
    this.createEnemyAnimations();
    this.drawCampus();
    this.textures.remove('night-mask');
    this.darkness = this.textures.createCanvas('night-mask', 1, 1) ?? undefined;
    this.darknessImage = this.add.image(0, 0, 'night-mask').setOrigin(0).setDepth(40);
    this.flashlight = this.add.graphics().setDepth(41);
    for (const lamp of LAMPS) {
      this.add.rectangle(lamp.x, lamp.y, 10, 18, 0xffd27b).setDepth(42);
      this.add
        .text(lamp.x + 12, lamp.y - 8, '充电站', { fontSize: '12px', color: '#ffe6ac' })
        .setDepth(42);
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
    this.aura = this.add.circle(0, 0, 23, 0xa9e9d0, 0.12);
    const shadow = this.add.ellipse(0, 13, 30, 12, 0x061f23, 0.35);
    const body = this.add.rectangle(0, 0, 22, 28, 0xf3e2a7).setStrokeStyle(2, 0xffffff, 0.65);
    const head = this.add.circle(0, -16, 10, 0xffedd2);
    const bag = this.add.rectangle(-10, 3, 9, 16, 0xc18a48);
    this.player = this.add
      .container(this.position.x, this.position.y, [shadow, this.aura, body, head, bag])
      .setDepth(30);
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
    const resizeCamera = () => {
      this.cameras.main.setZoom(
        isTouchLayout() ? Math.max(0.75, Math.min(1, this.scale.width / 960)) : 1,
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
    this.hurtFeedbackMs = Math.max(0, this.hurtFeedbackMs - Math.max(0, deltaMs));
    this.attackFeedbackMs = Math.max(0, this.attackFeedbackMs - Math.max(0, deltaMs));
    this.hitStopMs = Math.max(0, this.hitStopMs - Math.max(0, deltaMs));
    const view = this.services.controller.getView();
    this.services.sound.setLoop('alarm', view.health > 0 && view.health < 20);
    if (view.raidId !== this.lastRaidId) {
      this.resetRaid(view.raidId);
    }
    const playable =
      !this.services.controller.isPaused() &&
      (view.phase === 'active' || view.phase === 'extracting');
    if (playable && this.hitStopMs <= 0) {
      this.hurtThisFrame = false;
      const isTyping =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLSelectElement;
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
        this.services.notify('安抚成功：怪物暂时平静，可以安全通过。');
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
        this.services.notify('安抚成功：怪物暂时平静，可以安全通过。');
      }
    } else if (!playable) {
      this.services.sound.setLoop('footsteps', false);
      this.search.cancel();
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
    const hug = this.combat.enemies.find((enemy) => enemy.state === 'request');
    const activeBanner =
      this.banner !== null && this.time.now < this.banner.untilMs ? this.banner.text : null;
    this.services.onFrame(
      activeBanner ?? this.interaction,
      hug ? hug.hugProgress / COMBAT_RULES.hug.calmHoldDurationMs : this.search.progress(),
    );
    this.drawNight();
    this.services.touch.finishFrame();
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
      if (overview) {
        drawCampusOverview(overview, this.position);
      }
      const mapDialog = document.querySelector<HTMLDialogElement>('#campus-map-dialog');
      const expanded = document.querySelector<HTMLCanvasElement>('#campus-map-expanded');
      if (mapDialog?.open && expanded) drawCampusOverview(expanded, this.position, true);
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
      object?.setPosition(enemy.position.x, enemy.position.y);
      const died = enemy.state === 'dead';
      if (object) {
        this.updateEnemyVisual(enemy, object);
        object.setVisible(visible && (!died || !this.enemyDeathFinished.has(enemy.id)));
      }
      if (visible && (!died || !this.enemyDeathFinished.has(enemy.id))) {
        this.flashlight
          .fillStyle(0x40202b)
          .fillRect(enemy.position.x - 18, enemy.position.y - 54, 36, 4);
        this.flashlight
          .fillStyle(enemy.mutated ? 0xff4e68 : 0xe4ae6b)
          .fillRect(
            enemy.position.x - 18,
            enemy.position.y - 54,
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
    const sprite = this.add
      .container(point.x, point.y, [
        this.add.circle(0, 0, 10, 0xffcc7c).setStrokeStyle(2, 0xffeed3),
        this.add.text(-7, -8, '拾', {
          fontFamily: 'Microsoft YaHei',
          fontSize: '13px',
          color: '#453d2d',
        }),
      ])
      .setDepth(12);
    this.ground.set(item.instanceId, { item, position: point, sprite });
  }

  private interact(held: boolean): void {
    const view = this.services.controller.getView();
    if (view.phase !== 'active' && view.phase !== 'extracting') {
      this.search.cancel();
      return;
    }
    const carried = this.services.inventory.getCarriedItems();
    const bagFull = carried.length >= RAID_RULES.bagCapacity;
    const hug = this.combat.enemies.find(
      (enemy) =>
        enemy.state === 'request' &&
        distance(enemy.position, this.position) < COMBAT_RULES.hug.calmRange,
    );
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
        this.interaction = '背包已满 · 先丢弃或替换物品再拾取';
        return;
      }
      this.interaction = '按 E 拾取脚边物品';
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
      this.interaction = `长按 E 搜索 · ${ITEM_DEFINITIONS[chest.itemId]?.name ?? '物资'}`;
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
        this.interaction = hug
          ? `长按 Q 安抚抱抱怪 · 剩余 ${Math.ceil(hug.timer / 1000)} 秒`
          : '校园夜巡';
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
    this.lastNightDraw = -Infinity;
    this.player?.setPosition(this.position.x, this.position.y);
    for (const object of this.chestObjects.values()) {
      object.destroy();
    }
    this.chestObjects.clear();
    this.searchPoints = raidId ? generateLootSpawns() : [];
    for (const point of this.searchPoints) {
      const halo = this.add.circle(0, 0, 23, 0xe3bf79, 0.09);
      const chest = this.add.rectangle(0, 0, 24, 18, 0xc99f60).setStrokeStyle(2, 0xffdc96);
      const seam = this.add.rectangle(0, 0, 3, 18, 0x594523);
      this.chestObjects.set(
        point.id,
        this.add
          .container(point.x, point.y, [halo, chest, seam])
          .setName(`chest-${point.id}`)
          .setDepth(10)
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
    const shadow = this.add.ellipse(0, 0, 34, 10, 0x061f23, 0.38).setName('shadow');
    const sprite = this.add
      .sprite(
        0,
        0,
        isMutated ? 'squirrel-mutant-idle' : enemy.kind === 'hug' ? 'squirrel-idle' : 'duck-idle',
      )
      .setName('sprite')
      .setOrigin(0.5, 1);
    const warning = this.add
      .text(0, -76, '即将变异 · 远离', {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: '18px',
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
      .setDepth(25);
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
      if (!this.enemyDeathFinished.has(enemy.id) && currentAnimation !== desiredAnimation) {
        this.enemyAnimationKeys.set(enemy.id, desiredAnimation);
        sprite.anims.play(desiredAnimation, true);
        sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
          this.enemyDeathFinished.add(enemy.id);
          object.setVisible(false);
        });
      }
    } else if (mutatedNow && this.anims.exists('squirrel-mutate')) {
      this.enemyAnimationKeys.set(enemy.id, 'squirrel-mutate');
      sprite.anims.play('squirrel-mutate', true);
      sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
        if (enemy.state !== 'dead' && enemy.mutated) {
          this.enemyAnimationKeys.set(enemy.id, 'squirrel-mutant-idle');
          sprite.anims.play('squirrel-mutant-idle', true);
        }
      });
      this.enemyMutatedStates.set(enemy.id, true);
    } else if (currentAnimation !== desiredAnimation && this.anims.exists(desiredAnimation)) {
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

  private addLandmarkLabel(
    x: number,
    y: number,
    name: string,
    width: number,
    primary = false,
  ): void {
    this.add
      .text(x, y, name, {
        fontFamily: 'Microsoft YaHei, sans-serif',
        fontSize: primary ? '30px' : '24px',
        fontStyle: 'bold',
        color: primary ? '#ffe3a0' : '#f2f6ef',
        backgroundColor: '#14221e',
        stroke: '#14221e',
        strokeThickness: 2,
        padding: { x: 10, y: 6 },
        align: 'center',
        wordWrap: { width: width - 20, useAdvancedWrap: true },
      })
      .setOrigin(0.5)
      .setDepth(44);
  }

  private drawCampus(): void {
    const g = this.add.graphics();
    g.fillStyle(0x263c32);
    g.fillRect(0, 0, WORLD.width, WORLD.height);
    g.lineStyle(3, 0x72816e, 0.6).strokeRect(45, 50, WORLD.width - 90, WORLD.height - 90);
    g.fillStyle(0x68716d, 0.65);
    for (const road of WORLD.roads) {
      g.fillRect(road.x, road.y, road.width, road.height);
    }
    for (const sports of WORLD.sportsFields) {
      g.fillStyle(0x75685d).fillRoundedRect(sports.x, sports.y, sports.width, sports.height, 75);
      g.fillStyle(0x345844).fillRoundedRect(
        sports.x + 25,
        sports.y + 20,
        sports.width - 50,
        sports.height - 40,
        50,
      );
      g.lineStyle(2, 0xb3c0a5, 0.8).strokeRect(
        sports.x + 45,
        sports.y + 55,
        sports.width - 90,
        sports.height - 110,
      );
      g.lineBetween(
        sports.x + 45,
        sports.y + sports.height / 2,
        sports.x + sports.width - 45,
        sports.y + sports.height / 2,
      );
      g.strokeCircle(sports.x + sports.width / 2, sports.y + sports.height / 2, 22);
      this.addLandmarkLabel(
        sports.x + sports.width / 2,
        sports.y + sports.height / 2,
        sports.name,
        sports.width,
        true,
      );
    }
    const garden = WORLD.garden;
    g.fillStyle(0x3e6148).fillRoundedRect(garden.x, garden.y, garden.width, garden.height, 40);
    this.addLandmarkLabel(
      garden.x + garden.width / 2,
      garden.y + garden.height / 2,
      garden.name,
      garden.width,
      true,
    );
    for (let i = 0; i < 40; i++) {
      const x = 70 + i * 82;
      g.fillStyle(0x335a4c);
      g.fillCircle(x, 50, 17);
      g.fillStyle(0x53775a);
      g.fillCircle(x - 5, 46, 10);
    }
    for (const building of WORLD.buildings) {
      g.fillStyle(0x0d2e32, 0.6);
      g.fillRoundedRect(building.x + 8, building.y + 10, building.width, building.height, 5);
      g.fillStyle(building.color);
      g.fillRoundedRect(building.x, building.y, building.width, building.height, 5);
      g.fillStyle(0xb9bf9b);
      g.fillRect(building.x + 9, building.y + 9, building.width - 18, 10);
      this.addLandmarkLabel(
        building.x + building.width / 2,
        building.y + building.height / 2,
        building.name,
        building.width,
        ['思源楼', '图书馆'].includes(building.name),
      );
    }
    const lake = WORLD.lake;
    g.fillStyle(0x365b57);
    g.fillRoundedRect(lake.x - 8, lake.y - 8, lake.width + 16, lake.height + 16, 26);
    g.fillStyle(0x326b70);
    g.fillRoundedRect(lake.x, lake.y, lake.width, lake.height, 22);
    g.lineStyle(2, 0x82b3a3, 0.45);
    for (let y = lake.y + 25; y < lake.y + lake.height - 10; y += 25) {
      g.lineBetween(lake.x + 20, y, lake.x + lake.width - 20, y);
    }
    this.addLandmarkLabel(
      lake.x + lake.width / 2,
      lake.y + lake.height / 2,
      '明湖',
      lake.width,
      true,
    );
    const clue = WORLD.stone;
    g.fillStyle(0x9fa89b).fillRect(clue.x - 7, clue.y - 26, 14, 21);
    this.addLandmarkLabel(clue.x, clue.y + 19, '明湖石碑', 190);
    for (const gate of WORLD.gates) {
      const isExtraction = gate.role === 'extraction';
      this.add
        .circle(gate.x, gate.y, isExtraction ? 13 : 8, isExtraction ? 0x8cdeb2 : 0xd3c08d, 0.9)
        .setStrokeStyle(2, 0x17251e, 0.95)
        .setDepth(8);
      this.add
        .text(gate.x, gate.y, gate.name, {
          fontFamily: 'Microsoft YaHei, sans-serif',
          fontSize: '24px',
          fontStyle: 'bold',
          color: isExtraction ? '#baf4d4' : '#e0d8b9',
          backgroundColor: isExtraction ? '#173f32' : '#29352f',
          padding: { x: 6, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(43);
    }
    this.add.text(45, WORLD.height - 31, '依据小组提供的海淀主校区地图简化制作，非 1:1 测绘', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '13px',
      color: '#97b1a1',
    });
  }
}
