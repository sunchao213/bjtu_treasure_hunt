import Phaser from 'phaser';
import { WORLD } from '../config/world-config';
import { ITEM_DEFINITIONS, RAID_RULES } from '../config/game-config';
import { contains, movePlayer } from '../modules/world/movement';
import { SearchInteraction } from '../modules/world/search-interaction';
import type { RaidController } from '../modules/raid/raid-controller';
import type { EventBus } from '../shared/events/game-events';
import type { InventoryPort, ItemInstance, Point } from '../shared/types/game';

interface SceneServices {
  controller: RaidController;
  inventory: InventoryPort;
  events: EventBus;
  notify: (message: string) => void;
  onFrame: (interaction: string, progress: number) => void;
}

export class WorldScene extends Phaser.Scene {
  private position: Point = { ...WORLD.spawn };
  private player?: Phaser.GameObjects.Container;
  private aura?: Phaser.GameObjects.Arc;
  private extraction?: Phaser.GameObjects.Rectangle;
  private search = new SearchInteraction(RAID_RULES.searchDurationMs);
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private readonly chestObjects = new Map<string, Phaser.GameObjects.Container>();
  private readonly ground = new Map<
    string,
    { item: ItemInstance; position: Point; sprite: Phaser.GameObjects.Container }
  >();
  private lastRaidId: string | null = null;
  private previousInteract = false;
  private interaction = '从右侧准备面板开始探索';
  private releaseDamage?: () => void;

  constructor(private readonly services: SceneServices) {
    super('world');
  }

