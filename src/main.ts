import './style.css';
import { createGame } from './app/create-game';
import { HEALING_AMOUNTS, ITEM_DEFINITIONS, RAID_RULES } from './config/game-config';
import { ReferenceInventory } from './modules/inventory/reference-inventory';
import { RaidController } from './modules/raid/raid-controller';
import { FORMAL_SAVE_KEY, PersistentSave } from './modules/save/persistent-save';
import { acquireSaveLock } from './modules/save/single-writer';
import { mountShell } from './modules/ui/reference-shell';
import { bindGameRules } from './modules/ui/game-rules';
import { renderChapterUnlock, renderCodexPanel, renderQuestPanel } from './modules/ui/quest-view';
import { chapterUnlockGranted, questProgress } from './modules/quests/quest-service';
import { WorldScene } from './scenes/world-scene';
import { EventBus } from './shared/events/game-events';
import type { ItemInstance } from './shared/types/game';
import { TouchControls } from './modules/world/touch-controls';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element: ${id}`);
  }
  return node as T;
}
const app = element('app');
mountShell(app);
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
  const unlock = await acquireSaveLock();
  if (!unlock) {
    throw new Error('另一个标签页正在使用这个存档，请关闭它后刷新本页。');
  }
  let save: PersistentSave;
  try {
    save = new PersistentSave(localStorage);
  } catch (error) {
    unlock();
    element<HTMLButtonElement>('reset-save').disabled = true;
    // Recovery happens while holding the lock; a separate confirmed action reacquires it.
    element<HTMLButtonElement>('reset-save').disabled = false;
    element('reset-save').onclick = async () => {
      const release = await acquireSaveLock();
      if (!release) {
        notify('其他标签页正在使用存档。');
        return;
      }
      try {
        if (confirm('建议先导出原始存档。确定清空本框架的损坏存档吗？')) {
          localStorage.removeItem(FORMAL_SAVE_KEY);
          location.reload();
        }
      } finally {
        release();
      }
    };
    throw error;
  }
  const recovered = save.recoverInterrupted();
  if (recovered) {
    notify('检测到上次未结束的探索，已按中断失败处理；未带入仓库的物品不受影响。');
  }
  const events = new EventBus();
  const inventory = new ReferenceInventory(events, RAID_RULES.bagCapacity, ITEM_DEFINITIONS);
  const controller = new RaidController(inventory, save, events, RAID_RULES, ITEM_DEFINITIONS);
  let lastInventory = '';
  let lastWarehouse = '';
  let lastCodex = '';
  let renderedAt = 0;
  let interacted = '';
  let searchProgress = 0;
  const touch = new TouchControls(element('touch-controls'));
  const scene = new WorldScene({
    controller,
    inventory,
    events,
    notify,
    touch,
    onFrame: (interaction, progress) => {
      interacted = interaction;
      searchProgress = progress;
      if (performance.now() - renderedAt > 80) {
        render();
        renderedAt = performance.now();
      }
    },
  });
  const game = createGame(scene);
  bindGameRules(
    () => {
      controller.pause();
      scene.clearInteractions();
      render();
    },
    () => {
      scene.clearInteractions();
      controller.resume();
      render();
    },
  );

  function render(): void {
    const view = controller.getView();
    const lighting = scene.getLightingStatus();
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
    element('phase-label').textContent = phaseNames[view.phase];
    element('health').textContent = String(view.health);
    const seconds = Math.ceil(view.remainingMs / 1000);
    element('timer').textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    element('loot-value').textContent = String(view.value);
    element<HTMLProgressElement>('value-progress').value = view.value;
    element('battery').textContent = `${lighting.battery}% · ${lighting.enabled ? '开启' : '关闭'}`;
    element('light-reserves').textContent =
      `备用电池 ${lighting.spareBatteries} · 照明棒 ${lighting.flares}`;
    element<HTMLProgressElement>('battery-progress').value = lighting.battery;
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
      view.isBusy || !element<HTMLInputElement>('risk-consent').checked;
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
    const signature = JSON.stringify(carried);
    if (signature !== lastInventory) {
      renderInventory(carried);
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
        select.add(new Option(ITEM_DEFINITIONS[item.itemId]?.name ?? item.itemId, item.instanceId));
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
      lastCodex = codexSignature;
    }
  }

  function renderInventory(items: readonly ItemInstance[]): void {
    element('bag-count').textContent = `${items.length} / ${RAID_RULES.bagCapacity}`;
    const list = element('inventory');
    list.replaceChildren();
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '还没有物资，靠近金色搜索点试试。';
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
      sub.textContent =
        item.origin.kind === 'carry-in'
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
          const consumed = inventory.consumeHealing(item.instanceId, () => controller.heal(amount));
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
  element('start').onclick = async () => {
    if (!element<HTMLInputElement>('risk-consent').checked) {
      return;
    }
    const selected = element<HTMLSelectElement>('loadout').value;
    const result = await controller.start(selected ? [selected] : []);
    notify(
      result.ok
        ? '探索开始。当前物资价值达到 100 后，回到南侧撤离点。'
        : '无法保存开局，请检查浏览器存储或刷新后重试。',
    );
    render();
    if (result.ok && matchMedia('(max-width: 950px)').matches) {
      element('game-canvas')
        .closest('.map-panel')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  };
  element('extract').onclick = () => {
    controller.startExtraction();
    render();
  };
  element('abandon').onclick = () => {
    controller.abandon();
    render();
  };
  element('next').onclick = () => {
    controller.prepareNext();
    render();
  };
  element('retry-save').onclick = async () => {
    await controller.retrySettlement();
    render();
  };
  element('reset-save').onclick = () => {
    if (controller.getView().phase !== 'preparing') {
      notify('请先结束本局并返回准备页。');
      return;
    }
    if (confirm('确定清空本框架的联调仓库与图鉴？该操作不能撤销。')) {
      try {
        save.reset();
        render();
        notify('联调存档已重置。');
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
    link.download = 'bjtu-treasure-hunt-save-v2.json';
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
      controller.dispose();
      touch.dispose();
      game.destroy(true);
      unlock();
    });
  }
}
void bootstrap().catch((error: unknown) => {
  notify(error instanceof Error ? error.message : '启动失败，请查看开发控制台。');
  element('interaction-label').textContent = '启动尚未完成';
  console.error('Bootstrap failed', error);
});
