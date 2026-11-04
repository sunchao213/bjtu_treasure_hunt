import './style.css';
import './mobile-layout.css';
import { bindMobileLayout, isTouchLayout, requestLandscape } from './modules/ui/mobile-layout';
import { createGame } from './app/create-game';
import { HEALING_AMOUNTS, ITEM_DEFINITIONS, RAID_RULES } from './config/game-config';
import { ReferenceInventory } from './modules/inventory/reference-inventory';
import { RaidController } from './modules/raid/raid-controller';
import { FORMAL_SAVE_KEY } from './modules/save/persistent-save';
import { CloudSave } from './modules/save/cloud-save';
import { HttpCloudSaveApi } from './modules/save/cloud-save-api';
import { acquireSaveLock } from './modules/save/single-writer';
import { mountShell } from './modules/ui/reference-shell';
import { bindGameRules } from './modules/ui/game-rules';
import { renderChapterUnlock, renderCodexPanel, renderQuestPanel } from './modules/ui/quest-view';
import { chapterUnlockGranted, questProgress } from './modules/quests/quest-service';
import { renderCodex, exportCodexImage } from './modules/ui/codex';
import { WorldScene } from './scenes/world-scene';
import { EventBus } from './shared/events/game-events';
import type { ItemInstance } from './shared/types/game';
import { TouchControls } from './modules/world/touch-controls';
import { SoundManager } from './modules/ui/sound-manager';
import { NetworkSession } from './modules/network/network-session';
import { bindRoomLobby } from './modules/ui/room-lobby';
import type { AccountUser } from './modules/auth/auth-client';
import { accountStorage } from './modules/save/account-storage';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element: ${id}`);
  }
  return node as T;
}
export async function startGame(user: AccountUser, logout: () => Promise<void>): Promise<void> {
  const app = element('app');
  mountShell(app);
  const settings = document.createElement('section');
  settings.className = 'side-card settings';
  settings.innerHTML =
    '<h2>设置</h2><label>游戏音量 <input id="sound-volume" type="range" min="0" max="1" step="0.05" value="0.8"></label><label>界面亮度 <input id="screen-brightness" type="range" min="0.65" max="1.2" step="0.05" value="1"></label>';
  document.querySelector('aside')?.append(settings);
  const account = document.createElement('section');
  account.className = 'side-card settings';
  account.innerHTML =
    '<h2>当前账号</h2><p id="account-label"></p><p id="cloud-save-status" role="status">正在读取云端进度…</p><button id="account-logout" class="secondary">退出登录</button><button id="account-import-legacy" class="text-button" hidden>迁移此浏览器的旧存档</button>';
  settings.before(account);
  element('account-label').textContent = `${user.displayName}（${user.username}）`;
  element<HTMLInputElement>('network-name').value = user.displayName;
  element<HTMLInputElement>('network-name').readOnly = true;
  element('network-name').title = '联机昵称使用当前登录账号的昵称';
  let allowLogout = () => true;
  element('account-logout').onclick = async () => {
    if (!allowLogout()) return;
    const button = element<HTMLButtonElement>('account-logout');
    button.disabled = true;
    try {
      await logout();
    } catch (error) {
      notify(error instanceof Error ? error.message : '退出失败，请重试。');
    } finally {
      button.disabled = false;
    }
  };
  const storage = accountStorage(localStorage, user.id);
  const lockName = `bjtu-treasure-hunt:account:${user.id}`;
  const notify = (message: string) => {
    element('notice').textContent = message;
  };
  const phaseNames = {
    preparing: '准备出发',
    active: '校园探索',
    extracting: '撤离读条',
    settling: '正在保存',
    success: '撤离成功',
    failed: '行动失败',
  };
  const reasonNames = {
    death: '生命归零',
    timeout: '探索时间耗尽',
    abandoned: '主动放弃',
    interrupted: '页面关闭或刷新中断',
  };

  async function bootstrap(): Promise<void> {
    const unlock = await acquireSaveLock(lockName);
    if (!unlock) {
      throw new Error('另一个标签页正在使用这个存档，请关闭它后刷新本页。');
    }
    let save: CloudSave;
    try {
      const clientId = sessionStorage.getItem('bjtu-game-window') ?? crypto.randomUUID();
      sessionStorage.setItem('bjtu-game-window', clientId);
      save = await CloudSave.connect(storage, new HttpCloudSaveApi(clientId), {
        onLost: () => location.reload(),
        onStatus: (message) => {
          element('cloud-save-status').textContent = message;
        },
      });
      window.addEventListener('pagehide', () => save.close(), { once: true });
    } catch (error) {
      unlock();
      element<HTMLButtonElement>('reset-save').disabled = true;
      // Recovery happens while holding the lock; a separate confirmed action reacquires it.
      element<HTMLButtonElement>('reset-save').disabled = false;
      element('reset-save').onclick = async () => {
        const release = await acquireSaveLock(lockName);
        if (!release) {
          notify('其他标签页正在使用存档。');
          return;
        }
        try {
          if (confirm('建议先导出原始存档。确定清空本框架的损坏存档吗？')) {
            storage.removeItem(FORMAL_SAVE_KEY);
            location.reload();
          }
        } finally {
          release();
        }
      };
      throw error;
    }
    let recovered: boolean;
    try {
      recovered = await save.recoverInterrupted();
    } catch (error) {
      save.close();
      unlock();
      throw error;
    }
    if (recovered) {
      notify('检测到上次未结束的探索，已按中断失败处理；未带入仓库的物品不受影响。');
    }
    const events = new EventBus();
    const inventory = new ReferenceInventory(events, RAID_RULES.bagCapacity, ITEM_DEFINITIONS);
    const controller = new RaidController(inventory, save, events, RAID_RULES, ITEM_DEFINITIONS);
    const migrate = element<HTMLButtonElement>('account-import-legacy');
    migrate.hidden = localStorage.getItem(FORMAL_SAVE_KEY) === null;
    migrate.onclick = async () => {
      if (controller.getView().phase !== 'preparing') {
        notify('请先结束本局并返回准备页，再迁移旧存档。');
        return;
      }
      if (
        !confirm(
          '将此浏览器在添加账号前的存档复制到当前账号，并覆盖当前账号进度。建议先导出备份。旧存档会保留，确定迁移吗？',
        )
      )
        return;
      try {
        const raw = localStorage.getItem(FORMAL_SAVE_KEY);
        if (raw === null) throw new Error('未找到旧存档。');
        await save.importRaw(raw);
        await save.recoverInterrupted();
        location.reload();
      } catch (error) {
        notify(error instanceof Error ? error.message : '旧存档迁移失败，原始旧存档已保留。');
      }
    };
    allowLogout = () => {
      const phase = controller.getView().phase;
      if (phase === 'preparing' || phase === 'success' || phase === 'failed') return true;
      return confirm('退出登录会中断本次探索，本局携带物将按中断失败处理。确定退出吗？');
    };
    let lastInventory = '';
    let lastWarehouse = '';
    let lastCodex = '';
    let renderedAt = 0;
    let interacted = '';
    let searchProgress = 0;
    const touch = new TouchControls(element('touch-controls'));
    const sound = new SoundManager();
    const networkUrl = new URL('/ws', location.href);
    networkUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const network = new NetworkSession({
      url: networkUrl.href,
      sessionId: crypto.randomUUID(),
      displayName: user.displayName,
    });
    const lobby = bindRoomLobby({
      network,
      canEnter: () => controller.getView().phase === 'preparing' && !controller.getView().isBusy,
      canPrepare: () =>
        controller.getView().phase === 'preparing' &&
        !controller.getView().isBusy &&
        element<HTMLInputElement>('risk-consent').checked,
      onChange: () => render(),
      onPlayers: (players) =>
        players.length ? scene.syncRemotePlayers(players) : scene.clearRemotePlayers(),
      onPlayerLeft: (id) => scene.removeRemotePlayer(id),
      onStart: async () => {
        if (controller.getView().phase !== 'preparing') return;
        element('close-room').click();
        if (!(await startExploration())) lobby.finish();
      },
    });
    events.on('RaidEnded', () => lobby.finish());
    window.addEventListener('beforeunload', () => network?.close(), { once: true });
    const volume = element<HTMLInputElement>('sound-volume');
    let audibleVolume = sound.getSettings().volume || 0.8;
    const brightness = element<HTMLInputElement>('screen-brightness');
    const applySettings = () => {
      sound.setSettings({ volume: Number(volume.value), brightness: Number(brightness.value) });
      document.documentElement.style.setProperty('--screen-brightness', brightness.value);
    };
    volume.value = String(sound.getSettings().volume);
    brightness.value = String(sound.getSettings().brightness);
    volume.oninput = applySettings;
    brightness.oninput = applySettings;
    applySettings();
    const scene = new WorldScene({
      displayName: user.displayName,
      controller,
      inventory,
      events,
      notify,
      touch,
      sound,
      network,
      onFrame: (interaction, progress) => {
        interacted = interaction;
        searchProgress = progress;
        if (performance.now() - renderedAt > 80) {
          render();
          renderedAt = performance.now();
        }
      },
    });
    let rulesOpen = false;
    let mapOpen = false;
    let codexOpen = false;
    let roomOpen = false;
    const mobile = isTouchLayout;
    const syncOrientation = () => {
      const view = controller.getView();
      const active = view.phase === 'active' || view.phase === 'extracting';
      app.dataset.mobile = String(mobile());
      element('rotate-phone').hidden = true;
      if (active && (rulesOpen || mapOpen || codexOpen || roomOpen)) {
        if (!controller.isPaused()) {
          controller.pause();
          scene.clearInteractions();
        }
      } else if (!rulesOpen && !mapOpen && !codexOpen && !roomOpen) controller.resume();
    };
    let roomTrigger = 'open-room';
    let gameScroll = 0;
    for (const id of ['open-room', 'mobile-room']) {
      element(id).onclick = () => {
        roomTrigger = id;
        gameScroll = app.scrollTop || window.scrollY;
        roomOpen = true;
        controller.pause();
        scene.clearInteractions();
        element('game-page').hidden = true;
        element('room-page').hidden = false;
        app.scrollTop = 0;
        window.scrollTo(0, 0);
        element('room-title').focus();
        render();
        lobby.connect();
      };
    }
    element('close-room').onclick = () => {
      roomOpen = false;
      element('room-page').hidden = true;
      element('game-page').hidden = false;
      scene.clearInteractions();
      render();
      element(roomTrigger).focus({ preventScroll: true });
      app.scrollTop = gameScroll;
      if (!mobile()) window.scrollTo(0, gameScroll);
    };
    const onResize = () => {
      scene.clearInteractions();
      render();
    };
    const disposeLayout = bindMobileLayout(app, () => queueMicrotask(onResize));
    // Establish the logical landscape box before Phaser measures its canvas.
    const game = createGame(scene);
    element('mobile-fullscreen').onclick = () => {
      void requestLandscape();
    };
    element('mobile-rules').onclick = () => element('open-rules').click();
    element('mobile-sound').onclick = () => {
      if (sound.getMusicState() === 'playing') {
        audibleVolume = sound.getSettings().volume;
        volume.value = '0';
        sound.setSettings({ volume: 0 });
      } else {
        if (sound.getSettings().volume === 0) {
          volume.value = String(audibleVolume);
          sound.setSettings({ volume: audibleVolume });
        }
        sound.setMusic(true);
      }
      render();
    };
    element('mobile-bag').onclick = () => {
      scene.clearInteractions();
      const target = element('mobile-bag').getAttribute('aria-controls')!;
      app.scrollTo({ top: element(target).offsetTop - 12, behavior: 'smooth' });
    };
    const campusMap = element<HTMLDialogElement>('campus-map-dialog');
    element('open-campus-map').onclick = () => {
      if (campusMap.open) return;
      mapOpen = true;
      controller.pause();
      scene.clearInteractions();
      campusMap.showModal();
      render();
    };
    element('close-campus-map').onclick = () => campusMap.close();
    campusMap.addEventListener('close', () => {
      mapOpen = false;
      scene.clearInteractions();
      render();
    });
    const codex = element<HTMLDialogElement>('codex-dialog');
    const openCodex = () => {
      if (codex.open) return;
      codexOpen = true;
      controller.pause();
      scene.clearInteractions();
      const archive = save.view();
      renderCodex(archive.codexIds, archive.unlockedChapterIds);
      element('codex-export-status').textContent = '';
      codex.showModal();
      render();
    };
    for (const id of ['open-codex', 'archive-codex', 'mobile-codex']) {
      element(id).onclick = openCodex;
    }
    element('close-codex').onclick = () => codex.close();
    codex.addEventListener('close', () => {
      codexOpen = false;
      scene.clearInteractions();
      render();
    });
    element('export-codex').onclick = async () => {
      const button = element<HTMLButtonElement>('export-codex');
      button.disabled = true;
      element('codex-export-status').textContent = '正在生成图鉴图片…';
      try {
        const archive = save.view();
        await exportCodexImage(archive.codexIds, archive.unlockedChapterIds);
        element('codex-export-status').textContent = '图鉴图片已生成，请查看浏览器下载。';
      } catch (error) {
        element('codex-export-status').textContent =
          error instanceof Error ? error.message : '导出失败，请重试。';
      } finally {
        button.disabled = false;
      }
    };
    bindGameRules(
      () => {
        rulesOpen = true;
        controller.pause();
        scene.clearInteractions();
        render();
      },
      () => {
        scene.clearInteractions();
        rulesOpen = false;
        syncOrientation();
        render();
      },
    );

    function render(): void {
      syncOrientation();
      const view = controller.getView();
      lobby.render();
      const preparation = element('preparation');
      const prepTarget =
        roomOpen && lobby.isJoined()
          ? element('room-preparation-slot')
          : element('inventory-panel').parentElement!;
      if (preparation.parentElement !== prepTarget) {
        if (roomOpen && lobby.isJoined()) prepTarget.append(preparation);
        else prepTarget.insertBefore(preparation, element('inventory-panel'));
      }
      for (const id of ['loadout', 'starter-weapon', 'risk-consent']) {
        element<HTMLInputElement | HTMLSelectElement>(id).disabled = lobby.isLocked();
      }
      const lighting = scene.getLightingStatus();
      const musicState = sound.getMusicState();
      const soundButton = element('mobile-sound');
      soundButton.textContent =
        musicState === 'playing'
          ? '静音'
          : musicState === 'loading'
            ? '加载声音'
            : musicState === 'error'
              ? '重试声音'
              : '开启声音';
      soundButton.setAttribute('aria-pressed', String(musicState === 'playing'));
      const bagButton = element('mobile-bag');
      const preparing = view.phase === 'preparing';
      const finished = ['settling', 'success', 'failed'].includes(view.phase);
      bagButton.textContent = preparing ? '出发' : finished ? '结算' : '背包';
      bagButton.setAttribute(
        'aria-controls',
        preparing ? 'preparation' : finished ? 'result-panel' : 'inventory-panel',
      );
      const playable =
        !controller.isPaused() && (view.phase === 'active' || view.phase === 'extracting');
      touch.setEnabled(playable);
      app.dataset.phase = view.phase;
      const lightButton =
        element('touch-controls').querySelector<HTMLButtonElement>('[data-touch-action="L"]');
      lightButton?.setAttribute('aria-pressed', String(lighting.enabled));
      const interactButton =
        element('touch-controls').querySelector<HTMLButtonElement>('[data-touch-action="E"]');
      if (interactButton) {
        interactButton.textContent = interacted.includes('搜索')
          ? '搜索'
          : interacted.includes('抱抱')
            ? '抱抱'
            : interacted.includes('充电')
              ? '充电'
              : view.inExtractionZone
                ? '撤离'
                : interacted.includes('拾')
                  ? '拾取'
                  : '交互';
      }
      element('mobile-hud').textContent =
        `价值 ${view.value}/${view.threshold} · 手电 ${lighting.battery}%`;
      element('phase-label').textContent = phaseNames[view.phase];
      element('health').textContent = String(view.health);
      const seconds = Math.ceil(view.remainingMs / 1000);
      element('timer').textContent =
        `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      element('loot-value').textContent = String(view.value);
      element<HTMLProgressElement>('value-progress').value = view.value;
      element('battery').textContent =
        `${lighting.battery}% · ${lighting.enabled ? '开启' : '关闭'}`;
      element('light-reserves').textContent =
        `备用电池 ${lighting.spareBatteries} · 照明棒 ${lighting.flares}`;
      element<HTMLProgressElement>('battery-progress').value = lighting.battery;
      app.dataset.valueReady = String(view.value >= view.threshold);
      element('gate-label').textContent = view.value >= view.threshold ? '可以撤离' : '继续搜集';
      element('value-hint').textContent =
        view.value >= view.threshold
          ? '条件已达成，去南侧撤离点停留 5 秒。'
          : `还差 ${view.threshold - view.value} 价值 · 带入物不计分`;
      element('interaction-label').textContent = interacted;
      element<HTMLProgressElement>('interaction-progress').value =
        view.phase === 'extracting' ? view.extractionProgress : searchProgress;
      element('preparation').hidden = view.phase !== 'preparing';
      element('inventory-panel').hidden = !playable;
      element('result-panel').hidden = !['settling', 'success', 'failed'].includes(view.phase);
      element<HTMLButtonElement>('start').disabled =
        view.isBusy || (!lobby.isJoined() && !element<HTMLInputElement>('risk-consent').checked);
      element('start').textContent = lobby.isJoined() ? '进入联机房间 ↗' : '开始探索 ↗';
      element<HTMLButtonElement>('extract').disabled =
        !playable ||
        !view.inExtractionZone ||
        view.value < view.threshold ||
        view.phase === 'extracting';
      element('extract').textContent =
        view.phase === 'extracting'
          ? '正在撤离，请保持停留…'
          : view.inExtractionZone
            ? '开始撤离 · 5 秒'
            : '请前往南侧撤离点';
      element('retry-save').hidden = !view.saveError || view.phase !== 'settling';
      element<HTMLButtonElement>('retry-save').disabled = view.isBusy;
      element('next').hidden = !['success', 'failed'].includes(view.phase);
      element('result-title').textContent = view.saveError ? '存档未保存' : phaseNames[view.phase];
      element('result-detail').textContent = view.saveError
        ? '结果已冻结，重试保存不会重复发奖。不要刷新页面。'
        : view.phase === 'settling'
          ? '正在保存本次结果…'
          : view.result?.outcome === 'success'
            ? `带回 ${view.result.items.length} 件物品，本局价值 ${view.result.value}。仓库和图鉴已保存。`
            : `失败原因：${view.result?.reason ? reasonNames[view.result.reason] : '未知'}。本局携带物损失，之前的收藏保留。`;
      const carried = inventory.getCarriedItems();
      renderQuestPanel(questProgress(carried, view.raidId));
      const signature = JSON.stringify([carried, inventory.getEquipment()]);
      if (signature !== lastInventory) {
        renderInventory(carried, inventory.getEquipment());
        lastInventory = signature;
      }
      const archive = save.view();
      const warehouseSignature = JSON.stringify(archive.warehouse);
      element('warehouse-count').textContent = `${archive.warehouse.length} 件`;
      element('archive-detail').textContent = archive.unlockedChapterIds.length
        ? `已解锁思源密码章节；图鉴 ${archive.codexIds.length} 种。`
        : archive.codexIds.length
          ? `已点亮 ${archive.codexIds.length} 种图鉴；带手记和异常羽毛成功撤离可解锁章节。`
          : '成功撤离后，物品和图鉴会保存在此浏览器。';
      if (lastWarehouse !== warehouseSignature) {
        const select = element<HTMLSelectElement>('loadout');
        select.replaceChildren(new Option('轻装出发 · 不带入物品', ''));
        for (const item of archive.warehouse) {
          select.add(
            new Option(ITEM_DEFINITIONS[item.itemId]?.name ?? item.itemId, item.instanceId),
          );
        }
        lastWarehouse = warehouseSignature;
      }
      renderChapterUnlock(
        element('quest-unlock'),
        view.result !== null && chapterUnlockGranted(view.result),
      );
      const codexSignature = JSON.stringify([archive.codexIds, archive.unlockedChapterIds]);
      if (codexSignature !== lastCodex) {
        renderCodexPanel(element('codex-list'), element('story-archive'), archive);
        if (codex.open) renderCodex(archive.codexIds, archive.unlockedChapterIds);
        lastCodex = codexSignature;
      }
    }

    function renderInventory(
      items: readonly ItemInstance[],
      equipment: ReturnType<typeof inventory.getEquipment>,
    ): void {
      const equippedIds = new Set(Object.values(equipment).map((item) => item.instanceId));
      const bagItems = items.filter((item) => !equippedIds.has(item.instanceId));
      element('bag-count').textContent =
        `${bagItems.length} / ${RAID_RULES.bagCapacity} · 装备 ${equippedIds.size}`;
      const list = element('inventory');
      list.replaceChildren();
      if (!items.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '还没有物资，用手电照亮附近，寻找物资箱。';
        list.append(li);
      }
      for (const item of items) {
        const definition = ITEM_DEFINITIONS[item.itemId];
        if (!definition) {
          continue;
        }
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.textContent = definition.name;
        const sub = document.createElement('small');
        sub.textContent = equippedIds.has(item.instanceId)
          ? '已装备 · 不占背包格'
          : item.origin.kind === 'carry-in'
            ? '带入物 · 不计本局价值'
            : `本局搜得 · ${RAID_RULES.values[definition.rarity]} 价值`;
        label.append(sub);
        li.append(label);
        if (definition.kind === 'healing') {
          const use = document.createElement('button');
          use.className = 'mini';
          use.textContent = '使用';
          use.onclick = () => {
            const state = controller.getView();
            if (state.phase !== 'active' && state.phase !== 'extracting') {
              return;
            }
            const amount = HEALING_AMOUNTS[item.itemId];
            if (amount === undefined) {
              notify('该恢复物尚未配置效果，物品没有消耗。');
              return;
            }
            const consumed = inventory.consumeHealing(item.instanceId, () =>
              controller.heal(amount),
            );
            if (consumed.ok) {
              notify('恢复物已消耗，当前携带价值已重算。');
            } else if (consumed.error === 'INVALID_STATE') {
              notify('当前无法使用恢复物，物品没有消耗。');
            }
          };
          li.append(use);
        }
        const drop = document.createElement('button');
        drop.className = 'mini';
        drop.textContent = '丢弃';
        drop.setAttribute('aria-label', `丢弃${definition.name}`);
        drop.onclick = () => {
          if (definition.kind !== 'quest' || confirm('这是任务物品，确认丢弃？')) {
            scene.drop(item.instanceId);
          }
        };
        li.append(drop);
        list.append(li);
      }
    }

    element('risk-consent').onchange = render;
    async function startExploration(): Promise<boolean> {
      if (!element<HTMLInputElement>('risk-consent').checked) return false;
      // Start playback within the click gesture, before fullscreen or save awaits.
      sound.setMusic(true);
      void requestLandscape();
      const selected = element<HTMLSelectElement>('loadout').value;
      const starterWeapon = element<HTMLSelectElement>('starter-weapon').value;
      const result = await controller.start(selected ? [selected] : [], starterWeapon || undefined);
      notify(
        result.ok
          ? '探索开始。当前物资价值达到 100 后，回到南侧撤离点。'
          : '无法保存开局，请检查浏览器存储或刷新后重试。',
      );
      render();
      if (result.ok && mobile()) app.scrollTo(0, 0);
      return result.ok;
    }
    element('start').onclick = () => {
      if (lobby.isJoined()) element(mobile() ? 'mobile-room' : 'open-room').click();
      else void startExploration();
    };
    element('extract').onclick = () => {
      const result = controller.startExtraction();
      if (result.ok) {
        sound.play('home');
      }
      render();
    };
    element('abandon').onclick = () => {
      if (!confirm('确定放弃本次探索吗？本局携带物（包括从仓库带入的物品）将全部损失。')) {
        return;
      }
      controller.abandon();
      sound.setMusic(false);
      render();
    };
    element('next').onclick = () => {
      controller.prepareNext();
      sound.setMusic(false);
      render();
      if (lobby.isJoined()) element(mobile() ? 'mobile-room' : 'open-room').click();
      if (mobile()) app.scrollTo(0, 0);
    };
    element('retry-save').onclick = async () => {
      await controller.retrySettlement();
      render();
    };
    element('reset-save').onclick = async () => {
      if (controller.getView().phase !== 'preparing') {
        notify('请先结束本局并返回准备页。');
        return;
      }
      if (confirm('确定清空当前账号的云端仓库、图鉴和探索进度？该操作不能撤销，建议先导出备份。')) {
        try {
          await save.reset();
          render();
          notify('当前账号云存档已重置。');
        } catch {
          notify('重置失败，原有存档未确认改动。');
        }
      }
    };
    element('export-save').onclick = () => {
      const blob = new Blob([save.exportRaw()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'bjtu-treasure-hunt-save-v3.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    if (import.meta.env.DEV) {
      element('debug-panel').hidden = false;
      element('damage').onclick = () => {
        controller.applyDamage(25);
        render();
      };
      element('fatal').onclick = () => {
        controller.applyDamage(RAID_RULES.maxHealth);
        render();
      };
    }
    render();
    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        save.close();
        lobby.dispose();
        network.close();
        sound.dispose();
        disposeLayout();
        controller.dispose();
        touch.dispose();
        game.destroy(true);
        unlock();
      });
    }
  }
  await bootstrap().catch((error: unknown) => {
    notify(error instanceof Error ? error.message : '启动失败，请查看开发控制台。');
    element('interaction-label').textContent = '启动尚未完成';
    console.error('Bootstrap failed', error);
  });
}
