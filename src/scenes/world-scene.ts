import Phaser from 'phaser';
import { WORLD } from '../config/world-config';
import { ITEM_DEFINITIONS, RAID_RULES } from '../config/game-config';
import { contains, movePlayer } from '../modules/world/movement';
import { SearchInteraction } from '../modules/world/search-interaction';
import {
  NightCombat,
  NightLighting,
  angleBetween,
  distance,
  lineOfSight,
  LAMPS,
} from '../modules/world/night-systems';
import { renderDarkness } from '../modules/world/night-renderer';
import { drawCampusOverview } from '../modules/world/campus-overview';
import type { RaidController } from '../modules/raid/raid-controller';
import type { EventBus } from '../shared/events/game-events';
import type { InventoryPort, ItemInstance, Point } from '../shared/types/game';
import type { TouchControls } from '../modules/world/touch-controls';

interface SceneServices {
  controller: RaidController;
  inventory: InventoryPort;
  events: EventBus;
  notify: (message: string) => void;
  touch: TouchControls;
  onFrame: (interaction: string, progress: number) => void;
}

export class WorldScene extends Phaser.Scene {
  private position: Point = { ...WORLD.spawn };
  private player?: Phaser.GameObjects.Container;
  private aura?: Phaser.GameObjects.Arc;
  private darkness?: Phaser.Textures.CanvasTexture;
  private flashlight?: Phaser.GameObjects.Graphics;
  private extraction?: Phaser.GameObjects.Rectangle;
  private search = new SearchInteraction(RAID_RULES.searchDurationMs);
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private readonly chestObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly enemyObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly ground = new Map<
    string,
    { item: ItemInstance; position: Point; sprite: Phaser.GameObjects.Container }
  >();
  private lastRaidId: string | null = null;
  private previousInteract = false;
  private previousFlare = false;
  private previousLight = false;
  private previousRefill = false;
  private readonly lighting = new NightLighting();
  private readonly combat = new NightCombat();
  private aim = -Math.PI / 2;
  private moving = false;
  private hurtThisFrame = false;
  private lastNightDraw = -Infinity;
  private readonly bounds = { x: 30, y: 35, width: WORLD.width - 60, height: WORLD.height - 70 };
  private interaction = '从右侧准备面板开始探索';
  private releaseDamage?: () => void;

