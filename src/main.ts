import './style.css';
import './mobile-layout.css';
import { bindMobileLayout, isTouchLayout, requestLandscape } from './modules/ui/mobile-layout';
import { createGame } from './app/create-game';
import { HEALING_AMOUNTS, ITEM_DEFINITIONS, RAID_RULES } from './config/game-config';
import { ReferenceInventory } from './modules/inventory/reference-inventory';
import { RaidController } from './modules/raid/raid-controller';
import { FORMAL_SAVE_KEY, PersistentSave } from './modules/save/persistent-save';
import { acquireSaveLock } from './modules/save/single-writer';
import { mountShell } from './modules/ui/reference-shell';
import { bindGameRules } from './modules/ui/game-rules';
import { canStartRaid, shouldShowPrepView } from './modules/ui/prep-view';
import {
  renderChapterLock,
  renderChapterUnlock,
  renderCodexPanel,
  renderQuestPanel,
} from './modules/ui/quest-view';
import { chapterUnlockGranted, questProgress } from './modules/quests/quest-service';
import { bindStoryDialog, stepForEvidence } from './modules/ui/story-dialog';
import { createTypewriter } from './modules/ui/typewriter';
import {
  PROLOGUE_AFTER_PAPER,
  PROLOGUE_OPENING,
  PROLOGUE_SEGMENTS,
} from './modules/ui/prologue-text';
import {
  interruptedText,
  refusalText,
  valueGapText,
  type ExtractionSnapshot,
} from './modules/ui/extraction-feedback';
import { renderCodex, exportCodexImage } from './modules/ui/codex';
import { WorldScene } from './scenes/world-scene';
import { EventBus } from './shared/events/game-events';
import type { ItemInstance } from './shared/types/game';
import { TouchControls } from './modules/world/touch-controls';
import { SoundManager } from './modules/ui/sound-manager';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element: ${id}`);
  }
  return node as T;
}
const app = element('app');
// 序章是首屏画板：不恢复上次滚动位置，否则画板会被页面滚动带偏、露出下面的准备页。
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}
mountShell(app);
// 一级大厅导航只切换页面内容，不改变对局状态；各模块可独立接入后端数据。
const lobbyTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-lobby-tab]'));
const lobbyPanels = Array.from(document.querySelectorAll<HTMLElement>('[data-lobby-panel]'));
for (const tab of lobbyTabs) {
  tab.addEventListener('click', () => {
    const target = tab.dataset.lobbyTab;
    if (!target) return;
    for (const item of lobbyTabs) {
      const active = item === tab;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    }
    for (const panel of lobbyPanels) {
      const active = panel.dataset.lobbyPanel === target;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    }
  });
}

type PrologueMode = 'intro' | 'discovery' | 'clue' | 'story';
let prologueMode: PrologueMode = 'intro';
let prologueReturnMode: 'discovery' | 'story' = 'discovery';
let prologuePaperExamined = false;
const prologueImage = element<HTMLImageElement>('prologue-image');

/** 序章台词结束：开场段读完进入「调查草稿纸」，后半段读完进入准备页。 */
const finishPrologueNarration = (): void => {
  if (prologueMode === 'intro') {
    prologueMode = 'discovery';
    renderPrologue();
    return;
  }
  closePrologue();
};

// 与剧情弹窗共用同一套「旁白」台词卡。
const prologueTypewriter = createTypewriter(
  {
    label: element('prologue-story-label'),
    speaker: element('prologue-story-speaker'),
    line: element('prologue-story-line'),
    progress: element('prologue-story-progress'),
    hint: element('prologue-story-hint'),
  },
  () => finishPrologueNarration(),
);

/** 规则 / 图鉴等弹层打开时不抢台词，等它关掉再开始打字。 */
const narrationBlocked = (): boolean => document.querySelector('dialog[open]') !== null;

const playPrologueNarration = (): void => {
  if (narrationBlocked()) return;
  if (prologueMode === 'intro') {
    prologueTypewriter.play(PROLOGUE_OPENING, {
      progressOffset: 0,
      progressTotal: PROLOGUE_SEGMENTS.length,
      lastHint: '继续调查 ▸',
    });
  } else if (prologueMode === 'story') {
    prologueTypewriter.play(PROLOGUE_AFTER_PAPER, {
      progressOffset: PROLOGUE_OPENING.length,
      progressTotal: PROLOGUE_SEGMENTS.length,
      lastHint: '前往准备 ▸',
    });
  }
};

/** 弹层关闭后回到序章台词（进度重新从当前段开始，不影响流程）。 */
const resumePrologueNarration = (): void => {
  if (element('prologue').hidden) return;
  if (prologueMode === 'intro' || prologueMode === 'story') playPrologueNarration();
};

const renderPrologue = (): void => {
  const clue = prologueMode === 'clue';
  const narrating = prologueMode === 'intro' || prologueMode === 'story';
  element('prologue-story-overlay').hidden = !narrating;
  element('prologue-paper-hit').hidden = clue || prologueMode === 'intro' || prologuePaperExamined;
  element('prologue-continue-hit').hidden = prologueMode !== 'discovery';
  element('prologue-continue-hint').hidden = prologueMode !== 'discovery';
  element('prologue-clue-later').hidden = !clue;
  element('prologue-clue-close').hidden = !clue;
  element('prologue-progress').textContent = clue
    ? '序章 · 线索'
    : narrating
      ? '序章 · 晚归'
      : '序章 · 调查';
  const imageSrc = clue ? '/images/prologue-paper-examined.svg' : '/images/prologue-discovery.svg';
  if (prologueImage.getAttribute('src') !== imageSrc) prologueImage.src = imageSrc;
  if (narrating) playPrologueNarration();
  else prologueTypewriter.stop();
};

const closePrologue = (): void => {
  prologueTypewriter.stop();
  element('prologue').hidden = true;
  document.documentElement.classList.remove('prologue-open');
  element<HTMLButtonElement>('start').focus();
};
element('prologue-story-box').addEventListener('click', () => {
  if (prologueMode === 'intro' || prologueMode === 'story') prologueTypewriter.advance();
});
element('prologue-paper-hit').onclick = () => {
  if (prologueMode !== 'discovery' && prologueMode !== 'story') return;
  prologueReturnMode = prologueMode;
  prologueTypewriter.stop();
  prologueMode = 'clue';
  renderPrologue();
};
element('prologue-continue-hit').onclick = () => {
  prologueMode = 'story';
  renderPrologue();
};
element('prologue-continue-hint').onclick = () => {
  prologueMode = 'story';
  renderPrologue();
};
element('prologue-clue-later').onclick = () => {
  prologueMode = prologueReturnMode;
  renderPrologue();
};
element('prologue-clue-close').onclick = () => {
  prologuePaperExamined = true;
  prologueMode = prologueReturnMode;
  renderPrologue();
};
element('prologue-skip').onclick = () => closePrologue();
element('prologue').addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    if (prologueMode === 'clue') element('prologue-clue-later').click();
    else closePrologue();
    return;
  }
  if (
    event.key.toLowerCase() === 'e' &&
    (prologueMode === 'discovery' || prologueMode === 'story')
  ) {
    event.preventDefault();
    element('prologue-paper-hit').click();
    return;
  }
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target instanceof HTMLButtonElement) return;
  event.preventDefault();
  if (prologueMode === 'clue') element('prologue-clue-close').click();
  else if (prologueMode === 'discovery') element('prologue-continue-hit').click();
  else prologueTypewriter.advance();
});
renderPrologue();
// 序章是全屏画板：锁住页面滚动并把滚动位置归零，避免画板被卷走、露出下面的准备页内容。
document.documentElement.classList.add('prologue-open');
window.scrollTo(0, 0);
element('app').scrollTop = 0;
// 首次渲染时「游戏规则」可能在同一轮里自动打开，等它落定再决定是否开始打字。
prologueTypewriter.stop();
setTimeout(resumePrologueNarration, 0);
element('prologue').focus();
const settings = document.createElement('section');
settings.className = 'side-card settings';
settings.innerHTML =
  '<h2>设置</h2><label>游戏音量 <input id="sound-volume" type="range" min="0" max="1" step="0.05" value="0.8"></label><label>界面亮度 <input id="screen-brightness" type="range" min="0.65" max="1.2" step="0.05" value="1"></label>';
document.querySelector('#lobby-settings-slot')?.append(settings);
const notify = (message: string) => {
  element('notice').textContent = message;
};
let mapToastTimer: number | undefined;
/** R02：撤离相关的拒绝与中断原因要落在画面内，侧栏状态行只作补充。 */
const showMapToast = (message: string, ms = 3200): void => {
  const toast = element('map-toast');
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(mapToastTimer);
  mapToastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, ms);
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
  // R02：记录读条开始时的状态，用来判断读条为什么被取消。
  let extractionSnapshot: ExtractionSnapshot | null = null;
  let enteredExtractionZone = false;
  let leftExtractionZone = false;
  let zoneRaidId: string | null = null;
  const touch = new TouchControls(element('touch-controls'));
  const sound = new SoundManager();
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
    controller,
    inventory,
    events,
    notify,
    touch,
    sound,
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
  let storyOpen = false;
  const mobile = isTouchLayout;
  const syncOrientation = () => {
    const view = controller.getView();
    const active = view.phase === 'active' || view.phase === 'extracting';
    app.dataset.mobile = String(mobile());
    element('rotate-phone').hidden = true;
    if (active && (rulesOpen || mapOpen || codexOpen || storyOpen)) {
      if (!controller.isPaused()) {
        controller.pause();
        scene.clearInteractions();
      }
    } else if (!rulesOpen && !mapOpen && !codexOpen && !storyOpen) controller.resume();
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
      // 规则弹窗盖住序章时，台词先停下，关掉后再继续。
      prologueTypewriter.stop();
      controller.pause();
      scene.clearInteractions();
      render();
    },
    () => {
      scene.clearInteractions();
      rulesOpen = false;
      syncOrientation();
      render();
      resumePrologueNarration();
    },
  );
  // 剧情弹窗（复用规则弹窗骨架）：打开时暂停对局，关闭后恢复。
  const story = bindStoryDialog(
    () => {
      storyOpen = true;
      controller.pause();
      scene.clearInteractions();
      render();
    },
    () => {
      scene.clearInteractions();
      storyOpen = false;
      render();
    },
  );
  // 每局只弹一次的剧情键：`${raidId}:${itemId}` 为线索，`${raidId}:ending` 为结尾。
  const storyShownPerRaid = new Set<string>();
  events.on('ItemPicked', ({ raidId, item }) => {
    const step = stepForEvidence(item.itemId);
    if (!step) return;
    const key = `${raidId}:${item.itemId}`;
    if (storyShownPerRaid.has(key)) return;
    storyShownPerRaid.add(key);
    story.open({ kind: 'step', step });
  });
  // 剧情档案的「回看」按钮随存档状态重渲染，用事件委托绑定。
  element('story-archive').addEventListener('click', (event) => {
    if ((event.target as HTMLElement).id === 'open-story') {
      story.open({ kind: 'full-chapter' });
    }
  });

  function render(): void {
    syncOrientation();
    const view = controller.getView();
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
    const paused = controller.isPaused();
    const playable = !paused && (view.phase === 'active' || view.phase === 'extracting');
    touch.setEnabled(playable);
    app.dataset.phase = view.phase;
    document.documentElement.classList.toggle('lobby-open', view.phase === 'preparing');
    // R02：读条被价值跌破、受伤、离开区域或暂停打断时，在画面内说明原因。
    if (view.phase === 'extracting') {
      extractionSnapshot = {
        value: view.value,
        inZone: view.inExtractionZone,
        health: view.health,
        paused,
      };
    } else if (extractionSnapshot) {
      const interrupted = interruptedText(extractionSnapshot, view, paused);
      extractionSnapshot = null;
      if (interrupted) {
        notify(interrupted);
        showMapToast(interrupted);
      }
    }
    // 出生点就在南门撤离区：只有「先真正进过撤离区、再走出去、再走回来」才提示差额。
    if (view.raidId !== zoneRaidId) {
      zoneRaidId = view.raidId;
      enteredExtractionZone = false;
      leftExtractionZone = false;
    }
    if (view.phase === 'active' && view.inExtractionZone) {
      if (!enteredExtractionZone) {
        enteredExtractionZone = true;
        leftExtractionZone = false;
      } else if (leftExtractionZone) {
        leftExtractionZone = false;
        if (view.value < view.threshold) {
          showMapToast(valueGapText(view.value, view.threshold));
        }
      }
    } else if (view.phase === 'active' && enteredExtractionZone) {
      leftExtractionZone = true;
    }
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
    element('battery').textContent = `${lighting.battery}% · ${lighting.enabled ? '开启' : '关闭'}`;
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
    element('prep-view').hidden = !shouldShowPrepView(view.phase);
    element('inventory-panel').hidden = !playable;
    element('result-panel').hidden = !['settling', 'success', 'failed'].includes(view.phase);
    element<HTMLButtonElement>('start').disabled = !canStartRaid({
      busy: view.isBusy,
      consented: element<HTMLInputElement>('risk-consent').checked,
    });
    // R02：按钮不再因为「不在区域 / 价值不足」直接禁用，否则点了没有任何反馈。
    element<HTMLButtonElement>('extract').disabled = !playable || view.phase === 'extracting';
    element('extract').textContent =
      view.phase === 'extracting'
        ? '正在撤离，请保持停留…'
        : !view.inExtractionZone
          ? '请前往南侧撤离点'
          : view.value < view.threshold
            ? `还差 ${view.threshold - view.value} 价值 · 点此查看`
            : '开始撤离 · 5 秒';
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
    element('warehouse-count-label').textContent = `${archive.warehouse.length} 件物品`;
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
    const unlocked = view.result !== null && chapterUnlockGranted(view.result);
    renderChapterUnlock(element('quest-unlock'), unlocked);
    // R07：成功撤离但证据不齐时，说明本章为什么还没解锁。
    renderChapterLock(element('quest-lock'), view.result);
    // 结尾剧情（剧情稿 6.4）：成功撤离解锁章节后自动弹出一次。
    if (unlocked) {
      const key = `${view.raidId}:ending`;
      if (!storyShownPerRaid.has(key)) {
        storyShownPerRaid.add(key);
        story.open({ kind: 'ending' });
      }
    }
    const codexSignature = JSON.stringify([archive.codexIds, archive.unlockedChapterIds]);
    if (codexSignature !== lastCodex) {
      renderCodexPanel(element('codex-list'), element('story-archive'), archive);
      if (codex.open) renderCodex(archive.codexIds, archive.unlockedChapterIds);
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
    // 开场剧情已在序章（prologue）呈现，这里不再重复弹窗。
    if (result.ok && mobile()) app.scrollTo(0, 0);
  };
  element('extract').onclick = () => {
    const current = controller.getView();
    const result = controller.startExtraction();
    if (result.ok) {
      sound.play('home');
      showMapToast('开始撤离 · 请留在南门区域内 5 秒');
    } else {
      const reason = refusalText(result.error, current, controller.isPaused());
      notify(reason);
      showMapToast(reason);
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
    if (mobile()) app.scrollTo(0, 0);
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
    // R02 人工验收需要精确的价值（75 / 110 / 85），宝箱随机难以凑数，这里给个 dev 专用发放按钮。
    const grantLoot = (itemId: string) => {
      const raidId = controller.getView().raidId;
      if (raidId === null) {
        notify('请先开始一局探索。');
        return;
      }
      const result = inventory.addLoot({
        instanceId: `debug-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        itemId,
        origin: { kind: 'raid-loot', obtainedInRaidId: raidId },
      });
      notify(
        result.ok
          ? `调试：已发放 ${ITEM_DEFINITIONS[itemId]?.name ?? itemId}。`
          : '调试：背包已满，先丢弃一件再发放。',
      );
      render();
    };
    element('debug-grant-uncommon').onclick = () => grantLoot('window-seat');
    element('debug-grant-epic').onclick = () => grantLoot('gpa-charm');
  }
  render();
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      sound.dispose();
      disposeLayout();
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