  create(): void {
    this.drawCampus();
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
    this.add.text(588, 812, '南侧撤离点', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '16px',
      color: '#d3ecd6',
    });
    this.aura = this.add.circle(0, 0, 23, 0xa9e9d0, 0.12);
    const shadow = this.add.ellipse(0, 13, 30, 12, 0x061f23, 0.35);
    const body = this.add.rectangle(0, 0, 22, 28, 0xf3e2a7).setStrokeStyle(2, 0xffffff, 0.65);
    const head = this.add.circle(0, -16, 10, 0xffedd2);
    const bag = this.add.rectangle(-10, 3, 9, 16, 0xc18a48);
    this.player = this.add
      .container(this.position.x, this.position.y, [shadow, this.aura, body, head, bag])
      .setDepth(30);
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
      for (const key of ['W', 'A', 'S', 'D', 'E', 'UP', 'DOWN', 'LEFT', 'RIGHT']) {
        this.keys[key] = keyboard.addKey(key);
      }
    }
    this.cameras.main.setBounds(0, 0, WORLD.width, WORLD.height);
    this.cameras.main.startFollow(this.player, true, 0.12, 0.12);
    this.releaseDamage = this.services.events.on('DamageTaken', () => {
      this.search.cancel();
      this.services.notify('受到伤害，搜索和撤离读条已中断。');
      this.cameras.main.shake(120, 0.004);
    });
    const onHidden = () => {
      if (document.hidden) {
        this.search.cancel();
        this.services.controller.cancelExtraction();
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.releaseDamage?.();
      document.removeEventListener('visibilitychange', onHidden);
      keyboard?.removeAllKeys(true);
    });
  }

  update(_time: number, deltaMs: number): void {
    const view = this.services.controller.getView();
    if (view.raidId !== this.lastRaidId) {
      this.resetRaid(view.raidId);
    }
    const playable = view.phase === 'active' || view.phase === 'extracting';
    if (playable) {
      const isTyping =
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLSelectElement;
      const down = (key: string) => !isTyping && (this.keys[key]?.isDown ?? false);
      this.position = movePlayer(
        this.position,
        {
          x: Number(down('D') || down('RIGHT')) - Number(down('A') || down('LEFT')),
          y: Number(down('S') || down('DOWN')) - Number(down('W') || down('UP')),
        },
        deltaMs,
        WORLD.playerSpeed,
        WORLD.playerRadius,
        { x: 30, y: 35, width: WORLD.width - 60, height: WORLD.height - 70 },
        WORLD.obstacles,
      );
      this.player?.setPosition(this.position.x, this.position.y);
      this.services.controller.setExtractionPresence(contains(WORLD.extraction, this.position));
      this.interact(down('E'));
      this.previousInteract = down('E');
    } else {
      this.search.cancel();
      this.interaction =
        view.phase === 'preparing' ? '准备好后，开始本次校园探索' : '本次探索已结束，请查看结算';
    }
    this.services.controller.tick();
    const current = this.services.controller.getView();
    this.extraction?.setFillStyle(current.value >= current.threshold ? 0x77d4a8 : 0x667a77, 0.24);
    this.extraction?.setStrokeStyle(2, current.value >= current.threshold ? 0x97ecc6 : 0x738984);
    this.services.onFrame(this.interaction, this.search.progress());
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
    const point = { ...this.position };
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
    this.ground.set(instanceId, { item: removed.value, position: point, sprite });
    this.services.notify('物品已放在脚边。按 E 拾回；丢弃和重拾不会累计刷分。');
  }

  private interact(held: boolean): void {
    const view = this.services.controller.getView();
    const loot = [...this.ground.values()].find(
      (drop) => Phaser.Math.Distance.BetweenPoints(drop.position, this.position) < 55,
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
        Phaser.Math.Distance.BetweenPoints(point, this.position) < 60,
    );
    if (chest) {
      this.interaction = `长按 E 搜索 · ${ITEM_DEFINITIONS[chest.itemId]?.name ?? '物资'}`;
      if (!held || view.phase !== 'active') {
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
        }
        this.services.notify(
          result.ok ? '搜索完成，物资进入本局背包。' : '背包已满，搜索点已保留，腾出空间后重试。',
        );
      }
      return;
    }
    this.search.cancel();
    if (view.inExtractionZone) {
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
      this.interaction = '沿校园道路探索 · 靠近金色物资点长按 E';
    }
  }

  private resetRaid(raidId: string | null): void {
    this.lastRaidId = raidId;
    this.position = { ...WORLD.spawn };
    this.search.reset();
    this.player?.setPosition(this.position.x, this.position.y);
    for (const object of this.chestObjects.values()) {
      object.setAlpha(1);
    }
    for (const drop of this.ground.values()) {
      drop.sprite.destroy();
    }
    this.ground.clear();
    this.previousInteract = false;
  }

  private drawCampus(): void {
    const g = this.add.graphics();
    g.fillStyle(0x143c3c);
    g.fillRect(0, 0, WORLD.width, WORLD.height);
    g.lineStyle(1, 0x28504c, 0.5);
    for (let x = 0; x < WORLD.width; x += 40) {
      g.lineBetween(x, 0, x, WORLD.height);
    }
    for (let y = 0; y < WORLD.height; y += 40) {
      g.lineBetween(0, y, WORLD.width, y);
    }
    g.fillStyle(0x52716a, 0.5);
    g.fillRoundedRect(65, 290, 1150, 85, 20);
    g.fillRoundedRect(415, 60, 94, 745, 20);
    g.fillRoundedRect(785, 55, 80, 750, 20);
    g.fillRoundedRect(85, 695, 1110, 60, 20);
    g.fillRoundedRect(500, 560, 310, 64, 16);
    g.fillRoundedRect(595, 600, 70, 240, 16);
    for (let i = 0; i < 14; i++) {
      const x = 70 + i * 82;
      g.fillStyle(0x335a4c);
      g.fillCircle(x, 50, 17);
      g.fillStyle(0x53775a);
      g.fillCircle(x - 5, 46, 10);
    }
    const buildings = [
      { x: 135, y: 120, w: 280, h: 155, name: '图书馆', sub: 'LIBRARY / 01' },
      { x: 880, y: 100, w: 265, h: 175, name: '思源楼', sub: 'SIYUAN / 03' },
      { x: 145, y: 555, w: 235, h: 105, name: '校园庭院', sub: 'COURTYARD' },
      { x: 900, y: 580, w: 220, h: 90, name: '连廊', sub: 'PASSAGE' },
    ];
    for (const building of buildings) {
      g.fillStyle(0x0d2e32, 0.6);
      g.fillRoundedRect(building.x + 8, building.y + 10, building.w, building.h, 9);
      g.fillStyle(0x8b9b83);
      g.fillRoundedRect(building.x, building.y, building.w, building.h, 9);
      g.fillStyle(0xb9bf9b);
      g.fillRect(building.x + 9, building.y + 9, building.w - 18, 10);
      this.add.text(building.x + 20, building.y + 40, building.name, {
        fontFamily: 'Microsoft YaHei',
        fontSize: '24px',
        color: '#153b38',
      });
      this.add.text(building.x + 21, building.y + 74, building.sub, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#36564a',
      });
    }
    g.fillStyle(0x365b57);
    g.fillRoundedRect(525, 260, 255, 260, 55);
    g.fillStyle(0x326b70);
    g.fillRoundedRect(535, 270, 235, 240, 48);
    g.lineStyle(2, 0x82b3a3, 0.45);
    for (let y = 322; y < 470; y += 32) {
      g.lineBetween(567, y, 725, y);
    }
    this.add.text(619, 370, '明湖', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '25px',
      color: '#d2e8cf',
    });
    this.add.text(591, 408, 'MINGHU / 02', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#acc9b9',
    });
    this.add.text(45, 862, '校园示意地图 · 非 1:1 复刻', {
      fontFamily: 'Microsoft YaHei',
      fontSize: '13px',
      color: '#97b1a1',
    });
  }
}