  constructor(private readonly services: SceneServices) {
    super('world');
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
    this.drawCampus();
    this.textures.remove('night-mask');
    this.darkness =
      this.textures.createCanvas('night-mask', WORLD.width, WORLD.height) ?? undefined;
    this.add.image(0, 0, 'night-mask').setOrigin(0).setDepth(40);
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
      const color = enemy.kind === 'hug' ? 0x8ad6a5 : 0xd45b68;
      const ring = this.add
        .circle(0, 0, enemy.kind === 'hug' ? 17 : 14, color, 0.2)
        .setStrokeStyle(2, color, 0.9);
      const core = this.add.circle(0, 0, 8, color, 0.95);
      const mark = this.add.text(-5, -7, enemy.kind === 'hug' ? '♥' : '!', {
        fontFamily: 'Arial',
        fontSize: '13px',
        color: '#081216',
        fontStyle: 'bold',
      });
      const object = this.add
        .container(enemy.position.x, enemy.position.y, [ring, core, mark])
        .setName(`enemy-${enemy.id}`)
        .setDepth(25);
      this.enemyObjects.set(enemy.id, object);
    }
    for (const point of WORLD.searchPoints) {
      const halo = this.add.circle(0, 0, 23, 0xe3bf79, 0.09);
      const chest = this.add.rectangle(0, 0, 24, 18, 0xc99f60).setStrokeStyle(2, 0xffdc96);
      const seam = this.add.rectangle(0, 0, 3, 18, 0x594523);
      this.chestObjects.set(
        point.id,
        this.add.container(point.x, point.y, [halo, chest, seam]).setDepth(10),
      );
    }
    const keyboard = this.input.keyboard;
    if (keyboard) {
      for (const key of [
        'W',
        'A',
        'S',
        'D',
        'E',
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
      this.cameras.main.setZoom(this.scale.width < 600 ? 0.72 : 1);
    };
    resizeCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, resizeCamera);
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const target = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.aim = angleBetween(this.position, target);
    });
    this.releaseDamage = this.services.events.on('DamageTaken', () => {
      this.hurtThisFrame = true;
      this.search.cancel();
      for (const enemy of this.combat.enemies) {
        enemy.hugProgress = 0;
      }
      this.services.notify('受到伤害，搜索和撤离读条已中断。');
      this.cameras.main.shake(120, 0.004);
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
    const view = this.services.controller.getView();
    if (view.raidId !== this.lastRaidId) {
      this.resetRaid(view.raidId);
    }
    const playable =
      !this.services.controller.isPaused() &&
      (view.phase === 'active' || view.phase === 'extracting');
    if (playable) {
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
      const touchLayout = matchMedia('(pointer: coarse), (max-width: 950px)').matches;
      if (touchLayout && (movement.x || movement.y)) {
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
        const weapon = this.services.inventory
          .getCarriedItems()
          .some((item) => item.itemId === 'reinforced-bat');
        const defeated = this.combat.attack(
          this.position,
          this.aim,
          WORLD.obstacles,
          weapon ? 50 : 35,
        );
        for (const enemy of defeated) {
          if (view.raidId) {
            this.services.events.emit('EnemyDefeated', { raidId: view.raidId, enemyId: enemy.id });
            this.spawnLoot(
              {
                instanceId: `${view.raidId}:enemy:${enemy.id}`,
                itemId: enemy.kind === 'hug' ? 'gpa-charm' : 'school-badge',
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
        down('E') && !down('SPACE'),
        !this.moving,
        WORLD.obstacles,
        this.bounds,
      );
      if (combat.damage) {
        this.services.controller.applyDamage(combat.damage);
      }
      for (const enemy of combat.calmed) {
        if (view.raidId) {
          this.spawnLoot(
            {
              instanceId: `${view.raidId}:hug:${enemy.id}`,
              itemId: 'gpa-charm',
              origin: { kind: 'raid-loot', obtainedInRaidId: view.raidId },
            },
            enemy.position,
          );
        }
        this.services.notify('抱抱成功，护符已掉落；靠近后按 E 拾取。');
      }
      this.services.controller.setExtractionPresence(contains(WORLD.extraction, this.position));
      this.interact(down('E') && !down('SPACE') && !this.hurtThisFrame);
      this.previousInteract = down('E');
      this.previousLight = down('L');
      this.previousRefill = down('R');
      this.previousFlare = down('G');
    } else {
      this.search.cancel();
      this.interaction = this.services.controller.isPaused()
        ? '已暂停 · 关闭规则后继续'
        : view.phase === 'preparing'
          ? '准备好后，开始本次校园探索'
          : '本次探索已结束，请查看结算';
    }
    this.services.controller.tick();
    const current = this.services.controller.getView();
    this.extraction?.setFillStyle(current.value >= current.threshold ? 0x77d4a8 : 0x667a77, 0.24);
    this.extraction?.setStrokeStyle(2, current.value >= current.threshold ? 0x97ecc6 : 0x738984);
    const hug = this.combat.enemies.find((enemy) => enemy.state === 'request');
    this.services.onFrame(this.interaction, hug ? hug.hugProgress / 1500 : this.search.progress());
    this.drawNight();
    this.services.touch.finishFrame();
  }

  private drawNight(): void {
    if (!this.darkness || !this.flashlight) {
      return;
    }
    if (this.time.now - this.lastNightDraw >= 32) {
      renderDarkness(
        this.darkness.context,
        WORLD.width,
        WORLD.height,
        this.lighting,
        this.position,
        this.aim,
        WORLD.obstacles,
      );
      this.darkness.refresh();
      const overview = document.querySelector<HTMLCanvasElement>('#campus-overview');
      if (overview) {
        drawCampusOverview(overview, this.position);
      }
      this.lastNightDraw = this.time.now;
    }
    this.flashlight.clear();
    if (this.combat.swingMs > 0) {
      this.flashlight.fillStyle(0xf2edbc, 0.35);
      this.flashlight.beginPath();
      this.flashlight.moveTo(this.position.x, this.position.y);
      this.flashlight.arc(
        this.position.x,
        this.position.y,
        82,
        this.aim - 1.25,
        this.aim + 1.25,
        false,
      );
      this.flashlight.closePath().fillPath();
    }
    for (const enemy of this.combat.enemies) {
      const visible = this.lighting.visible(
        enemy.position,
        this.position,
        this.aim,
        WORLD.obstacles,
      );
      const object = this.enemyObjects.get(enemy.id);
      object?.setVisible(visible && enemy.state !== 'dead' && enemy.state !== 'calmed');
      object?.setPosition(enemy.position.x, enemy.position.y);
      object?.setAlpha(enemy.state === 'windup' ? 0.6 : 1);
      if (visible && enemy.state !== 'dead' && enemy.state !== 'calmed') {
        this.flashlight
          .fillStyle(0x40202b)
          .fillRect(enemy.position.x - 18, enemy.position.y - 27, 36, 4);
        this.flashlight
          .fillStyle(enemy.mutated ? 0xff4e68 : 0xe4ae6b)
          .fillRect(
            enemy.position.x - 18,
            enemy.position.y - 27,
            (36 * enemy.health) / (enemy.kind === 'hug' ? 100 : 70),
            4,
          );
        if (enemy.state === 'windup') {
          this.flashlight
            .lineStyle(3, 0xff5269, 0.8)
            .strokeCircle(enemy.position.x, enemy.position.y, 60);
        }
      }
    }
    for (const point of WORLD.searchPoints) {
      this.chestObjects
        .get(point.id)
        ?.setVisible(this.lighting.visible(point, this.position, this.aim, WORLD.obstacles));
    }
    for (const drop of this.ground.values()) {
      drop.sprite.setVisible(
        this.lighting.visible(drop.position, this.position, this.aim, WORLD.obstacles),
      );
    }
    this.player?.setAlpha(
      this.combat.invulnerability > 0 ? (Math.floor(this.time.now / 90) % 2 ? 0.5 : 1) : 1,
    );
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
    const hug = this.combat.enemies.find((enemy) => enemy.state === 'request');
    if (hug) {
      this.search.cancel();
      this.interaction = `抱抱请求 · ${Math.ceil(hug.timer / 1000)} 秒`;
      return;
    }
    const loot = [...this.ground.values()].find(
      (drop) =>
        distance(drop.position, this.position) < 55 &&
        lineOfSight(this.position, drop.position, WORLD.obstacles),
    );
    if (loot) {
      this.interaction = '按 E 拾取脚边物品';
      this.search.cancel();
      if (held && !this.previousInteract) {
        // Carry-in drops retain provenance: only the inventory transfer method may reinsert them.
        const result = this.services.inventory.addLoot(loot.item);
        if (result.ok) {
          loot.sprite.destroy();
          this.ground.delete(loot.item.instanceId);
        }
        this.services.notify(result.ok ? '已拾回物品。' : '背包已满或来源无效，请先腾出空间。');
      }
      return;
    }
    const chest = WORLD.searchPoints.find(
      (point) =>
        !this.search.isOpened(point.id) &&
        distance(point, this.position) < 60 &&
        lineOfSight(this.position, point, WORLD.obstacles),
    );
    if (chest) {
      const hasNotebook = this.services.inventory
        .getCarriedItems()
        .some(
          (item) =>
            item.itemId === 'torn-notebook' &&
            item.origin.kind === 'raid-loot' &&
            item.origin.obtainedInRaidId === view.raidId,
        );
      if (chest.itemId === 'anomalous-feather' && !hasNotebook) {
        this.search.cancel();
        this.interaction = '湖畔线索 · 缺少本局残缺手记';
        return;
      }
      if (!this.lighting.illuminated(chest, this.position, this.aim, WORLD.obstacles)) {
        this.search.cancel();
        this.interaction = '光线不足';
        return;
      }
      this.interaction = `长按 E 搜索 · ${ITEM_DEFINITIONS[chest.itemId]?.name ?? '物资'}`;
      if (!held || this.moving || view.phase !== 'active') {
        this.search.cancel();
        return;
      }
      this.search.begin(chest.id);
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
          const questItems = this.services.inventory
            .getCarriedItems()
            .filter(
              (item) =>
                item.origin.kind === 'raid-loot' && item.origin.obtainedInRaidId === view.raidId,
            )
            .map((item) => item.itemId);
          if (questItems.includes('torn-notebook') && questItems.includes('anomalous-feather')) {
            this.services.controller.setQuestComplete(true);
            this.services.notify('手记与异常羽毛已凑齐；带着它们成功撤离可解锁思源密码。');
          }
        }
        this.services.notify(
          result.ok ? '搜索完成，物资进入本局背包。' : '背包已满，搜索点已保留，腾出空间后重试。',
        );
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
        this.interaction = '校园夜巡';
      }
    }
  }

  private resetRaid(raidId: string | null): void {
    this.lastRaidId = raidId;
    this.position = { ...WORLD.spawn };
    this.search.reset();
    this.lighting.reset();
    this.combat.reset();
    this.aim = -Math.PI / 2;
    this.lastNightDraw = -Infinity;
    this.player?.setPosition(this.position.x, this.position.y);
    for (const object of this.chestObjects.values()) {
      object.setAlpha(1);
    }
    for (const drop of this.ground.values()) {
      drop.sprite.destroy();
    }
    this.ground.clear();
    this.previousInteract = false;
    this.previousLight = false;
    this.previousRefill = false;
    this.previousFlare = false;
    this.services.touch.reset();
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
    const sports = WORLD.sports;
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
    this.add.text(sports.x + 55, sports.y + sports.height + 9, '西侧运动场', {
      fontSize: '16px',
      color: '#d5decf',
    });
    for (let i = 0; i < 14; i++) {
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
      this.add.text(building.x + 16, building.y + 28, building.name, {
        fontFamily: 'Microsoft YaHei',
        fontSize: '20px',
        color: '#153b38',
      });
      this.add.text(building.x + 16, building.y + 57, building.sub, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#36564a',
      });
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
    this.add.text(lake.x + 40, lake.y + 40, '明湖', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '25px',
      color: '#d2e8cf',
    });
    this.add.text(lake.x + 35, lake.y + 74, 'MINGHU', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#acc9b9',
    });
    const clue = WORLD.searchPoints.find((point) => point.id === 'lake-clue')!;
    g.fillStyle(0x9fa89b).fillRect(clue.x - 7, clue.y - 26, 14, 21);
    this.add.text(clue.x - 30, clue.y + 19, '明湖石碑', { fontSize: '13px', color: '#d2decf' });
    for (const gate of WORLD.gates) {
      const isExtraction = gate.role === 'extraction';
      this.add
        .circle(gate.x, gate.y, isExtraction ? 13 : 8, isExtraction ? 0x8cdeb2 : 0xd3c08d, 0.9)
        .setStrokeStyle(2, 0x17251e, 0.95)
        .setDepth(8);
      this.add
        .text(gate.x, gate.y, gate.name, {
          fontSize: '16px',
          color: isExtraction ? '#baf4d4' : '#e0d8b9',
          backgroundColor: isExtraction ? '#173f32' : '#29352f',
          padding: { x: 6, y: 4 },
        })
        .setOrigin(0.5)
        .setDepth(43);
    }
    this.add.text(45, 869, '海淀主校区 · 依据小组提供地图简化，非 1:1 复刻', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '13px',
      color: '#97b1a1',
    });
  }
}
