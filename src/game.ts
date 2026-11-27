import { bindRaidInventory } from './modules/ui/raid-inventory';
import { bindRaidHotbar } from './modules/ui/raid-hotbar';
import { isHotbarItem } from './modules/inventory/raid-hotbar';
import { RAID_INVENTORY_CAPACITIES } from './modules/inventory/inventory-sections';
import './raid-hud.css';
import './style.css';
import './mobile-layout.css';
import './archive-browser.css';
import './friends.css';
import './leaderboard.css';
import './explore-loader.css';
import './warehouse-panel.css';
import './bag-panel.css';
import './shop.css';
import './room-page.css';
import './immersive.css';
import { bindMobileLayout, isTouchLayout, requestLandscape } from './modules/ui/mobile-layout';
import { GameFullscreen } from './modules/ui/game-fullscreen';
import { createGame } from './app/create-game';
import {
  BAG_CAPACITY,
  HEALING_AMOUNTS,
  isCarryInAllowed,
  ITEM_DEFINITIONS,
  itemValueFor,
  RAID_RULES,
  UTILITY_EFFECTS,
} from './config/game-config';
import { COMBAT_RULES } from './config/combat-config';
import { isCombatWeaponId } from './modules/world/night-systems';
import { bindShopCategories, renderShop, renderWardrobe, SHOP_EFFECTS } from './modules/ui/shop';
import { renderMailPanel } from './modules/ui/mail-panel';
import { createFriendsPanel } from './modules/ui/friends-panel';
import { SocialClient } from './modules/social/social-client';
import { LeaderboardClient } from './modules/social/leaderboard-client';
import { createLeaderboardPanel } from './modules/ui/leaderboard-panel';
import { ReferenceInventory } from './modules/inventory/reference-inventory';
import { RaidController } from './modules/raid/raid-controller';
import { FORMAL_SAVE_KEY, SKIN_DEFINITIONS } from './modules/save/persistent-save';
import { acquireSaveLock } from './modules/save/single-writer';
import { mountShell } from './modules/ui/reference-shell';
import { createExploreLoader } from './modules/ui/explore-loader';
import { bindGameRules } from './modules/ui/game-rules';
import { bindConfirmDialog } from './modules/ui/confirm-dialog';
import { canStartRaid, shouldShowPrepView } from './modules/ui/prep-view';
import {
  renderChapterLock,
  renderChapterUnlock,
  renderCodexPanel,
  renderLobbyMissions,
  renderPrepGoals,
  renderQuestPanel,
} from './modules/ui/quest-view';
import {
  activeQuestChapter,
  chapterUnlockGranted,
  questChapterForEvidence,
  questProgress,
} from './modules/quests/quest-service';
import { chapterContentById } from './modules/quests/chapter-content';
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
import { exportCodexImage } from './modules/ui/codex';
import { renderArchiveBrowser } from './modules/ui/archive-browser';
import {
  mountWarehousePanel,
  refreshWarehouseCarry,
  renderWarehousePanel,
  type WarehouseCarryApi,
} from './modules/ui/warehouse-panel';
import { renderBagPanel } from './modules/ui/bag-panel';
import { createTutorial, renderTutorial, tutorialStore } from './modules/ui/tutorial';
import { FormalWorldScene as WorldScene } from './scenes/formal-world-scene';
import { contains } from './modules/world/movement';
import { activeMap } from './config/play-map';
import { EventBus } from './shared/events/game-events';
import type { InventoryClientPort, ItemInstance, RaidControllerPort } from './shared/types/game';
import { TouchControls } from './modules/world/touch-controls';
import { SoundManager } from './modules/ui/sound-manager';
import { assetUrl } from './app/asset-url';

import { NetworkSession } from './modules/network/network-session';
import { onlineUnlockProgress } from './modules/network/online-unlock';
import { bindRoomLobby } from './modules/ui/room-lobby';
import { bindStage } from './modules/ui/stage';
import type { AccountUser } from './modules/auth/auth-client';
import { accountStorage } from './modules/save/account-storage';

