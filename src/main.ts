import './style.css';
import { createGame } from './app/create-game';
import { ITEM_DEFINITIONS, RAID_RULES } from './config/game-config';
import { ReferenceInventory } from './modules/inventory/reference-inventory';
import { RaidController } from './modules/raid/raid-controller';
import { ReferenceSave, SAVE_KEY } from './modules/save/reference-save';
import { acquireSaveLock } from './modules/save/single-writer';
import { mountShell } from './modules/ui/reference-shell';
import { WorldScene } from './scenes/world-scene';
import { EventBus } from './shared/events/game-events';
import type { ItemInstance } from './shared/types/game';

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
  let save: ReferenceSave;
  try {
    save = new ReferenceSave(localStorage);
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
          localStorage.removeItem(SAVE_KEY);
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
  let renderedAt = 0;
  let interacted = '';
  let searchProgress = 0;
  const scene = new WorldScene({
    controller,
    inventory,
    events,
    notify,
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

  function render(): void {
    const view = controller.getView();
    const playable = view.phase === 'active' || view.phase === 'extracting';
    element('phase-label').textContent = phaseNames[view.phase];
    element('health').textContent = String(view.health);
    const seconds = Math.ceil(view.remainingMs / 1000);
    element('timer').textContent =
      `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    element('loot-value').textContent = String(view.value);
    element<HTMLProgressElement>('value-progress').value = view.value;
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
    const signature = JSON.stringify(carried);
    if (signature !== lastInventory) {
      renderInventory(carried);
      lastInventory = signature;
    }
    const archive = save.view();
    const warehouseSignature = JSON.stringify(archive.warehouse);
    element('warehouse-count').textContent = `${archive.warehouse.length} 件`;
    element('archive-detail').textContent = archive.codexIds.length
      ? `已点亮 ${archive.codexIds.length} 种图鉴；剧情待 D 接入。`
      : '成功撤离后，物品和图鉴会保存在此浏览器。';
    if (lastWarehouse !== warehouseSignature) {
      const select = element<HTMLSelectElement>('loadout');
      select.replaceChildren(new Option('轻装出发 · 不带入物品', ''));
      for (const item of archive.warehouse) {
        select.add(new Option(ITEM_DEFINITIONS[item.itemId]?.name ?? item.itemId, item.instanceId));
      }
      lastWarehouse = warehouseSignature;
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
          if (inventory.remove(item.instanceId).ok) {
            controller.heal(25);
            if (state.raidId) {
              events.emit('ItemConsumed', { raidId: state.raidId, instanceId: item.instanceId });
            }
            notify('恢复物已消耗，当前携带价值已重算。');
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
      game.destroy(true);
      unlock();
    });
  }
}

element('export-save').onclick = () => {
  const blob = new Blob([localStorage.getItem(SAVE_KEY) ?? '{}'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'bjtu-framework-save.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
void bootstrap().catch((error: unknown) => {
  notify(error instanceof Error ? error.message : '启动失败，请查看开发控制台。');
  element('interaction-label').textContent = '启动尚未完成';
  console.error('Bootstrap failed', error);
});