import { CloudSave } from './modules/save/cloud-save';
import { HttpCloudSaveApi } from './modules/save/cloud-save-api';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element: ${id}`);
  }
  return node as T;
}

export async function startGame(user: AccountUser, logout: () => Promise<void>): Promise<void> {
  const app = element('app');
  // 序章是首屏画板：不恢复上次滚动位置，否则画板会被页面滚动带偏、露出下面的准备页。
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }
  mountShell(app);
  const confirmDialog = bindConfirmDialog();
  // 开局过场遮罩：构造即开始预热 710KB 视频，点「开始探索」时才不会白屏。
  const exploreLoader = createExploreLoader();
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
      // 好友面板按需拉取名册：只在切到该页签时刷新，避免每次开面板都打接口。
      document.dispatchEvent(new CustomEvent('lobby:tab', { detail: target }));
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
    element('prologue-paper-hit').hidden =
      clue || prologueMode === 'intro' || prologuePaperExamined;
    element('prologue-continue-hit').hidden = prologueMode !== 'discovery';
    element('prologue-continue-hint').hidden = prologueMode !== 'discovery';
    element('prologue-clue-later').hidden = !clue;
    element('prologue-clue-close').hidden = !clue;
    element('prologue-progress').textContent = clue
      ? '序章 · 线索'
      : narrating
        ? '序章 · 晚归'
        : '序章 · 调查';
    const imageSrc = clue
      ? assetUrl('images/prologue-paper-examined.svg')
      : assetUrl('images/prologue-discovery.svg');
    if (prologueImage.getAttribute('src') !== imageSrc) prologueImage.src = imageSrc;
    if (narrating) playPrologueNarration();
    else prologueTypewriter.stop();
  };

  const closePrologue = (): void => {
    prologueTypewriter.stop();
    element('prologue').hidden = true;
    document.documentElement.classList.remove('prologue-open');
    try {
      localStorage.setItem(`bjtu-prologue:${user.id}`, 'seen');
    } catch {
      // UI preferences must not prevent entering the lobby.
    }
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
  let prologueSeen = false;
  try {
    prologueSeen = localStorage.getItem(`bjtu-prologue:${user.id}`) === 'seen';
  } catch {
    // Continue with the skippable prologue when preferences are unavailable.
  }
  renderPrologue();
  // 序章是全屏画板：锁住页面滚动并把滚动位置归零，避免画板被卷走、露出下面的准备页内容。
  document.documentElement.classList.toggle('prologue-open', !prologueSeen);
  element('prologue').hidden = prologueSeen;
  window.scrollTo(0, 0);
  element('app').scrollTop = 0;
  // 首次渲染时「游戏规则」可能在同一轮里自动打开，等它落定再决定是否开始打字。
  prologueTypewriter.stop();
  setTimeout(resumePrologueNarration, 0);
  if (!prologueSeen) element('prologue').focus();
  element('reload-game').onclick = () => location.reload();
  const settings = document.createElement('section');
  settings.className = 'side-card settings';
  settings.innerHTML =
    '<h2>设置</h2><label>游戏音量 <input id="sound-volume" type="range" min="0" max="1" step="0.05" value="0.8"></label><label>界面亮度 <input id="screen-brightness" type="range" min="0.65" max="1.2" step="0.05" value="1"></label>';
  document.querySelector('#lobby-settings-slot')?.append(settings);
  const account = document.createElement('section');
  account.className = 'side-card settings';
  account.innerHTML =
    '<h2>当前账号</h2><p id="account-label"></p><p id="cloud-save-status" role="status">正在读取云端进度…</p><button id="account-logout" class="secondary">退出登录</button><button id="account-import-legacy" class="text-button" hidden>迁移此浏览器的旧存档</button>';
  settings.before(account);
  element('account-label').textContent = `${user.displayName}（${user.username}）`;
  element('lobby-player-name').textContent = user.displayName;
  element('lobby-player-avatar').textContent = user.displayName.slice(0, 1);
  element<HTMLInputElement>('network-name').value = user.displayName;
  element<HTMLInputElement>('network-name').readOnly = true;
  element('network-name').title = '联机昵称使用当前登录账号的昵称';
  let allowLogout: () => boolean | Promise<boolean> = () => true;
  element('account-logout').onclick = async () => {
    if (!(await allowLogout())) return;
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

  let noticeTimer: number | undefined;
  const notify = (message: string) => {
    // 提示改成浮动 toast：弹出后 3.2 秒自动消失，不再常驻大厅底部
    const notice = element('notice');
    notice.textContent = message;
    notice.hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      notice.hidden = true;
    }, 3200);
    if (['active', 'extracting'].includes(app.dataset.phase ?? '')) showMapToast(message);
  };
  const profileStatus = element('profile-status');
  const profileHistory = element<HTMLOListElement>('profile-history');
  const renderProfile = async (): Promise<void> => {
    profileStatus.textContent = '正在读取玩家档案…';
    try {
      const response = await fetch('/api/profile/self', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      const profile = (await response.json()) as {
        uid?: string;
        displayName?: string;
        publicCollections?: boolean;
        save?: {
          codexIds?: unknown[];
          warehouse?: unknown[];
          unlockedChapterIds?: unknown[];
          equippedSkinId?: string;
        } | null;
        raids?: Array<{
          recordedAt?: string;
          result?: {
            outcome?: string;
            reason?: string;
            value?: number;
            raidId?: string;
            items?: unknown[];
          };
        }>;
      };
      if (!response.ok) throw new Error('玩家档案读取失败。');
      const save = profile.save ?? {};
      const raids = Array.isArray(profile.raids) ? profile.raids : [];
      element('profile-display-name').textContent = profile.displayName ?? user.displayName;
      element('profile-uid').textContent = profile.uid ?? user.id;
      element('profile-outfit').textContent =
        SKIN_DEFINITIONS.find((skin) => skin.id === save.equippedSkinId)?.name ??
        SKIN_DEFINITIONS[0].name;
      element('profile-chapters').textContent = String(save.unlockedChapterIds?.length ?? 0);
      element('profile-codex').textContent = String(save.codexIds?.length ?? 0);
      element('profile-warehouse').textContent = String(save.warehouse?.length ?? 0);
      element('profile-raids').textContent = String(raids.length);
      element<HTMLInputElement>('profile-public').checked = profile.publicCollections === true;
      profileHistory.replaceChildren();
      for (const entry of raids) {
        const result = entry.result;
        if (!result) continue;
        const row = document.createElement('li');
        const outcome =
          result.outcome === 'success' ? '撤离成功' : `行动失败（${result.reason ?? '未知原因'}）`;
        row.textContent = `${new Date(entry.recordedAt ?? '').toLocaleString()} · ${outcome} · 带出价值 ${result.value ?? 0} · ${result.items?.length ?? 0} 件物品`;
        profileHistory.append(row);
      }
      element('profile-history-empty').hidden = raids.length > 0;
      profileStatus.textContent = '档案已更新。';
    } catch (error) {
      profileStatus.textContent = error instanceof Error ? error.message : '玩家档案读取失败。';
    }
  };
  element<HTMLButtonElement>('profile-refresh').onclick = () => void renderProfile();
  element<HTMLInputElement>('profile-public').onchange = async (event) => {
    const input = event.currentTarget as HTMLInputElement;
    try {
      const response = await fetch('/api/profile/privacy', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Game-Request': '1' },
        body: JSON.stringify({ publicCollections: input.checked }),
      });
      if (!response.ok) throw new Error('档案公开设置保存失败。');
      profileStatus.textContent = input.checked
        ? '好友可以查看你的展示藏品和对局摘要。'
        : '档案公开展示已关闭。';
    } catch (error) {
      input.checked = !input.checked;
      profileStatus.textContent = error instanceof Error ? error.message : '档案公开设置保存失败。';
    }
  };
  document.addEventListener('lobby:tab', (event) => {
    if ((event as CustomEvent<string>).detail === 'profile') void renderProfile();
  });
  void renderProfile();
  // R15 好友与私聊：面板随大厅挂载；切到「好友」页签时刷新，可见期间每 6 秒轮询未读。
  const friendsPanel = createFriendsPanel({
    client: new SocialClient(),
    self: { uid: user.id, displayName: user.displayName },
    notify,
  });
  friendsPanel.mount();
  const leaderboardPanel = createLeaderboardPanel(new LeaderboardClient());
  leaderboardPanel.mount();
  let mapToastTimer: number | undefined;
  /** F02：撤离相关的拒绝与中断原因要落在画面内，侧栏状态行只作补充。 */
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
          if (
            await confirmDialog.ask({
              title: '清空损坏存档？',
              message: '建议先导出原始存档。清空后无法恢复。',
              confirmText: '清空存档',
              tone: 'danger',
            })
          ) {
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
    const inventory = new ReferenceInventory(
      events,
      RAID_RULES.bagCapacity,
      ITEM_DEFINITIONS,
      RAID_INVENTORY_CAPACITIES,
    );
    const controller = new RaidController(
      inventory,
      save,
      events,
      RAID_RULES,
      ITEM_DEFINITIONS,
      Date.now,
      () => crypto.randomUUID(),
      () => activeQuestChapter(save.view().unlockedChapterIds)?.id ?? null,
    );
    const migrate = element<HTMLButtonElement>('account-import-legacy');
    migrate.hidden = localStorage.getItem(FORMAL_SAVE_KEY) === null;
    migrate.onclick = async () => {
      if (controller.getView().phase !== 'preparing') {
        notify('请先结束本局并返回准备页，再迁移旧存档。');
        return;
      }
      if (
        !(await confirmDialog.ask({
          title: '迁移旧存档？',
          message:
            '将此浏览器在添加账号前的存档复制到当前账号，并覆盖当前账号进度。建议先导出备份。旧存档会保留。',
          confirmText: '迁移存档',
        }))
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
    allowLogout = async () => {
      const phase = controller.getView().phase;
      if (phase === 'preparing' || phase === 'success' || phase === 'failed') return true;
      return confirmDialog.ask({
        title: '退出当前探索？',
        message: '退出登录会中断本次探索，本局携带物将按中断失败处理。',
        confirmText: '退出登录',
        tone: 'danger',
      });
    };

    let lastInventory = '';
    let lastWarehouse = '';
    let lastCodex = '';
    let lastStatusMarkup = '';
    let renderedAt = 0;
    let interacted = '';
    let searchProgress = 0;
    let buyingItem: string | null = null;
    let changingSkin = false;
    /** 信箱领取：busy 期间禁用按钮，status 是给玩家看的结果文案 */
    let claimingMail = false;
    let mailStatus = '';
    let mailSignature = '';
    /** 带入装备的唯一真源：仓库面板和旧「行前准备」勾选列表都读写这一份 instanceId 集合 */
    const carriedInstances = new Set<string>();
    // F02：记录读条开始时的状态，用来判断读条为什么被取消。
    let extractionSnapshot: ExtractionSnapshot | null = null;
    let enteredExtractionZone = false;
    let leftExtractionZone = false;
    let zoneRaidId: string | null = null;
    const touch = new TouchControls(element('touch-controls'));
    const sound = new SoundManager();
    const networkUrl = new URL('/ws', location.href);
    networkUrl.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const network = new NetworkSession({
      url: networkUrl.href,
      sessionId: crypto.randomUUID(),
      displayName: user.displayName,
    });
    let spectatorTarget: string | null = null;
    let spectatorDismissed = false;
    let deathRound: string | null = null;
    let openedRelic: string | null = null;
    let pendingRelic: {
      roundId: string;
      requestId: string;
      slotId: string;
      itemId: string;
    } | null = null;
    let relicSignature = '';
    const relicDialog = document.createElement('dialog');
    relicDialog.className = 'v19-dialog';
    relicDialog.setAttribute('aria-label', '队友遗物箱');
    relicDialog.innerHTML =
      '<header><h2>队友遗物箱</h2><button type="button">关闭</button></header><div class="relic-slots"></div><p role="status"></p>';
    relicDialog
      .querySelector('header button')!
      .addEventListener('click', () => relicDialog.close());
    relicDialog.addEventListener('close', () => {
      openedRelic = null;
    });
    app.append(relicDialog);
    const spectatorControls = document.createElement('div');
    spectatorControls.className = 'spectator-controls';
    spectatorControls.hidden = true;
    spectatorControls.innerHTML =
      '<strong role="status"></strong><button type="button">切换队友</button><button type="button">查看结算</button>';
    element('team-status').after(spectatorControls);
    const liveTeammates = () =>
      network.getRoomState()?.started
        ? network
            .getRoomState()!
            .players.filter(
              (player) =>
                player.playerId !== network.getPlayerId() &&
                player.connected &&
                !player.finished &&
                !player.dead,
            )
        : [];
    const [switchSpectator, leaveSpectator] = spectatorControls.querySelectorAll('button');
    switchSpectator!.onclick = () => {
      const targets = liveTeammates();
      spectatorTarget =
        targets[
          (targets.findIndex((target) => target.playerId === spectatorTarget) + 1) % targets.length
        ]?.playerId ?? null;
      render();
    };
    leaveSpectator!.onclick = () => {
      spectatorDismissed = true;
      spectatorTarget = null;
      render();
    };
    let sceneReady = false;
    let sceneError = '';
    const lobby = bindRoomLobby({
      network,
      confirm: confirmDialog,
      unlock: () => onlineUnlockProgress(save.view().unlockedChapterIds),
      canEnter: () => onlineUnlockProgress(save.view().unlockedChapterIds).unlocked,
      canPrepare: () =>
        onlineUnlockProgress(save.view().unlockedChapterIds).unlocked &&
        sceneReady &&
        buyingItem === null &&
        !changingSkin &&
        controller.getView().phase === 'preparing' &&
        !controller.getView().isBusy &&
        element<HTMLInputElement>('risk-consent').checked,
      onChange: () => render(),
      onPlayers: (players) =>
        sceneReady &&
        (players.length ? scene.syncRemotePlayers(players) : scene.clearRemotePlayers()),
      onPlayerLeft: (id) => {
        if (sceneReady) scene.removeRemotePlayer(id);
      },
      onStart: async () => {
        if (
          !onlineUnlockProgress(save.view().unlockedChapterIds).unlocked ||
          controller.getView().phase !== 'preparing'
        ) {
          lobby.finish();
          return;
        }
        if (roomOpen) element('close-room').click();
        if (!(await startExploration())) lobby.finish();
      },
    });
    events.on('DamageTaken', ({ health }) => {
      const round = network.getRoomState()?.roundId;
      if (health > 0 || !round || deathRound === round || !network.isInRoom()) return;
      const items: string[] = [];
      let slots = 0;
      for (const item of inventory.getCarriedItems()) {
        if (item.instanceId.includes(':starter:')) continue;
        const size = ITEM_DEFINITIONS[item.itemId]?.bagSlots ?? 1;
        if (slots + size > 6) continue;
        slots += size;
        items.push(item.itemId);
      }
      if (!network.reportDeath(items)) return;
      deathRound = round;
      spectatorDismissed = false;
      spectatorTarget = liveTeammates()[0]?.playerId ?? null;
    });
    events.on('RaidEnded', (result) => {
      if (result.reason !== 'death' || deathRound !== network.getRoomState()?.roundId)
        lobby.finish();
    });
    window.addEventListener('beforeunload', () => network?.close(), { once: true });

    const activeInventory: InventoryClientPort = inventory;
    const activeController: RaidControllerPort = controller;
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
      skinId: () => {
        const archive = save.view();
        return archive.activeRaidSkinId ?? archive.equippedSkinId;
      },
      spectating: () => spectatorTarget,
      openRelics: (ownerId) => {
        openedRelic = ownerId;
        relicSignature = '';
        relicDialog.querySelector('p')!.textContent = '';
        scene.releaseMouse();
        relicDialog.showModal();
        render();
      },
      network,
      controller: activeController,
      inventory: activeInventory,
      inventoryCapacities: RAID_INVENTORY_CAPACITIES,
      useItem: (instanceId) => useRaidItem(instanceId),
      questChapter: () => activeQuestChapter(save.view().unlockedChapterIds)?.id ?? null,
      events,
      notify,
      touch,
      sound,
      onReady: () => {
        sceneReady = true;
        const players = network.getRoomState()?.players;
        if (players) scene.syncRemotePlayers(players);
        render();
      },
      onLoadError: (message) => {
        sceneError = message;
        sceneReady = false;
        notify(message);
        render();
      },
      onFrame: (interaction, progress, prompt) => {
        interacted = interaction;
        searchProgress = progress;
        const feedback = element('key-prompt');
        feedback.hidden =
          !prompt || !!document.querySelector('dialog[open]') || app.dataset.bagOpen === 'true';
        feedback.style.setProperty('--prompt-progress', String(Math.max(0, Math.min(1, progress))));
        if (prompt) {
          element('key-prompt-key').textContent = prompt.key;
          element('key-prompt-label').textContent = prompt.label;
        }
        syncStatusEffects(activeController.getView());
        if (performance.now() - renderedAt > 80) {
          render();
          renderedAt = performance.now();
        }
      },
    });
    network.onMessage((message) => {
      if (message.type === 'room-state' && pendingRelic?.roundId !== message.roundId)
        pendingRelic = null;
      if (message.type !== 'loot-result' || pendingRelic?.requestId !== message.requestId) return;
      const pending = pendingRelic;
      pendingRelic = null;
      const raid = controller.getView();
      const accepted =
        message.status === 'offered' &&
        message.roundId === pending.roundId &&
        message.chestId === pending.slotId &&
        message.itemId === pending.itemId &&
        !!raid.raidId &&
        raid.health > 0 &&
        ['active', 'extracting'].includes(raid.phase) &&
        inventory.addLoot({
          instanceId: `${raid.raidId}:${pending.slotId}`,
          itemId: pending.itemId,
          origin: { kind: 'raid-loot', obtainedInRaidId: raid.raidId },
        }).ok;
      if (message.status === 'offered')
        network.acknowledgeLoot(pending.roundId, pending.requestId, accepted);
      relicDialog.querySelector('p')!.textContent = accepted
        ? '物品已放入背包。'
        : message.status === 'offered'
          ? '背包没有足够空位。'
          : '物品无法领取，请检查距离或刷新箱内物品。';
      render();
    });
    function renderRelics(): void {
      if (!openedRelic || !relicDialog.open) return;
      const state = network.getRoomState();
      const relic = state?.relics?.find((entry) => entry.ownerId === openedRelic);
      if (!state?.roundId || !relic) {
        relicDialog.close();
        return;
      }
      const roundId = state.roundId;
      const signature = JSON.stringify([relic.slots, pendingRelic?.slotId]);
      if (signature === relicSignature) return;
      relicSignature = signature;
      const buttons = relic.slots
        .filter((slot) => slot.claimedBy === null)
        .map((slot) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'shop-action';
          button.textContent = ITEM_DEFINITIONS[slot.itemId]?.name ?? slot.itemId;
          button.style.gridColumn = `span ${ITEM_DEFINITIONS[slot.itemId]?.bagSlots ?? 1}`;
          button.disabled = pendingRelic !== null;
          button.onclick = () => {
            if (pendingRelic) return;
            const requestId = crypto.randomUUID();
            if (!network.sendLootSearch(roundId, requestId, slot.id, 'take')) return;
            pendingRelic = { roundId, requestId, slotId: slot.id, itemId: slot.itemId };
            renderRelics();
          };
          return button;
        });
      const occupied = relic.slots
        .filter((slot) => slot.claimedBy === null)
        .reduce((total, slot) => total + (ITEM_DEFINITIONS[slot.itemId]?.bagSlots ?? 1), 0);
      const empty = Array.from({ length: 6 - occupied }, () => {
        const node = document.createElement('span');
        node.className = 'relic-empty-slot';
        node.textContent = '空';
        return node;
      });
      relicDialog.querySelector('div')!.replaceChildren(...buttons, ...empty);
      if (!buttons.length) relicDialog.querySelector('p')!.textContent = '遗物箱已空。';
    }
    let rulesOpen = false;
    let mapOpen = false;
    let storyOpen = false;
    const raidSettings = element<HTMLDialogElement>('raid-settings');
    const raidInventory = bindRaidInventory();
    let assigningHotbarItem: string | null = null;
    const finishHotbarAssignment = (index: number) => {
      const instanceId = assigningHotbarItem;
      if (!instanceId || !raidInventory.isOpen()) return;
      const item = activeInventory
        .getCarriedItems()
        .find((entry) => entry.instanceId === instanceId);
      const assigned = scene.assignQuickSlot(index, instanceId);
      assigningHotbarItem = null;
      notify(
        assigned
          ? '已将' + ITEM_DEFINITIONS[item!.itemId]!.name + '放入 ' + (index + 1) + ' 号快捷格。'
          : '该道具已不在背包中，快捷栏没有变更。',
      );
      render();
    };
    const raidHotbar = bindRaidHotbar((index) => {
      if (document.querySelector('dialog[open]') || roomOpen) return;
      if (raidInventory.isOpen()) {
        if (assigningHotbarItem) finishHotbarAssignment(index);
        return;
      }
      scene.selectQuickSlot(index);
      render();
      scene.captureMouse();
    });
    let exitToLobby = false;
    let displayedValue = 0;
    let valueFlashTimer: number | undefined;
    let explorationStarting = false;
    const inputLifetime = new AbortController();
    const toggleInventory = () => {
      const phase = activeController.getView().phase;
      if (
        !['active', 'extracting'].includes(phase) ||
        document.querySelector('dialog[open]') ||
        roomOpen
      )
        return;
      scene.clearInteractions();
      assigningHotbarItem = null;
      raidInventory.setOpen(!raidInventory.isOpen());
      if (!raidInventory.isOpen()) scene.captureMouse();
      render();
    };
    element('toggle-inventory').onclick = toggleInventory;
    element('open-raid-settings').onclick = () => {
      if (raidSettings.open || !['active', 'extracting'].includes(activeController.getView().phase))
        return;
      raidInventory.setOpen(false);
      scene.clearInteractions();
      activeController.pause();
      element('raid-settings-slot').append(settings);
      raidSettings.showModal();
      render();
    };
    const resumeRaid = () => {
      raidSettings.close();
      render();
      scene.captureMouse();
    };
    element('resume-raid').onclick = resumeRaid;
    raidSettings.addEventListener('cancel', (event) => {
      event.preventDefault();
      resumeRaid();
    });
    raidSettings.addEventListener('close', () => {
      element('lobby-settings-slot').append(settings);
      queueMicrotask(render);
    });
    document.addEventListener(
      'keydown',
      (event) => {
        if (
          !element('prologue').hidden ||
          !['active', 'extracting'].includes(activeController.getView().phase)
        )
          return;
        const mapShortcut = event.code === 'KeyM' || event.key.toLowerCase() === 'm';
        const target = event.target as HTMLElement | null;
        if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
        if (mapShortcut) {
          if (event.ctrlKey || event.altKey || event.metaKey) return;
          // Allow M to close its own dialog while other modal surfaces retain input.
          if (roomOpen || document.querySelector('dialog[open]:not(#campus-map-dialog)')) return;
          event.preventDefault();
          event.stopPropagation();
          if (event.repeat) return;
          if (campusMap.open) campusMap.close();
          else element('open-campus-map').click();
          return;
        }
        if (event.repeat && (event.key === 'Tab' || event.key === 'Escape')) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        // Native dialog cancellation owns Esc; never open a second surface on the same event.
        if (document.querySelector('dialog[open]') || roomOpen) return;
        if (assigningHotbarItem && raidInventory.isOpen()) {
          const digit = /^(Digit|Numpad)[1-4]$/.test(event.code ?? '')
            ? event.code.slice(-1)
            : /^[1-4]$/.test(event.key)
              ? event.key
              : null;
          if (digit && !event.ctrlKey && !event.altKey && !event.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) finishHotbarAssignment(Number(digit) - 1);
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            assigningHotbarItem = null;
            render();
            return;
          }
        }
        if (event.key !== 'Tab' && event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.key === 'Tab') toggleInventory();
        else if (raidInventory.isOpen()) {
          scene.clearInteractions();
          raidInventory.setOpen(false);
          scene.captureMouse();
        } else element('open-raid-settings').click();
      },
      { capture: true, signal: inputLifetime.signal },
    );
    const releaseInventoryRender = events.on('InventoryChanged', () => queueMicrotask(render));
    let pendingEnding: { raidId: string; chapterId: string } | null = null;
    let roomOpen = false;
    // F04：新手引导。只读局内状态与玩家位置，不写任何玩法数据。
    const tutorial = createTutorial({ store: tutorialStore(storage) });
    let tutorialRaidId: string | null = null;
    let tutorialOrigin: { x: number; y: number } | null = null;
    let tutorialMoved = false;
    let tutorialSignature = '';
    let tutorialWasVisible = false;
    const scenePosition = (): { x: number; y: number } | null => {
      // 场景把位置作为内部字段持有；这里只读一份坐标用于判断「是否已经走动」，
      // 不改 world-scene（C）的实现，也不参与任何玩法计算。
      const probe = scene as unknown as { position?: { x: number; y: number } };
      const position = probe.position;
      return position ? { x: position.x, y: position.y } : null;
    };
    function syncTutorial(view: ReturnType<typeof controller.getView>): void {
      if (view.raidId !== tutorialRaidId) {
        tutorialRaidId = view.raidId;
        tutorialOrigin = null;
        tutorialMoved = false;
      }
      const position = scenePosition();
      if (position) {
        if (tutorialOrigin === null) tutorialOrigin = position;
        else if (Math.hypot(position.x - tutorialOrigin.x, position.y - tutorialOrigin.y) > 12) {
          tutorialMoved = true;
        }
      }
      const snapshot = tutorial.sync({
        phase: view.phase,
        value: view.value,
        threshold: view.threshold,
        inExtractionZone: view.inExtractionZone,
        bagCount: inventory.getCarriedItems().filter((item) => item.origin.kind === 'raid-loot')
          .length,
        interacted,
        moved: tutorialMoved,
        nowMs: performance.now(),
      });
      const signature = `${snapshot.visible}:${snapshot.index}:${snapshot.step?.id ?? ''}`;
      if (signature === tutorialSignature) return;
      renderTutorial(snapshot);
      tutorialSignature = signature;
      if (tutorialWasVisible && !snapshot.visible && tutorial.isDone()) {
        notify('新手引导已完成 · 可在准备页「重看新手引导」重新观看。');
      }
      tutorialWasVisible = snapshot.visible;
    }
    const mobile = isTouchLayout;
    const syncOrientation = () => {
      const view = activeController.getView();
      const active = view.phase === 'active' || view.phase === 'extracting';
      app.dataset.mobile = String(mobile());
      element('rotate-phone').hidden = true;
      if (
        active &&
        (rulesOpen || mapOpen || storyOpen || roomOpen || document.querySelector('dialog[open]'))
      ) {
        if (!activeController.isPaused()) {
          activeController.pause();
          scene.clearInteractions();
        }
      } else if (
        scene.canResume() &&
        !rulesOpen &&
        !mapOpen &&
        !storyOpen &&
        !roomOpen &&
        !document.querySelector('dialog[open]') &&
        // 开局加载遮罩在场上时同样不让 resume：否则这几秒的对局时钟会继续走。
        !exploreLoader.isShowing()
      ) {
        activeController.resume();
      }
    };
    let roomTrigger: HTMLElement | null = null;
    let gameScroll = 0;
    const roomEntrypoints = [
      ...['open-room', 'open-room-legacy', 'mobile-room'].map((id) =>
        element<HTMLButtonElement>(id),
      ),
      ...Array.from(document.querySelectorAll<HTMLButtonElement>('[data-open-room]')),
    ];
    for (const button of roomEntrypoints) {
      button.onclick = () => {
        const unlock = onlineUnlockProgress(save.view().unlockedChapterIds);
        if (!unlock.unlocked) {
          notify(unlock.hint);
          return;
        }
        roomTrigger = button.id === 'open-room' ? (document.activeElement as HTMLElement) : button;
        gameScroll = app.scrollTop || window.scrollY;
        roomOpen = true;
        controller.pause();
        scene.clearInteractions();
        element('game-page').hidden = true;
        element('room-page').hidden = false;
        if (!lobby.isJoined()) {
          element('room-entry').hidden = false;
          element('room-lobby').hidden = true;
        }
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
      roomTrigger?.focus({ preventScroll: true });
      app.scrollTop = gameScroll;
      if (!mobile()) window.scrollTo(0, gameScroll);
    };

    const preparation = element('preparation');
    const preparationHome = preparation.parentElement!;
    const riskConsentLabel = element('risk-consent').closest('label')!;
    const riskConsentAnchor = document.createComment('risk consent home');
    riskConsentLabel.before(riskConsentAnchor);
    const fullscreen = new GameFullscreen(() => {
      scene.clearInteractions();
      if (['active', 'extracting'].includes(activeController.getView().phase))
        element('open-raid-settings').click();
    });
    const onResize = () => {
      scene.clearInteractions(true);
      render();
    };
    const disposeLayout = bindMobileLayout(app, () => queueMicrotask(onResize));
    const disposeStage = bindStage(() => queueMicrotask(onResize));
    // Establish the logical landscape box before the renderer measures its canvas.
    const game = createGame(scene);
    element('mobile-fullscreen').onclick = () => {
      void fullscreen.enter();
    };
    element('mobile-rules').onclick = () => element('open-rules').click();
    element('hud-rules').onclick = () => element('open-rules').click();
    const toggleMusic = () => {
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
    for (const button of document.querySelectorAll<HTMLButtonElement>('#mobile-sound-game'))
      button.onclick = toggleMusic;
    // 大厅左下角的麦克风 / 听筒按钮：只切换状态与图标，不采集也不传输音频。
    const voiceState = { mic: true, earpiece: true };
    const syncVoice = (): void => {
      const mic = element<HTMLButtonElement>('mobile-sound');
      mic.classList.toggle('is-off', !voiceState.mic);
      mic.setAttribute('aria-pressed', String(voiceState.mic));
      mic.setAttribute('aria-label', voiceState.mic ? '关闭麦克风' : '开启麦克风');
      mic.title = voiceState.mic ? '关闭麦克风' : '开启麦克风';
      const earpiece = element<HTMLButtonElement>('v19-earpiece');
      earpiece.classList.toggle('is-off', !voiceState.earpiece);
      earpiece.setAttribute('aria-pressed', String(voiceState.earpiece));
      earpiece.setAttribute('aria-label', voiceState.earpiece ? '关闭听筒' : '开启听筒');
      earpiece.title = voiceState.earpiece ? '关闭听筒' : '开启听筒';
    };
    element<HTMLButtonElement>('mobile-sound').onclick = () => {
      voiceState.mic = !voiceState.mic;
      syncVoice();
    };
    element<HTMLButtonElement>('v19-earpiece').onclick = () => {
      voiceState.earpiece = !voiceState.earpiece;
      syncVoice();
    };
    syncVoice();
    element('v19-map-open').onclick = () => element('open-campus-map').click();
    // 舞台固定 1672×941，按弹窗可用区域等比缩放（桌面端弹窗尺寸就是 1280×720 画框）
    function fitBagStage(): void {
      const dialog = element<HTMLDialogElement>('v19-loadout-dialog');
      // 没打开时 dialog 是 display:none，量出来是 0，不必算
      if (!dialog.open) return;
      const stage = dialog.querySelector<HTMLElement>('.bp-stage');
      if (!stage) return;
      // 量弹窗自己的可用区域：innerWidth/visualViewport 会受 DPI 与大厅缩放画框影响，不可靠
      const viewW = dialog.clientWidth || window.innerWidth;
      const viewH = dialog.clientHeight || window.innerHeight;
      const scale = Math.min(viewW / 1672, viewH / 941);
      stage.style.setProperty('--bp-scale', String(scale));
    }
    window.addEventListener('resize', fitBagStage);
    element('v19-loadout-open').onclick = () => {
      const dialog = element<HTMLDialogElement>('v19-loadout-dialog');
      dialog.showModal();
      // 打开后才有尺寸，等一帧再量
      requestAnimationFrame(fitBagStage);
    };
    element('v19-loadout-close').onclick = () =>
      element<HTMLDialogElement>('v19-loadout-dialog').close();
    element('v19-prepare-close').onclick = () =>
      element<HTMLDialogElement>('v19-prepare-dialog').close();

    /** 已带入物品占用的背包格数；物品在本局丢失/消耗后自动不计 */
    function carriedSlots(): number {
      let sum = 0;
      for (const item of save?.view().warehouse ?? []) {
        if (!carriedInstances.has(item.instanceId)) continue;
        sum += ITEM_DEFINITIONS[item.itemId]?.bagSlots ?? 1;
      }
      return sum;
    }

    /** 左面板要显示的东西：按 carriedInstances 的勾选顺序取仓库里的实例 */
    function bagItemsOf(warehouse: readonly ItemInstance[]): ItemInstance[] {
      return [...carriedInstances]
        .map((id) => warehouse.find((item) => item.instanceId === id))
        .filter((item): item is ItemInstance => Boolean(item))
        .slice(0, BAG_CAPACITY);
    }

    function refreshBagPanel(warehouse: readonly ItemInstance[]): void {
      renderBagPanel(element('v19-loadout-dialog'), bagItemsOf(warehouse));
    }

    /** 把 carriedInstances 同步到三套 UI：旧勾选列表、仓库角标、左侧随身背包 */
    function syncLoadoutSelection(): void {
      const loadout = element<HTMLDivElement>('loadout');
      for (const input of loadout.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
        input.checked = carriedInstances.has(input.value);
      }
      const weaponSlots = element<HTMLSelectElement>('starter-weapon').value ? 1 : 0;
      element('loadout-slots').textContent =
        `已选 ${weaponSlots + carriedSlots()} / ${RAID_INVENTORY_CAPACITIES.tools} 格（含初始武器）`;
      refreshWarehouseCarry(element('warehouse-panel'));
      const archive = save?.view();
      if (archive) refreshBagPanel(archive.warehouse);
    }

    const carryApi: WarehouseCarryApi = {
      list: () =>
        (save?.view().warehouse ?? [])
          .filter((item) => carriedInstances.has(item.instanceId))
          .map((item) => ({
            instanceId: item.instanceId,
            itemId: item.itemId,
            bagSlots: ITEM_DEFINITIONS[item.itemId]?.bagSlots ?? 1,
          })),
      capacity: () => RAID_RULES.bagCapacity,
      locked: () => lobby.isLocked(),
      hasSpare: (itemId) =>
        (save?.view().warehouse ?? []).some(
          (item) => item.itemId === itemId && !carriedInstances.has(item.instanceId),
        ),
      carry: (itemId) => {
        if (lobby.isLocked()) return false;
        const spare = (save?.view().warehouse ?? []).find(
          (item) => item.itemId === itemId && !carriedInstances.has(item.instanceId),
        );
        if (!spare) return false;
        const need = ITEM_DEFINITIONS[itemId]?.bagSlots ?? 1;
        if (carriedSlots() + need > RAID_RULES.bagCapacity) {
          notify(`带入物品最多占 ${RAID_RULES.bagCapacity} 格。`);
          return false;
        }
        carriedInstances.add(spare.instanceId);
        syncLoadoutSelection();
        return true;
      },
      uncarry: (itemId) => {
        if (lobby.isLocked()) return;
        for (const item of save?.view().warehouse ?? []) {
          if (item.itemId === itemId) carriedInstances.delete(item.instanceId);
        }
        syncLoadoutSelection();
      },
    };

    mountWarehousePanel(element('warehouse-panel'), {
      // 拖拽互换/一键整理后立即落盘（instanceId 全序），刷新后顺序还在
      onReorder: (instanceIds) => {
        save?.reorderWarehouse(instanceIds).catch(() => notify('仓库顺序未保存，请稍后重试。'));
      },
      carry: carryApi,
      // 跨面板拖拽：仓库⇄随身背包。带入/放回只改 carriedInstances 标记，实例始终留在仓库数组
      crossDrag: {
        carryInstance: (instanceId) => {
          if (lobby.isLocked()) {
            notify('房间准备期间不能调整带入。');
            return false;
          }
          if (carriedInstances.has(instanceId)) return true; // 已在背包，原样弹回即可
          const item = (save?.view().warehouse ?? []).find(
            (entry) => entry.instanceId === instanceId,
          );
          if (!item) return false;
          if (carriedInstances.size >= BAG_CAPACITY) {
            notify(`随身背包只有 ${BAG_CAPACITY} 格。`);
            return false;
          }
          const need = ITEM_DEFINITIONS[item.itemId]?.bagSlots ?? 1;
          if (carriedSlots() + need > RAID_RULES.bagCapacity) {
            notify(`带入物品最多占 ${RAID_RULES.bagCapacity} 格。`);
            return false;
          }
          carriedInstances.add(instanceId);
          syncLoadoutSelection();
          return true;
        },
        uncarryInstance: (instanceId) => {
          if (lobby.isLocked()) {
            notify('房间准备期间不能调整带入。');
            return;
          }
          if (carriedInstances.delete(instanceId)) syncLoadoutSelection();
        },
        swapBag: (a, b) => {
          // Set 按插入序渲染背包，重建一次即完成换位
          const ids = [...carriedInstances];
          const ia = ids.indexOf(a);
          const ib = ids.indexOf(b);
          if (ia < 0 || ib < 0 || ia === ib) return;
          const moved = ids[ia]!;
          ids[ia] = ids[ib]!;
          ids[ib] = moved;
          carriedInstances.clear();
          for (const id of ids) carriedInstances.add(id);
          syncLoadoutSelection();
        },
      },
      bagGrid: () => element('v19-loadout-dialog').querySelector<HTMLElement>('[data-bp-bag-grid]'),
      // 拖影挂舞台（两面板共同祖先），从背包起拖时不会被仓库面板边界裁掉
      ghostLayer: () => element('v19-loadout-dialog').querySelector<HTMLElement>('.bp-stage'),
      // 旧那套「初始武器 + 勾选带入」完整保留，入口挪到左面板底部
      onOpenPrepare: () => element<HTMLDialogElement>('v19-prepare-dialog').showModal(),
    });
    const bagRoot = element('v19-loadout-dialog');
    // 一键放入：把随身背包里的装备全部退回避难所仓库
    bagRoot.querySelector<HTMLButtonElement>('[data-bp-put-all]')?.addEventListener('click', () => {
      if (lobby.isLocked() || carriedInstances.size === 0) return;
      const count = carriedInstances.size;
      carriedInstances.clear();
      syncLoadoutSelection();
      notify(`${count} 件装备已放回仓库。`);
    });
    // 当前没有维修服务，有限耐久武器耗尽后可回商店补充。
    bagRoot.querySelector<HTMLButtonElement>('[data-bp-repair]')?.addEventListener('click', () => {
      notify('当前不提供武器维修，可前往商店重新购买。');
    });
    // 左侧竖排导航：背包是当前页；商店/购买/出售都进入道具商店（商城占位页已移除）
    for (const nav of bagRoot.querySelectorAll<HTMLButtonElement>('[data-bp-nav]')) {
      nav.addEventListener('click', () => {
        if (nav.dataset.bpNav === 'bag') return;
        element<HTMLDialogElement>('v19-loadout-dialog').close();
        document.querySelector<HTMLButtonElement>('[data-lobby-tab="shop"]')?.click();
      });
    }
    element('v19-mission-open').onclick = () =>
      element<HTMLDialogElement>('v19-mission-dialog').showModal();
    element('v19-skin-open').onclick = () =>
      element<HTMLDialogElement>('v19-skin-dialog').showModal();
    element('open-ranking').onclick = () => {
      leaderboardPanel.open();
      element<HTMLDialogElement>('v19-ranking-dialog').showModal();
    };
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-v19-close]')) {
      button.onclick = () => button.closest('dialog')?.close();
    }
    element('mobile-bag').onclick = toggleInventory;
    const campusMap = element<HTMLDialogElement>('campus-map-dialog');
    element('open-campus-map').onclick = () => {
      if (campusMap.open) return;
      raidInventory.setOpen(false);
      mapOpen = true;
      activeController.pause();
      scene.clearInteractions();
      campusMap.showModal();
      render();
    };
    element('close-campus-map').onclick = () => campusMap.close();
    campusMap.addEventListener('close', () => {
      mapOpen = false;
      scene.clearInteractions();
      render();
      if (['active', 'extracting'].includes(activeController.getView().phase)) scene.captureMouse();
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-archive-export]')) {
      button.onclick = async () => {
        button.disabled = true;
        const status = button.parentElement?.querySelector<HTMLElement>(
          '[data-archive-export-status]',
        );
        if (status) status.textContent = '生成中…';
        try {
          const archive = save.view();
          await exportCodexImage(archive.codexIds, archive.unlockedChapterIds);
          if (status) status.textContent = '已导出';
        } catch (error) {
          if (status) status.textContent = error instanceof Error ? '导出失败' : '导出失败';
        } finally {
          button.disabled = false;
        }
      };
    }
    bindGameRules(
      () => {
        rulesOpen = true;
        // 规则弹窗盖住序章时，台词先停下，关掉后再继续。
        prologueTypewriter.stop();
        activeController.pause();
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
        scene.clearInteractions(true);
        render();
      },
      () => {
        scene.clearInteractions(true);
        storyOpen = false;
        render();
        const ending = pendingEnding;
        pendingEnding = null;
        if (ending) {
          void save
            .unlockChapter(ending.chapterId)
            .then(() => render())
            .catch(() => {
              storyShownPerRaid.delete(`${ending.raidId}:ending`);
              notify('章节解锁保存失败，请重新查看结尾剧情后重试。');
              render();
            });
        }
      },
    );
    // 每局只弹一次的剧情键：`${raidId}:${itemId}` 为线索，`${raidId}:ending` 为结尾。
    const storyShownPerRaid = new Set<string>();
    events.on('StoryDiscovered', ({ raidId, locationId, chapterId, title, text }) => {
      if (activeQuestChapter(save.view().unlockedChapterIds)?.id !== chapterId) return;
      const key = `${raidId}:site:${locationId}`;
      if (storyShownPerRaid.has(key)) return;
      storyShownPerRaid.add(key);
      story.open({ kind: 'discovery', title, text }, chapterContentById(chapterId));
    });
    events.on('ItemPicked', ({ raidId, item }) => {
      const chapterId = questChapterForEvidence(item.itemId);
      if (activeQuestChapter(save.view().unlockedChapterIds)?.id !== chapterId) return;
      const step = stepForEvidence(item.itemId, chapterContentById(chapterId));
      if (!step) return;
      const key = `${raidId}:${item.itemId}`;
      if (storyShownPerRaid.has(key)) return;
      storyShownPerRaid.add(key);
      story.open({ kind: 'step', step }, chapterContentById(chapterId));
    });
    // 剧情档案的「回看」按钮随存档状态重渲染，用事件委托绑定。
    element('story-archive').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-chapter-story]');
      const chapterId = button?.dataset.chapterStory;
      if (chapterId !== undefined) {
        story.open({ kind: 'full-chapter' }, chapterContentById(chapterId));
      }
    });

    function syncStatusEffects(view: ReturnType<typeof activeController.getView>): void {
      const effects = view.statusEffects;
      const inRaid = view.phase === 'active' || view.phase === 'extracting';
      const pulseEl = element('sonic-pulse-overlay');
      const pulseMs = inRaid ? (effects?.sonicPulseRemainingMs ?? 0) : 0;
      if (pulseMs > 0) {
        const ratio = Math.max(
          0,
          Math.min(1, pulseMs / COMBAT_RULES.enemy.amplifier.pulseFeedbackMs),
        );
        pulseEl.hidden = false;
        pulseEl.style.setProperty('--sonic-pulse', ratio.toFixed(3));
      } else if (!pulseEl.hidden) {
        pulseEl.hidden = true;
        pulseEl.style.setProperty('--sonic-pulse', '0');
      }
      const statusEl = element('status-effects');
      const badges: string[] = [];
      if (inRaid && effects) {
        if (effects.slowRemainingMs > 0) {
          badges.push(
            `<span class="status-badge is-slow">减速 ${(effects.slowRemainingMs / 1000).toFixed(1)}s</span>`,
          );
        }
        if (effects.tinnitusRemainingMs > 0) {
          badges.push(
            `<span class="status-badge is-tinnitus">耳鸣 ${(effects.tinnitusRemainingMs / 1000).toFixed(1)}s</span>`,
          );
        }
      }
      const markup = badges.join('');
      if (markup !== lastStatusMarkup) {
        lastStatusMarkup = markup;
        statusEl.innerHTML = markup;
        statusEl.hidden = badges.length === 0;
      }
    }

    function render(): void {
      syncOrientation();
      lobby.render();
      element('game-load-status').textContent =
        sceneError || (sceneReady ? '校园已就绪' : '正在加载校园与角色资源…');
      element('game-load-status').dataset.state = sceneError
        ? 'error'
        : sceneReady
          ? 'ready'
          : 'loading';
      element('reload-game').hidden = !sceneError;
      const prepTarget =
        roomOpen && lobby.isJoined() ? element('room-preparation-slot') : preparationHome;
      if (preparation.parentElement !== prepTarget) prepTarget.append(preparation);
      if (roomOpen && lobby.isJoined()) {
        const consentSlot = element('room-consent-slot');
        if (riskConsentLabel.parentElement !== consentSlot) consentSlot.prepend(riskConsentLabel);
      } else if (riskConsentLabel.previousSibling !== riskConsentAnchor) {
        riskConsentAnchor.after(riskConsentLabel);
      }
      element<HTMLSelectElement>('starter-weapon').disabled = lobby.isLocked();
      element<HTMLInputElement>('risk-consent').disabled = lobby.isLocked();
      const loadout = element<HTMLDivElement>('loadout');
      loadout
        .querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(
          'input, button, select',
        )
        .forEach((control) => {
          control.disabled = lobby.isLocked();
        });
      let view = activeController.getView();
      if (exitToLobby && view.phase === 'failed') {
        exitToLobby = false;
        activeController.prepareNext();
        view = activeController.getView();
      }
      const inRaid = view.phase === 'active' || view.phase === 'extracting';
      element('toggle-inventory').hidden = !inRaid;
      element('open-raid-settings').hidden = !inRaid;
      if (!inRaid) {
        raidInventory.setOpen(false);
        if (raidSettings.open) raidSettings.close();
      }
      const lighting = scene.getLightingStatus();
      const musicState = sound.getMusicState();
      for (const soundButton of document.querySelectorAll<HTMLButtonElement>(
        '#mobile-sound-game',
      )) {
        soundButton.setAttribute('aria-pressed', String(musicState === 'playing'));
        soundButton.title = musicState === 'playing' ? '关闭声音' : '开启声音';
      }
      const bagButton = element('mobile-bag');
      const preparing = view.phase === 'preparing';
      const finished = ['settling', 'success', 'failed'].includes(view.phase);
      bagButton.textContent = preparing ? '出发' : finished ? '结算' : '背包';
      bagButton.setAttribute(
        'aria-controls',
        preparing ? 'prep-view' : finished ? 'result-panel' : 'inventory-panel',
      );
      const paused = activeController.isPaused();
      const playable = !paused && (view.phase === 'active' || view.phase === 'extracting');
      touch.setEnabled(playable);
      app.dataset.phase = view.phase;
      const immersive = view.phase !== 'preparing' && !roomOpen && element('prologue').hidden;
      document.documentElement.classList.toggle('raid-immersive', immersive);
      if (!inRaid && !explorationStarting) {
        scene.releaseMouse();
        fullscreen.release();
      }
      document.documentElement.classList.toggle(
        'lobby-open',
        view.phase === 'preparing' && !roomOpen,
      );
      syncTutorial(view);
      // F02：读条被价值跌破、受伤、离开区域或暂停打断时，在画面内说明原因。
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
      syncStatusEffects(view);
      element('health').textContent = String(view.health);
      const seconds = Math.ceil(view.remainingMs / 1000);
      element('timer').textContent =
        `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      if (view.value !== displayedValue) {
        displayedValue = view.value;
        element('loot-value').textContent = String(view.value);
        element('raid-value').classList.remove('value-flash');
        void element('raid-value').offsetWidth;
        element('raid-value').classList.add('value-flash');
        window.clearTimeout(valueFlashTimer);
        valueFlashTimer = window.setTimeout(
          () => element('raid-value').classList.remove('value-flash'),
          600,
        );
      }
      element('battery-compact').textContent =
        `电量 ${lighting.battery}%${lighting.enabled ? '' : ' · 关'}`;
      element<HTMLProgressElement>('value-progress').max = view.threshold;
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
          ? activeMap().hasStory
            ? '条件已达成，去南侧撤离点停留 5 秒。'
            : '条件已达成，进入撤离区停留 5 秒。'
          : `还差 ${view.threshold - view.value} 价值 · 带入物不计分`;
      element('interaction-label').textContent = interacted;
      element<HTMLProgressElement>('interaction-progress').value =
        view.phase === 'extracting' ? view.extractionProgress : searchProgress;
      element('prep-view').hidden = !shouldShowPrepView(view.phase);

      const spectateTargets =
        deathRound && deathRound === network.getRoomState()?.roundId && !spectatorDismissed
          ? liveTeammates()
          : [];
      const watched =
        spectateTargets.find((target) => target.playerId === spectatorTarget) ?? spectateTargets[0];
      spectatorTarget = watched?.playerId ?? null;
      spectatorControls.hidden = !watched;
      if (watched)
        spectatorControls.querySelector('strong')!.textContent = `观战 · ${watched.displayName}`;
      switchSpectator!.hidden = spectateTargets.length < 2;
      element('result-panel').hidden =
        !!watched || !['settling', 'success', 'failed'].includes(view.phase);
      renderRelics();
      element<HTMLButtonElement>('start').disabled = !canStartRaid({
        busy: view.isBusy || !sceneReady || buyingItem !== null || changingSkin,
        consented: lobby.isJoined() || element<HTMLInputElement>('risk-consent').checked,
      });
      element('start').textContent = !sceneReady
        ? sceneError
          ? '校园加载失败'
          : '正在加载校园…'
        : view.isBusy
          ? '正在进入校园…'
          : lobby.isJoined()
            ? '返回组队准备 ↗'
            : '开始单人探索 ↗';
      element('mode-solo').setAttribute('aria-pressed', String(!lobby.isJoined()));
      element('mode-room').setAttribute('aria-pressed', String(lobby.isJoined()));
      const onlineUnlock = onlineUnlockProgress(save.view().unlockedChapterIds);
      for (const id of ['mode-room', 'open-room', 'mobile-room']) {
        element<HTMLButtonElement>(id).disabled = !onlineUnlock.unlocked;
        element(id).title = onlineUnlock.unlocked ? '创建或加入联机房间' : onlineUnlock.hint;
      }
      // F02：按钮不再因为「不在区域 / 价值不足」直接禁用，否则点了没有任何反馈。
      element('extract').hidden = !inRaid || !view.inExtractionZone;
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
      element('next').textContent = lobby.isJoined() ? '返回组队房间' : '返回大厅';
      element('result-title').textContent = view.saveError ? '存档未保存' : phaseNames[view.phase];
      const carried = activeInventory.getCarriedItems();
      const archive = save.view();
      // 本局因爆仓转进信箱的件数：只统计这一局补发的邮件，历史上别的局不算进来
      const mailed = view.result
        ? archive.mailbox
            .filter((mail) => mail.sourceRaidId === view.result!.raidId)
            .reduce((sum, mail) => sum + mail.attachments.length, 0)
        : 0;
      element('result-detail').textContent = view.saveError
        ? '结果已冻结，重试保存不会重复发奖。不要刷新页面。'
        : view.phase === 'settling'
          ? '正在保存本次结果…'
          : view.result?.outcome === 'success'
            ? `带回 ${view.result.items.length} 件物品，本局价值 ${view.result.value}。` +
              (mailed > 0
                ? `仓库已满，其中 ${mailed} 件转由信箱保管，去大厅「邮件」领取。`
                : '仓库和图鉴已保存。')
            : `失败原因：${view.result?.reason ? reasonNames[view.result.reason] : '未知'}。本局携带物损失，之前的收藏保留。`;
      const activeChapter = activeQuestChapter(archive.unlockedChapterIds);
      renderQuestPanel(
        activeChapter
          ? questProgress(carried, view.raidId, activeChapter.id, view.steleInvestigated)
          : null,
      );
      const signature = JSON.stringify([carried, activeInventory.getEquipment()]);
      if (signature !== lastInventory) {
        renderInventory(carried, activeInventory.getEquipment());
        lastInventory = signature;
      }
      if (
        assigningHotbarItem &&
        (!raidInventory.isOpen() ||
          !inRaid ||
          document.querySelector('dialog[open]') ||
          !carried.some((item) => item.instanceId === assigningHotbarItem))
      )
        assigningHotbarItem = null;
      for (const button of element('inventory').querySelectorAll<HTMLButtonElement>(
        '[data-hotbar-assign]',
      )) {
        const assigning = button.dataset.hotbarAssign === assigningHotbarItem;
        button.textContent = assigning ? '取消放入 · Esc' : '放入快捷栏';
        button.setAttribute('aria-pressed', String(assigning));
      }
      scene.syncHotbar();
      const selectedSlot = scene.hotbar.selected();
      const selectedItemId = selectedSlot.itemId;
      const combatWeaponId =
        selectedItemId && isCombatWeaponId(selectedItemId) ? selectedItemId : null;
      raidHotbar.render(
        scene.hotbar,
        ['active', 'extracting'].includes(activeController.getView().phase),
        activeController.isPaused() ||
          (raidInventory.isOpen() && !assigningHotbarItem) ||
          !!document.querySelector('dialog[open]') ||
          roomOpen,
        carried.find((item) => item.instanceId === assigningHotbarItem) ?? null,
        combatWeaponId,
        combatWeaponId
          ? scene.combat.getWeaponUsesRemaining(
              combatWeaponId,
              selectedSlot.instanceId ?? undefined,
            )
          : null,
      );
      renderArchiveBrowser(element('lobby-archive-browser'), archive);
      renderWarehousePanel(element('warehouse-panel'), archive.warehouse, archive.currency);
      // 左面板：本次带入的装备，按勾选顺序排（carriedInstances 是 Set，天然保序）
      refreshBagPanel(archive.warehouse);
      element('v19-loadout-dialog').querySelector<HTMLElement>('[data-bp-balance]')!.textContent =
        String(archive.currency);
      // 信箱：只有爆仓补发邮件，条数少；内容或仓库余量变了才重绘，避免每次 render 都重建列表
      const nextMailSignature = JSON.stringify([
        archive.mailbox,
        archive.warehouse.length,
        claimingMail,
        mailStatus,
      ]);
      if (nextMailSignature !== mailSignature) {
        mailSignature = nextMailSignature;
        renderMailPanel(document, {
          mailbox: archive.mailbox,
          warehouseCount: archive.warehouse.length,
          busy: claimingMail,
          status: mailStatus,
        });
      }
      const unreadBadge = element('mail-unread-badge');
      unreadBadge.hidden = archive.mailbox.length === 0;
      unreadBadge.textContent = String(archive.mailbox.length);
      element('lobby-currency').textContent = String(archive.currency);
      const warehouseSignature = JSON.stringify([archive.warehouse, archive.currency]);
      const supplies = archive.warehouse.filter(
        (item) => ITEM_DEFINITIONS[item.itemId]?.kind !== 'collectible',
      );
      const carryableSupplies = supplies.filter((item) => isCarryInAllowed(item.itemId));
      element('warehouse-count').textContent = `${supplies.length} 件功能道具`;
      element('warehouse-item-count').textContent = `${archive.warehouse.length} 件物品`;
      element('warehouse-currency').textContent = String(archive.currency);
      renderShop(
        element('prep-view'),
        archive.warehouse,
        archive.currency,
        buyingItem,
        view.phase === 'preparing' && !view.isBusy && !lobby.isLocked() && !changingSkin,
      );
      renderWardrobe(
        element('prep-view'),
        archive.ownedSkinIds,
        archive.equippedSkinId,
        archive.currency,
        view.phase === 'preparing' &&
          !view.isBusy &&
          !lobby.isLocked() &&
          !changingSkin &&
          buyingItem === null,
      );
      element('archive-detail').textContent = archive.unlockedChapterIds.length
        ? `已完成 ${archive.unlockedChapterIds.length} 章；${activeChapter ? `当前任务：${activeChapter.title}` : '全部剧情已完成，可自由探索'}；图鉴 ${archive.codexIds.length} 种。`
        : archive.codexIds.length
          ? `已点亮 ${archive.codexIds.length} 种图鉴；带回本局手记、调查明湖石碑并成功撤离后，阅读结尾可解锁下一章。`
          : '成功撤离后，物品和图鉴会保存到当前账号的云端仓库。';
      if (lastWarehouse !== warehouseSignature) {
        // 本局丢失/消耗掉的物品要从带入集合里摘掉，避免带走不存在的实例
        const alive = new Set(archive.warehouse.map((item) => item.instanceId));
        for (const instanceId of carriedInstances) {
          if (!alive.has(instanceId)) carriedInstances.delete(instanceId);
        }
        const loadout = element<HTMLDivElement>('loadout');
        loadout.replaceChildren();
        if (!carryableSupplies.length) {
          const empty = document.createElement('p');
          empty.className = 'loadout-empty';
          empty.textContent = '仓库中暂无可带入的功能物品。';
          loadout.append(empty);
        }
        for (const item of carryableSupplies) {
          const definition = ITEM_DEFINITIONS[item.itemId];
          const row = document.createElement('label');
          row.className = 'loadout-item';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.value = item.instanceId;
          checkbox.dataset.itemId = item.itemId;
          checkbox.dataset.bagSlots = String(definition?.bagSlots ?? 1);
          checkbox.checked = carriedInstances.has(item.instanceId);
          checkbox.disabled = lobby.isLocked();
          checkbox.addEventListener('change', () => {
            // 勾选武器时清空「初始武器」下拉，避免同一把武器既当初始又当带入（origin/main）
            if (checkbox.checked && definition?.kind === 'weapon') {
              element<HTMLSelectElement>('starter-weapon').value = '';
            }
            if (checkbox.checked) {
              const weaponSlots = element<HTMLSelectElement>('starter-weapon').value ? 1 : 0;
              // 容量按「初始武器 + 已带入格数 + 这一件」算，Set 还没有这件
              const next = weaponSlots + carriedSlots() + Number(checkbox.dataset.bagSlots ?? 1);
              if (next > RAID_INVENTORY_CAPACITIES.tools) {
                checkbox.checked = false;
                notify(`带入道具最多 ${RAID_INVENTORY_CAPACITIES.tools} 格，初始武器占 1 格。`);
                return;
              }
              carriedInstances.add(item.instanceId);
            } else {
              carriedInstances.delete(item.instanceId);
            }
            syncLoadoutSelection();
          });
          const text = document.createElement('span');
          text.textContent = `${definition?.name ?? item.itemId} · 占 ${definition?.bagSlots ?? 1} 格`;
          row.append(checkbox, text);
          loadout.append(row);
        }
        syncLoadoutSelection();
        lastWarehouse = warehouseSignature;
      }
      const settlement = view.result ?? (view.phase === 'preparing' ? archive.lastResult : null);
      const endingReady =
        activeChapter !== null &&
        !archive.unlockedChapterIds.includes(activeChapter.id) &&
        settlement !== null &&
        chapterUnlockGranted(settlement, activeChapter.id);
      renderChapterUnlock(element('quest-unlock'), endingReady, activeChapter?.id ?? null);
      // R07：成功撤离但证据不齐时，说明本章为什么还没解锁。
      renderChapterLock(element('quest-lock'), settlement, activeChapter?.id ?? null);
      // 先播放本章结尾，关闭后按原有存档规则解锁下一章。
      if (
        activeChapter &&
        endingReady &&
        settlement &&
        (view.phase === 'success' || view.phase === 'preparing')
      ) {
        const key = `${settlement.raidId}:ending`;
        if (!storyShownPerRaid.has(key)) {
          storyShownPerRaid.add(key);
          pendingEnding = { raidId: settlement.raidId, chapterId: activeChapter.id };
          story.open({ kind: 'ending' }, chapterContentById(activeChapter.id));
        }
      }
      const codexSignature = JSON.stringify([archive.codexIds, archive.unlockedChapterIds]);
      if (codexSignature !== lastCodex) {
        renderCodexPanel(element('codex-list'), element('story-archive'), archive);
        renderLobbyMissions(element('lobby-missions'), archive.unlockedChapterIds);
        renderPrepGoals(element('prep-goals'), activeChapter?.id ?? null);
        lastCodex = codexSignature;
      }
    }

    function useRaidItem(instanceId: string): void {
      const state = activeController.getView();
      if (
        activeController.isPaused() ||
        !['active', 'extracting'].includes(state.phase) ||
        document.querySelector('dialog[open]') ||
        roomOpen
      )
        return;
      const item = activeInventory
        .getCarriedItems()
        .find((candidate) => candidate.instanceId === instanceId);
      if (!item) return;
      const definition = ITEM_DEFINITIONS[item.itemId];
      if (definition?.kind === 'healing') {
        const amount = HEALING_AMOUNTS[item.itemId];
        if (amount === undefined) {
          notify('该恢复物尚未配置效果，物品没有消耗。');
          return;
        }
        const result = activeInventory.consumeHealing(instanceId, () =>
          activeController.heal(amount),
        );
        notify(
          result.ok
            ? '已使用' + definition.name + '。'
            : state.health >= RAID_RULES.maxHealth
              ? '当前生命已满，恢复物没有消耗。'
              : '当前无法使用恢复物，物品没有消耗。',
        );
      } else if (definition?.kind === 'utility') {
        const result = activeInventory.consumeUtility(instanceId, () => {
          const effect = UTILITY_EFFECTS[item.itemId];
          if (!effect) return false;
          if (effect.searchDurationReductionMs !== undefined) {
            return scene.activateSearchBoost(effect.searchDurationReductionMs);
          }
          if (effect.detectorDurationMs !== undefined) {
            return scene.activateDetector(effect.detectorDurationMs);
          }
          if (effect.compassDurationMs !== undefined) {
            return scene.activateCompass(effect.compassDurationMs);
          }
          if (
            effect.stealthDurationMs !== undefined &&
            effect.stealthDetectionMultiplier !== undefined
          ) {
            return scene.activateSilentCloak(
              effect.stealthDurationMs,
              effect.stealthDetectionMultiplier,
            );
          }
          if (effect.flashlightRangeMultiplier !== undefined) {
            return scene.activateReflectiveFilter(effect.flashlightRangeMultiplier);
          }
          if (effect.speedMultiplier !== undefined) {
            return activeController.activateSpeedBoost(effect.speedMultiplier, effect.durationMs);
          }
          return effect.shield !== undefined
            ? activeController.activateShield(effect.shield, effect.durationMs)
            : false;
        });
        notify(
          result.ok
            ? '已使用' + definition.name + '：' + (SHOP_EFFECTS[item.itemId] ?? '')
            : '当前无法使用或效果已生效，道具没有消耗。',
        );
      }
      render();
    }

    function renderInventory(
      items: readonly ItemInstance[],
      equipment: ReturnType<typeof inventory.getEquipment>,
    ): void {
      const equippedIds = new Set(Object.values(equipment).map((item) => item.instanceId));
      const list = element('inventory');
      list.replaceChildren();
      if (!items.length) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = '还没有物资，用手电照亮附近，寻找物资箱。';
        li.hidden = true;
        list.append(li);
      }
      for (const item of items) {
        const definition = ITEM_DEFINITIONS[item.itemId];
        if (!definition) {
          continue;
        }
        const li = document.createElement('li');
        li.dataset.itemId = item.itemId;
        li.dataset.instanceId = item.instanceId;
        const label = document.createElement('span');
        label.textContent = definition.name;
        const sub = document.createElement('small');
        sub.textContent = equippedIds.has(item.instanceId)
          ? '已装备 · 带入物 · 占道具格'
          : item.origin.kind === 'carry-in'
            ? '带入物 · 不计本局价值'
            : itemValueFor(definition) === null
              ? '本局搜得 · 价值待定'
              : `本局搜得 · ${itemValueFor(definition)} 价值`;
        label.append(sub);
        const purpose = document.createElement('small');
        purpose.textContent =
          SHOP_EFFECTS[item.itemId] ??
          (definition.kind === 'healing'
            ? `恢复 ${HEALING_AMOUNTS[item.itemId] ?? 0} 点生命`
            : definition.kind === 'weapon'
              ? '放入快捷栏后，按数字选择，左键或空格攻击'
              : definition.kind === 'quest'
                ? '章节任务证据'
                : '探索藏品');
        label.append(purpose);
        li.append(label);
        if (definition.kind === 'healing') {
          const use = document.createElement('button');
          use.className = 'mini';
          use.textContent = '使用';
          use.onclick = () => useRaidItem(item.instanceId);
          li.append(use);
        }
        if (definition.kind === 'utility' && SHOP_EFFECTS[item.itemId]) {
          const use = document.createElement('button');
          use.className = 'mini';
          use.textContent = '使用';
          use.title = SHOP_EFFECTS[item.itemId]!;
          use.onclick = () => useRaidItem(item.instanceId);
          li.append(use);
        }
        if (isHotbarItem(item.itemId)) {
          const assign = document.createElement('button');
          assign.className = 'mini';
          assign.dataset.hotbarAssign = item.instanceId;
          assign.textContent = '放入快捷栏';
          assign.title = '点击后选择底部格子；Esc 取消，不会消耗或丢弃道具。';
          assign.onclick = () => {
            if (
              !raidInventory.isOpen() ||
              activeController.isPaused() ||
              document.querySelector('dialog[open]')
            )
              return;
            assigningHotbarItem = assigningHotbarItem === item.instanceId ? null : item.instanceId;
            render();
          };
          li.append(assign);
        }
        const drop = document.createElement('button');
        drop.className = 'mini';
        drop.textContent = '丢弃';
        drop.setAttribute('aria-label', `丢弃${definition.name}`);
        drop.onclick = async () => {
          if (
            definition.kind !== 'quest' ||
            (await confirmDialog.ask({
              title: '丢弃任务物品？',
              message: '丢弃后本局可能无法完成当前章节任务。',
              confirmText: '丢弃',
              tone: 'danger',
            }))
          ) {
            scene.drop(item.instanceId);
          }
        };
        li.append(drop);
        list.append(li);
      }
      raidInventory.render(items);
    }

    function syncLoadoutSlots(): void {
      const weaponSlots = element<HTMLSelectElement>('starter-weapon').value ? 1 : 0;
      const warehouse = save?.view().warehouse ?? [];
      let slots = weaponSlots + carriedSlots();
      if (slots > RAID_INVENTORY_CAPACITIES.tools) {
        for (const instanceId of [...carriedInstances].reverse()) {
          if (slots <= RAID_INVENTORY_CAPACITIES.tools) break;
          carriedInstances.delete(instanceId);
          const item = warehouse.find((entry) => entry.instanceId === instanceId);
          slots -= ITEM_DEFINITIONS[item?.itemId ?? '']?.bagSlots ?? 1;
        }
        notify(`带入道具最多 ${RAID_INVENTORY_CAPACITIES.tools} 格，初始武器占 1 格。`);
      }
      syncLoadoutSelection();
    }
    element('starter-weapon').onchange = () => syncLoadoutSlots();

    element('risk-consent').onchange = render;
    // 信箱领取：仓库有格子就放进去，放不下的留在信里，玩家腾出空间后再来
    const claimMail = (mailId: string | null): void => {
      if (claimingMail || !save?.claimMail) return;
      claimingMail = true;
      mailStatus = '正在领取…';
      render();
      void save
        .claimMail(mailId)
        .then((result) => {
          const room = save.view().warehouse.length;
          mailStatus =
            result.moved === 0
              ? result.remaining > 0
                ? `仓库已满（${room}/100），先腾出格子再来领取。`
                : '没有可领取的物资。'
              : result.remaining > 0
                ? `已领取 ${result.moved} 件放进仓库，仓库已满，还有 ${result.remaining} 件留在信箱。`
                : `已领取 ${result.moved} 件，全部存入仓库。`;
          notify(mailStatus);
        })
        .catch((error: unknown) => {
          mailStatus =
            error instanceof Error ? `领取失败：${error.message}` : '领取失败，请稍后重试。';
          notify(mailStatus);
        })
        .finally(() => {
          claimingMail = false;
          render();
        });
    };
    document.querySelector('#mail-claim-all')?.addEventListener('click', () => claimMail(null));
    document.querySelector('#lobby-mail-list')?.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-mail-claim]');
      if (!button || button.disabled) return;
      claimMail(button.dataset.mailClaim ?? null);
    });
    element('prep-view').addEventListener('click', async (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-skin-action]');
      if (!button || button.disabled || changingSkin || buyingItem !== null || lobby.isLocked())
        return;
      const skin = SKIN_DEFINITIONS.find((entry) => entry.id === button.dataset.skinAction);
      const view = controller.getView();
      if (!skin || view.phase !== 'preparing' || view.isBusy) return;
      const inShop = button.hasAttribute('data-skin-shop');
      const status = element(inShop ? 'shop-status' : 'wardrobe-status');
      const owned = save.view().ownedSkinIds.includes(skin.id);
      if (inShop && owned) return;
      changingSkin = true;
      status.textContent = '正在保存…';
      status.dataset.state = 'pending';
      render();
      try {
        const ok = owned ? await save.equipSkin(skin.id) : (await save.purchaseSkin(skin.id)).ok;
        status.textContent = ok
          ? owned
            ? `已穿上${skin.name}。`
            : inShop
              ? `已购买${skin.name}，可在大厅「时装」中穿戴。`
              : `已购买${skin.name}，现在可以穿戴。`
          : '时装状态未更新，请重试。';
        status.dataset.state = ok ? 'success' : 'error';
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : '时装保存失败，请重试。';
        status.dataset.state = 'error';
      } finally {
        changingSkin = false;
        render();
      }
    });
    element('shop-prepare').onclick = () =>
      document.querySelector<HTMLButtonElement>('[data-lobby-tab="prepare"]')!.click();
    bindShopCategories(element('prep-view'));
    element('prep-view').addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-shop-buy]');
      if (!button || button.disabled || buyingItem !== null || changingSkin) return;
      const itemId = button.dataset.shopBuy!;
      const view = controller.getView();
      if (view.phase !== 'preparing' || view.isBusy || lobby.isLocked()) return;
      buyingItem = itemId;
      element('shop-status').textContent = '正在确认购买，请稍候…';
      element('shop-status').dataset.state = 'pending';
      render();
      void save
        .purchaseItem(itemId)
        .then((result) => {
          const message = result.ok
            ? `已购买${ITEM_DEFINITIONS[itemId]?.name ?? itemId}，已存入仓库。请在出发准备中勾选带入。`
            : result.error === 'INSUFFICIENT_FUNDS'
              ? '交子不足，本次未购买。'
              : result.error === 'WAREHOUSE_FULL'
                ? `仓库已满（${save.view().warehouse.length}/100），腾出格子后再购买，本次未扣款。`
                : '当前无法购买，本次未扣款。';
          element('shop-status').textContent = message;
          element('shop-status').dataset.state = result.ok ? 'success' : 'error';
          notify(message);
        })
        .catch((error: unknown) => {
          element('shop-status').textContent =
            error instanceof Error
              ? `购买未确认：${error.message}`
              : '购买未确认，请检查网络后重试。';
          element('shop-status').dataset.state = 'error';
        })
        .finally(() => {
          buyingItem = null;
          render();
        });
    });
    async function startExploration(): Promise<boolean> {
      if (
        !sceneReady ||
        !element<HTMLInputElement>('risk-consent').checked ||
        controller.getView().isBusy ||
        buyingItem !== null ||
        changingSkin
      )
        return false;
      // Start playback within the click gesture, before fullscreen or save awaits.
      sound.setMusic(true);
      void requestLandscape();
      const selected = [...carriedInstances].filter((instanceId) =>
        (save?.view().warehouse ?? []).some((item) => item.instanceId === instanceId),
      );
      const starterWeapon = element<HTMLSelectElement>('starter-weapon').value;
      explorationStarting = true;
      // 加载动画必须在这个点击手势里起播，否则浏览器会拦掉自动播放。
      const loading = exploreLoader.play();
      const starting = activeController.start(selected, starterWeapon || undefined);
      render();
      scene.captureMouse();
      void fullscreen.enter();
      const result = await starting.catch(() => ({ ok: false as const }));
      explorationStarting = false;
      if (!result.ok) {
        // 开局失败：立刻收回遮罩并释放鼠标，不能让玩家停在加载页上。
        exploreLoader.cancel();
        scene.releaseMouse();
        notify('开局未成功：请检查网络和云存档状态后重试，当前装备仍保留。');
        render();
        return false;
      }
      // 动画这几秒先把对局冻住：否则计时在走、怪物在动，玩家却看不见也动不了。
      // resume() 会把暂停时长补回 startedAtMs，剩余时间不受影响。
      activeController.pause();
      render();
      exploreLoader.hide();
      await loading;
      if (
        scene.canResume() &&
        !rulesOpen &&
        !mapOpen &&
        !storyOpen &&
        !roomOpen &&
        !document.querySelector('dialog[open]')
      ) {
        activeController.resume();
      }
      notify(`探索开始。当前物资价值达到 ${RAID_RULES.threshold} 后，回到南侧撤离点。`);
      render();
      element<HTMLButtonElement>('start').blur();
      app.scrollTo(0, 0);
      window.scrollTo(0, 0);
      return true;
    }
    element('reload-game').onclick = () => location.reload();
    element('mode-room').onclick = () => element('open-room').click();
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-room]')) {
      button.onclick = () => element('open-room').click();
    }
    element('mode-solo').onclick = () => {
      if (controller.getView().phase !== 'preparing') return;
      if (lobby.isJoined()) lobby.leave();
      render();
      element<HTMLInputElement>('risk-consent').focus();
    };
    element('start').onclick = () => {
      if (lobby.isJoined()) element(mobile() ? 'mobile-room' : 'open-room').click();
      else void startExploration();
    };
    element('extract').onclick = () => {
      const current = activeController.getView();
      const result = activeController.startExtraction();
      if (result.ok) {
        sound.play('home');
        showMapToast('开始撤离 · 请留在南门区域内 5 秒');
      } else {
        const reason = refusalText(result.error, current, activeController.isPaused());
        notify(reason);
        showMapToast(reason);
      }
      render();
    };
    element('abandon').onclick = () => {
      void confirmDialog
        .ask({
          title: '放弃本次探索并返回大厅？',
          message: '本局全部携带物（含带入道具）将损失；未带入的仓库物品与图鉴保留。',
          confirmText: '放弃并返回大厅',
          cancelText: '继续探索',
          tone: 'danger',
        })
        .then((confirmed) => {
          if (!confirmed) return;
          exitToLobby = true;
          raidSettings.close();
          activeController.resume();
          activeController.abandon();
          sound.setMusic(false);
          render();
        });
    };
    element('next').onclick = () => {
      activeController.prepareNext();
      sound.setMusic(false);
      render();
      if (lobby.isJoined()) element(mobile() ? 'mobile-room' : 'open-room').click();
      if (mobile()) app.scrollTo(0, 0);
    };
    element('retry-save').onclick = async () => {
      await activeController.retrySettlement();
      render();
    };
    // F04：跳过与重看两个入口，配合引导卡一起满足「可跳过、可重看」的要求。
    element('tutorial-skip').onclick = () => {
      tutorial.skip();
      tutorialSignature = '';
      tutorialWasVisible = false;
      notify('已跳过新手引导 · 可在准备页「重看新手引导」重新打开。');
      render();
    };
    element('tutorial-restart').onclick = () => {
      tutorial.restart();
      tutorialSignature = '';
      tutorialWasVisible = false;
      notify('新手引导已重置 · 进入局内会从第一步重新提示。');
      render();
    };
    element('reset-save').onclick = async () => {
      if (controller.getView().phase !== 'preparing') {
        notify('请先结束本局并返回准备页。');
        return;
      }
      if (
        await confirmDialog.ask({
          title: '清空云端存档？',
          message: '仓库、图鉴和探索进度将被清空，操作不能撤销。建议先导出备份。',
          confirmText: '清空存档',
          tone: 'danger',
        })
      ) {
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
        activeController.applyDamage(25);
        render();
      };
      element('fatal').onclick = () => {
        activeController.applyDamage(RAID_RULES.maxHealth);
        render();
      };
      // F02 人工验收需要精确的价值（75 / 110 / 85），宝箱随机难以凑数，这里给个 dev 专用发放按钮。
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
      // R07 验收需要稳定的证据组合，宝箱随机拿不到，这里同样只在 dev 提供发放入口。
      element('debug-grant-notebook').onclick = () => grantLoot('torn-notebook');
      element('debug-grant-feather').onclick = () => grantLoot('anomalous-feather');
      // R07 验收还需要抵达随机生成的搜证点；人工探索太耗时，dev 提供传送（只读场景内部状态，不改玩法）。
      type DebugSceneAccess = {
        position: { x: number; y: number };
        aim: number;
        player?: {
          setPosition(x: number, y: number): void;
          body: { reset(x: number, y: number): void };
        };
        searchPoints: readonly { id: string; itemId: string; x: number; y: number }[];
        lighting: { enabled: boolean };
        combat?: {
          enemies: readonly {
            id: string;
            kind: string;
            state: string;
            position: { x: number; y: number };
          }[];
        };
        search?: { isOpened(id: string): boolean; current?(): string | null };
        services?: {
          inventory?: { getCarriedItems(): readonly { instanceId: string; itemId: string }[] };
        };
      };
      const debugScene = scene as unknown as DebugSceneAccess;
      const teleportTargets: Record<string, () => { x: number; y: number } | null> = {
        'debug-tp-notebook': () =>
          debugScene.searchPoints.find((point) => point.itemId === 'torn-notebook') ?? null,
        'debug-tp-feather': () => {
          const stone = activeMap().stone;
          return stone ? { ...stone } : null;
        },
        'debug-tp-extract': () => ({ ...activeMap().spawn }),
      };
      const questPointNames: Record<string, string> = {
        'debug-tp-notebook': '思源楼前',
        'debug-tp-feather': '明湖石碑',
        'debug-tp-extract': '南门撤离点',
      };
      for (const [buttonId, resolveTarget] of Object.entries(teleportTargets)) {
        element(buttonId).onclick = () => {
          const target = resolveTarget();
          if (!target) {
            notify('调试：本局没有该目标点，或尚未开始探索。');
            return;
          }
          // 优先落在目标西侧 48px（面朝东即对准目标），被障碍挡住就按东/北/南顺序挑空位。
          const candidates = [
            { x: target.x - 48, y: target.y },
            { x: target.x + 48, y: target.y },
            { x: target.x, y: target.y - 48 },
            { x: target.x, y: target.y + 48 },
            { x: target.x, y: target.y },
          ];
          const spot =
            candidates.find((p) => !activeMap().obstacles.some((w) => contains(w, p))) ?? target;
          debugScene.position = { x: spot.x, y: spot.y };
          debugScene.aim = Math.atan2(target.y - spot.y, target.x - spot.x);
          debugScene.lighting.enabled = true;
          debugScene.player?.setPosition(spot.x, spot.y);
          notify(`调试：已传送到${questPointNames[buttonId] ?? buttonId}旁，手电已开启。`);
          render();
        };
      }
      // 供自动化验收读取场景内部状态（仅 dev）。
      (window as unknown as { __debugSceneState?: () => unknown }).__debugSceneState = () => ({
        position: { ...debugScene.position },
        aim: debugScene.aim,
        lightOn: debugScene.lighting.enabled,
        points: debugScene.searchPoints.map((p) => ({
          id: p.id,
          itemId: p.itemId,
          x: p.x,
          y: p.y,
        })),
        enemies: (debugScene.combat?.enemies ?? []).map((enemy) => ({
          id: enemy.id,
          kind: enemy.kind,
          state: enemy.state,
          x: enemy.position.x,
          y: enemy.position.y,
        })),
        opened: debugScene.search
          ? Array.from(
              (debugScene.search as unknown as { opened?: Set<string> }).opened ??
                new Set<string>(),
            )
          : [],
        searchCurrent: debugScene.search?.current?.() ?? null,
        hasSearch: debugScene.search !== undefined,
        hasServices: debugScene.services !== undefined,
        bag: (debugScene.services?.inventory?.getCarriedItems() ?? []).map((item) => ({
          id: item.instanceId,
          item: item.itemId,
        })),
      });
    }
    render();
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      inputLifetime.abort();
      releaseInventoryRender();
      window.clearTimeout(valueFlashTimer);
      save.close();
      lobby.dispose();
      disposeStage();
      network.close();
      sound.dispose();
      disposeLayout();
      fullscreen.dispose();
      controller.dispose();
      touch.dispose();
      game.destroy();
      document.documentElement.classList.remove('raid-immersive');
      unlock();
    };
    window.addEventListener('pagehide', dispose, { once: true });
    if (import.meta.hot) {
      import.meta.hot.dispose(() => {
        window.removeEventListener('pagehide', dispose);
        dispose();
      });
    }
  }
  await bootstrap().catch((error: unknown) => {
    notify(error instanceof Error ? error.message : '启动失败，请查看开发控制台。');
    element('game-load-status').textContent =
      error instanceof Error ? error.message : '游戏初始化失败，请重新加载。';
    element('game-load-status').dataset.state = 'error';
    element('reload-game').hidden = false;
    element('interaction-label').textContent = '启动尚未完成';
    console.error('Bootstrap failed', error);
  });
}
