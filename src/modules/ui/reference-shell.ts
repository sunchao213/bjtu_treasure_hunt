import { RAID_RULES } from '../../config/game-config';
import { raidInventoryMarkup } from './raid-inventory';
import { raidHotbarMarkup } from './raid-hotbar';
import { gameRulesMarkup } from './game-rules';
import { roomPageMarkup } from './room-page';
import { iconSvg } from './icons';
import { confirmMarkup } from './confirm-dialog';
import { storyDialogMarkup } from './story-dialog';
import { tutorialMarkup } from './tutorial';
import { assetUrl } from '../../app/asset-url';
import { shopMarkup, wardrobeMarkup } from './shop';
import { archiveBrowserMarkup } from './archive-browser';
import { friendsPanelMarkup } from './friends-panel';
import { leaderboardMarkup } from './leaderboard-panel';
import { warehousePanelMarkup } from './warehouse-panel';
import { BAG_CAPACITY } from '../../config/game-config';

/**
 * F01 准备页整页首屏（与助教要求一致）：
 * 首屏主内容固定为「初始武器 / 带入选择 / 风险提示 / 勾选框 / 开始按钮」，
 * 仓库与存档等次要入口收在页面底部的折叠区，不占用首屏。
 */
export function prepViewMarkup(): string {
  return `
      <section id="prep-view" class="prep-view" hidden aria-label="行前准备">
        <div class="prep-page v19-prep-page">
          <section class="lobby-panel v19-home-panel is-active" data-lobby-panel="prepare">
            <div class="v19-lobby-canvas" aria-label="思源密码游戏大厅">
              <div class="v19-wallet" id="lobby-wallet" aria-label="当前交子余额"><span id="lobby-currency">0</span></div>
              <span id="lobby-player-avatar" class="v19-sr-only"></span>
              <span id="lobby-player-name" class="v19-player-name"></span>

              <button class="v19-hotspot v19-nav-shop" type="button" data-lobby-tab="mall" aria-label="商城"></button>
              <button class="v19-hotspot v19-nav-archive" type="button" data-lobby-tab="profile" aria-label="玩家档案"></button>
              <button class="v19-hotspot v19-nav-friends" type="button" data-lobby-tab="friends" aria-label="好友"></button>
              <button class="v19-hotspot v19-nav-codex" type="button" data-lobby-tab="warehouse" aria-label="图鉴与仓库"></button>
              <button id="open-ranking" class="v19-hotspot v19-nav-ranking" type="button" aria-label="排行榜"></button>
              <button class="v19-hotspot v19-nav-settings" type="button" data-lobby-tab="settings" aria-label="设置"></button>
              <button class="v19-hotspot v19-nav-mail" type="button" data-lobby-tab="mail" aria-label="邮件">
                <span id="mail-unread-badge" class="v19-mail-badge" hidden>0</span>
              </button>

              <button id="v19-mission-open" class="v19-hotspot v19-task-button" type="button" aria-label="查看任务"></button>
              <button id="v19-skin-open" class="v19-hotspot v19-skin-button" type="button" aria-label="时装"></button>
              <button class="v19-hotspot v19-teammate v19-teammate-one" type="button" aria-label="邀请队友" data-open-room></button>
              <button class="v19-hotspot v19-teammate v19-teammate-two" type="button" aria-label="邀请队友" data-open-room></button>
              <button class="v19-hotspot v19-teammate v19-teammate-three" type="button" aria-label="邀请队友" data-open-room></button>
              <div class="v19-fill-cost"><span>需要消耗</span><b aria-hidden="true">●</b><span>100</span></div>
              <button id="v19-map-open" class="v19-hotspot v19-map-card" type="button" aria-label="查看海淀校区地图"></button>
              <button id="mode-room" class="v19-hotspot v19-hidden-mode" type="button" aria-label="组队探索"></button>
              <!-- 联机房间页的程序化入口；v19 大厅的好友图标改为打开好友面板，房间仍由队友位与模式按钮进入。 -->
              <button id="open-room" class="v19-sr-only" type="button" tabindex="-1" aria-hidden="true">联机房间</button>
              <button id="mode-solo" class="v19-sr-only" type="button" aria-pressed="true">单人探索</button>

              <form id="lobby-chat" class="v19-chat" aria-label="房间聊天">
                <input id="lobby-chat-input" type="text" aria-label="聊天消息" placeholder="和朋友聊天..." maxlength="160" autocomplete="off" />
                <p id="lobby-chat-latest" class="v19-chat-latest" role="status" aria-live="polite"></p>
                <button type="submit" aria-label="发送消息"></button>
              </form>
              <button id="mobile-sound" class="v19-hotspot v19-microphone" type="button" aria-label="关闭麦克风" aria-pressed="true" title="关闭麦克风"></button>
              <button id="v19-earpiece" class="v19-hotspot v19-volume" type="button" aria-label="关闭听筒" aria-pressed="true" title="关闭听筒"></button>
              <button class="v19-hotspot v19-shop-bottom" type="button" data-lobby-tab="shop" aria-label="打开商店"></button>
              <button id="v19-loadout-open" class="v19-hotspot v19-backpack" type="button" aria-label="背包与装备"></button>

              <label class="v19-risk-consent"><input id="risk-consent" type="checkbox" /><span>出发风险我已知悉</span></label>
              <button id="start" class="v19-hotspot v19-start" type="button" disabled aria-label="开始探索"></button>
              <p id="game-load-status" class="v19-load-status" role="status">正在加载校园与角色资源…</p>
              <button id="reload-game" type="button" hidden>重新加载校园</button>
              <p class="v19-sr-only" id="lobby-prepare-title">行前准备</p>
            </div>

            <dialog id="v19-mission-dialog" class="v19-dialog" aria-labelledby="v19-mission-title">
              <header><h2 id="v19-mission-title">本局任务</h2><button type="button" data-v19-close>关闭</button></header>
              <div id="lobby-missions"></div><ol id="prep-goals" class="prep-goals" aria-label="本局目标"></ol>
              <button id="tutorial-restart" class="secondary" type="button">重看新手引导</button>
            </dialog>
            <dialog id="v19-skin-dialog" class="v19-dialog" aria-labelledby="v19-skin-title">
              <header><h2 id="v19-skin-title">时装</h2><button type="button" data-v19-close>关闭</button></header>
              ${wardrobeMarkup()}
              <p id="wardrobe-status" class="shop-status" role="status"></p>
            </dialog>
            <dialog id="v19-ranking-dialog" class="v19-dialog" aria-labelledby="v19-ranking-title">
              <header><h2 id="v19-ranking-title">近七日排行</h2><button type="button" data-v19-close>关闭</button></header>
              ${leaderboardMarkup()}
            </dialog>
            <dialog id="v19-loadout-dialog" class="v19-dialog v19-loadout-dialog" aria-labelledby="v19-loadout-title">
              <header class="bp-sr-head"><h2 id="v19-loadout-title">背包与出发装备</h2></header>
              <div class="bp-stage">
                <span class="bp-balance"><b data-bp-balance>0</b></span>
                <button id="v19-loadout-close" class="bp-hot bp-hot-back" type="button" aria-label="返回大厅"></button>
                <button class="bp-hot bp-hot-nav" data-bp-nav="bag" type="button" aria-label="背包"></button>
                <button class="bp-hot bp-hot-nav" data-bp-nav="shop" type="button" aria-label="商店"></button>
                <button class="bp-hot bp-hot-nav" data-bp-nav="buy" type="button" aria-label="购买"></button>
                <button class="bp-hot bp-hot-nav" data-bp-nav="sell" type="button" aria-label="出售"></button>
                <div class="bp-bag">
                  <span class="bp-load"><b data-bp-load>0</b><i>/ ${BAG_CAPACITY}</i></span>
                  <div class="bp-bag-grid" data-bp-bag-grid role="group" aria-label="随身背包"></div>
                  <button class="bp-hot bp-hot-put-all" data-bp-put-all type="button" aria-label="一键放入仓库"></button>
                  <button class="bp-hot bp-hot-repair" data-bp-repair type="button" aria-label="维修全部"></button>
                </div>
                <div id="warehouse-panel" class="bp-wh">${warehousePanelMarkup()}</div>
              </div>
            </dialog>
            <dialog id="v19-prepare-dialog" class="v19-dialog v19-prepare-dialog" aria-labelledby="v19-prepare-title">
              <header><h2 id="v19-prepare-title">行前准备</h2><button id="v19-prepare-close" type="button">关闭</button></header>
              <div id="preparation" class="prep-main v19-preparation">
                <p class="prep-warning">失败、超时或刷新页面会损失本局全部携带物（包括带入装备）；未带入的仓库物品会保留。</p>
                <div class="game-load-feedback"><p class="v19-sr-only">校园状态</p><button id="reload-game-dialog" type="button" hidden>重新加载校园</button></div>
                <section class="prep-block prep-kit" aria-labelledby="prep-kit-title">
                  <h3 id="prep-kit-title">装备与带入</h3>
                  <ul class="prep-equipment"><li><b>手电筒</b><span>电量 100% · 默认开启，照亮搜索点</span></li></ul>
                  <label class="field-label" for="starter-weapon">初始武器</label>
                  <select id="starter-weapon"><option value="">不携带武器</option><option value="training-bat" selected>训练棍 · 伤害 35</option><option value="stun-baton">电击器 · 伤害 15 · 可使用 15 次</option></select>
                  <label class="field-label" for="loadout-item">仓库带入选择</label>
                  <div id="loadout" class="loadout-options" aria-describedby="loadout-slots"><p class="loadout-empty">仓库中暂无可带入的功能物品。</p></div>
                  <p id="loadout-slots" class="loadout-slots">已选 0 / 6 格</p>
                </section>
              </div>
            </dialog>
          </section>

          <section class="lobby-panel lobby-panel-wide v19-subpage" data-lobby-panel="profile" hidden aria-labelledby="lobby-profile-title">
            <button class="v19-back-button" type="button" data-lobby-tab="prepare">返回大厅</button>
            <div class="lobby-panel-heading"><div><p class="prep-kicker">玩家资料</p><h2 id="lobby-profile-title">玩家档案</h2></div><button id="profile-refresh" class="secondary" type="button">刷新档案</button></div>
            <p id="profile-status" class="lobby-panel-intro" role="status">正在读取玩家档案…</p>
            <div class="player-profile-grid">
              <section class="side-card player-profile-card" aria-labelledby="profile-identity-title">
                <h3 id="profile-identity-title">身份信息</h3>
                <dl class="player-profile-facts"><div><dt>昵称</dt><dd id="profile-display-name">—</dd></div><div><dt>账号 UID</dt><dd id="profile-uid">—</dd></div><div><dt>当前时装</dt><dd id="profile-outfit">—</dd></div></dl>
                <label class="consent"><input id="profile-public" type="checkbox" />允许好友查看展示藏品与最近对局摘要</label>
              </section>
              <section class="side-card player-profile-card" aria-labelledby="profile-progress-title">
                <h3 id="profile-progress-title">行动统计</h3>
                <dl class="player-profile-stats"><div><dt>完成章节</dt><dd id="profile-chapters">0</dd></div><div><dt>图鉴数量</dt><dd id="profile-codex">0</dd></div><div><dt>仓库物品</dt><dd id="profile-warehouse">0</dd></div><div><dt>历史对局</dt><dd id="profile-raids">0</dd></div></dl>
              </section>
            </div>
            <section class="side-card player-profile-history" aria-labelledby="profile-history-title"><h3 id="profile-history-title">最近对局</h3><ol id="profile-history" class="profile-history"></ol><p id="profile-history-empty" class="muted">暂无已保存的对局记录。</p></section>
          </section>

          <section class="lobby-panel lobby-panel-wide v19-subpage" data-lobby-panel="warehouse" hidden aria-labelledby="lobby-warehouse-title">
            <button class="v19-back-button" type="button" data-lobby-tab="prepare">返回大厅</button>
            <div class="lobby-panel-heading archive-panel-heading"><div><p class="prep-kicker">物品记录</p><h2 id="lobby-warehouse-title">图鉴与仓库</h2></div><span class="lobby-panel-meta" id="warehouse-count-label"><span id="warehouse-item-count">0 件物品</span><span class="currency-display"><img src="${assetUrl('assets/ui/jiaozi.png')}" alt="" /><b id="warehouse-currency">0</b></span></span></div>
            ${archiveBrowserMarkup('lobby-archive-browser')}
            <div class="archive-panel-tools"><span id="warehouse-count" hidden></span><p id="archive-detail" hidden></p>
              <ul id="codex-list" hidden></ul><details class="archive-story"><summary>剧情档案</summary><div id="story-archive"></div></details>
              <details><summary>存档管理</summary><button id="export-save" class="secondary">导出存档备份（JSON）</button><button id="reset-save" class="text-button">重置存档</button></details>
            </div>
          </section>
          <section class="lobby-panel lobby-panel-wide v19-subpage" data-lobby-panel="mall" hidden aria-labelledby="lobby-mall-title">
            <button class="v19-back-button" type="button" data-lobby-tab="prepare">返回大厅</button>
            <div class="lobby-panel-heading"><div><p class="prep-kicker">交子流通</p><h2 id="lobby-mall-title">商城</h2></div><span class="lobby-panel-meta">建设中</span></div>
            <p class="lobby-panel-intro">商城负责武器购买、升级与出售，以及成长类商品。界面尚未开放，当前补给请走大厅底部的「商店」。</p>
            <button class="v19-gold-button" type="button" data-lobby-tab="shop">前往道具商店</button>
          </section>
          ${shopMarkup()}
          ${friendsPanelMarkup()
            // R15 好友面板由 main 提供，这里补上 v19 子页的实底背景与返回大厅按钮。
            .replace(
              'class="lobby-panel lobby-panel-wide friends-panel"',
              'class="lobby-panel lobby-panel-wide friends-panel v19-subpage"',
            )
            .replace(
              '<div class="lobby-panel-heading">',
              '<button class="v19-back-button" type="button" data-lobby-tab="prepare">返回大厅</button><div class="lobby-panel-heading">',
            )}
          <!-- 临时版邮件页：正式归属项会惠（官方邮件列表/已读/附件预览/领取）。
               这里只承载「仓库爆仓补发」的领取闭环，替换时保留 #lobby-mail-list 等挂载点即可。 -->
          <section class="lobby-panel lobby-panel-wide v19-subpage" data-lobby-panel="mail" hidden aria-labelledby="lobby-mail-title">
            <button class="v19-back-button" type="button" data-lobby-tab="prepare">返回大厅</button>
            <div class="lobby-panel-heading"><div><p class="prep-kicker">思源信箱</p><h2 id="lobby-mail-title">邮件</h2></div><span class="lobby-panel-meta" id="lobby-mail-meta">0 封未读</span></div>
            <p class="lobby-panel-intro">撤离带出的物资超过仓库上限时，多出来的部分会送到这里。腾出格子后回来领取即可，邮件不会过期。</p>
            <div class="lobby-mail-toolbar">
              <button id="mail-claim-all" class="secondary" type="button">全部领取</button>
              <span id="lobby-mail-status" class="lobby-mail-status" role="status" aria-live="polite"></span>
            </div>
            <ul id="lobby-mail-list" class="lobby-mail-list"></ul>
            <div class="lobby-mail-empty" id="lobby-mail-empty">
              <p class="lobby-mail-empty-title">信箱空空如也</p>
              <p class="lobby-mail-empty-hint">仓库没满时，撤离物资会直接进仓库，不会打扰你。</p>
            </div>
          </section>
          <section class="lobby-panel lobby-panel-wide v19-subpage" data-lobby-panel="settings" hidden aria-labelledby="lobby-settings-title">
            <button class="v19-back-button" type="button" data-lobby-tab="prepare">返回大厅</button>
            <div class="lobby-panel-heading"><div><p class="prep-kicker">体验选项</p><h2 id="lobby-settings-title">设置</h2></div></div>
            <div id="lobby-settings-slot" class="lobby-settings-slot"></div>
            <div class="lobby-settings-links"><button id="open-rules" class="text-button" type="button">游戏规则与帮助</button></div>
          </section>
        </div>
      </section>`;
}

/** D's replaceable DOM shell. No business data is written by this module. */
export function mountShell(root: HTMLElement): void {
  const valueCard = `<section class="side-card value-card"><div class="section-kicker">本局物资价值 <span id="gate-label">尚未出发</span></div>
            <progress id="value-progress" max="${RAID_RULES.threshold}" value="0" aria-label="撤离价值达成"></progress>
            <p id="value-hint">只有本局搜到并仍携带的物品计入。</p>
          </section>`;
  const nightCard = `<section class="side-card night-card"><div class="section-kicker">夜间装备</div>
            <div class="meter-line"><span>手电电量</span><b id="battery">100%</b></div>
            <progress id="battery-progress" max="100" value="100" aria-label="手电电量"></progress>
            <p class="muted" id="light-reserves">备用电池 2 · 照明棒 2</p>
          </section>`;
  const questCard = `<section class="side-card quest-card" id="quest-panel"><div class="section-kicker">思源密码 · 任务进度 <span id="quest-count">0 / 2</span></div>
            <ul id="quest-steps" class="quest-steps"></ul>
            <p id="quest-status" class="muted">线索：思源楼前残缺手记</p>
          </section>`;
  const resultCard = `<section class="side-card result-card" id="result-panel" role="dialog" aria-modal="true" aria-labelledby="result-title" hidden><h2 id="result-title">本次结算</h2><p id="result-detail"></p>
            <p id="quest-unlock" class="quest-unlock" hidden></p><p id="quest-lock" class="muted" hidden></p>
            <button id="retry-save" class="primary" hidden>重试保存</button><button id="next" class="primary" hidden>返回准备</button>
          </section>`;
  const debugCard = `<details id="debug-panel" class="debug" hidden><summary>开发调试</summary><button id="damage" class="secondary">模拟受到 25 点伤害</button><button id="fatal" class="text-button">模拟死亡</button><button id="debug-grant-uncommon" class="secondary">发放 1 件稀有（25）</button><button id="debug-grant-epic" class="secondary">发放 1 件史诗（60）</button><button id="debug-grant-notebook" class="secondary">发放残缺手记（本局主线）</button><button id="debug-grant-feather" class="secondary">发放异常羽毛（普通收藏）</button><button id="debug-tp-notebook" class="secondary">传送·思源楼前</button><button id="debug-tp-feather" class="secondary">传送·明湖石碑</button><button id="debug-tp-extract" class="secondary">传送·南门撤离点</button></details>`;
  root.innerHTML = `
    <div id="game-page">
    <section id="prologue" class="prologue" aria-label="序章对话" aria-modal="true" role="dialog" tabindex="-1">
      <div class="prologue-stage">
        <img id="prologue-image" class="prologue-image" src="${assetUrl('images/prologue-discovery.svg')}" alt="思源楼前的夜路、宝箱与被路灯照亮的草稿纸" />
        <p id="prologue-progress" class="prologue-progress">序章</p>
        <div id="prologue-story-overlay" class="prologue-story-overlay" hidden>
          <div id="prologue-story-box" class="prologue-story-box">
            <p class="story-label" id="prologue-story-label"></p>
            <p class="story-speaker" id="prologue-story-speaker"></p>
            <p class="story-line" id="prologue-story-line" aria-live="polite"></p>
            <div class="story-footer">
              <span class="story-progress" id="prologue-story-progress"></span>
              <span class="story-hint" id="prologue-story-hint"></span>
            </div>
          </div>
        </div>
        <button id="prologue-continue-hint" class="prologue-continue-hint" hidden>点击继续 <span>▸</span></button>
        <button id="prologue-paper-hit" class="prologue-hit prologue-paper-hit" aria-label="调查草稿纸"></button>
        <button id="prologue-continue-hit" class="prologue-hit prologue-continue-hit" aria-label="继续序章"></button>
        <button id="prologue-clue-later" class="prologue-hit prologue-clue-later" aria-label="稍后查看线索" hidden></button>
        <button id="prologue-clue-close" class="prologue-hit prologue-clue-close" aria-label="收起线索" hidden></button>
        <button id="prologue-skip" class="prologue-skip-hit">跳过序章 <span>↗</span></button>
      </div>
    </section>
    <header class="masthead">
      <a class="brand" href="./" aria-label="交大摸金录首页"><span class="brand-mark">交</span>
      <span>交大摸金录<small>思源密码 / CAMPUS EXTRACTION</small></span></a>
      <div class="header-actions"><div class="build-label"><span class="status-dot"></span>海淀校区 · 夜巡</div><button id="open-room-legacy" class="rules-button" aria-controls="room-page">联机房间</button><button id="open-rules-legacy" class="rules-button">游戏规则</button></div>
    </header>
    <main>${prepViewMarkup()}
      <div class="play-layout">
        <section class="map-panel" aria-label="游戏地图">
          <div class="mobile-toolbar"><span id="mobile-hud"></span><button id="mobile-sound-game" aria-pressed="false">开启声音</button><button id="mobile-room" aria-controls="room-page">房间</button><button id="mobile-rules">规则</button><button id="mobile-bag" aria-controls="prep-view">出发</button></div>
          <div class="map-viewport"><div id="game-canvas" role="application" aria-label="校园地图"></div>
          <div id="sonic-pulse-overlay" class="sonic-pulse-overlay" aria-hidden="true" hidden></div>
          <div class="raid-hud-left"><div class="raid-location"><span><i class="status-dot"></i><b id="phase-label">准备出发</b><em class="map-scene">海淀校区 · 夜巡</em></span></div>
          ${tutorialMarkup()}<div id="team-status" class="team-status" aria-label="队伍状态" hidden><span id="team-connection" class="network-quality"></span><ul id="team-players"></ul></div></div>
          <span id="raid-value" class="raid-value" role="status" aria-live="polite">本局价值：<b id="loot-value">0</b> / ${RAID_RULES.threshold}</span><div id="status-effects" class="status-effects" role="status" aria-live="polite" hidden></div><span class="map-hud-right"><span>生命 <b id="health">100</b> <em>/</em> 剩余 <b id="timer">10:00</b></span><span id="battery-compact" class="battery-compact">电量 100%</span><button id="open-raid-settings" class="hud-button" aria-haspopup="dialog">${iconSvg('settings', { size: 16 })} 设置 <kbd>Esc</kbd></button></span>
          <p id="map-toast" class="map-toast" role="status" aria-live="polite" hidden></p>
          <div id="key-prompt" class="key-prompt" hidden role="status">
            <div class="key-prompt-ring" aria-hidden="true"><span id="key-prompt-key" class="key-prompt-key">E</span></div>
            <span id="key-prompt-label" class="key-prompt-label">搜索</span>
          </div>
          ${raidInventoryMarkup()}${raidHotbarMarkup()}${resultCard}
          <button id="open-campus-map" class="campus-map-button" aria-haspopup="dialog" aria-controls="campus-map-dialog" aria-keyshortcuts="M" aria-label="放大校园地图（M）">
        <canvas id="campus-overview" class="campus-overview" width="180" height="180" aria-hidden="true"></canvas>
            <span>校园图 · M / 点击放大</span>
          </button>
          <div id="touch-controls" class="touch-controls" aria-label="触屏操作">
            <div class="touch-stick" role="group" aria-label="移动摇杆"><span class="stick-arrows" aria-hidden="true">↑<br>← &rarr;<br>↓</span><span class="stick-knob"></span></div>
            <div class="touch-aim touch-stick" role="group" aria-label="手电瞄准摇杆"><span class="aim-label">瞄准</span><span class="stick-knob"></span></div>
            <div class="touch-actions">
              <button data-touch-action="E" class="touch-interact" disabled>交互</button>
              <button data-touch-action="SPACE" disabled>使用</button>
              <button data-touch-action="Q" disabled>抱抱</button>
              <button data-touch-action="L" aria-pressed="true" disabled>手电</button>
              <button data-touch-action="R" disabled>换电池</button>
              <button data-touch-action="G" disabled>照明棒</button>
            </div>
          </div>
          <div class="interaction"><span id="interaction-label">正在加载校园地图…</span><progress id="interaction-progress" max="1" value="0" aria-label="交互进度"></progress><button id="extract" class="hud-button" type="button">开始撤离</button></div>
          </div>
        </section>
      </div>
      <p id="notice" class="notice" role="status" aria-live="polite" hidden></p>
    </main></div><div id="rotate-phone" class="rotate-phone" hidden><strong>请将手机横过来</strong><p>横屏后继续探索；当前对局已暂停。</p></div>${gameRulesMarkup()}
      <dialog id="campus-map-dialog" class="campus-map-dialog" aria-labelledby="campus-map-title" aria-describedby="campus-map-note">
        <header><h2 id="campus-map-title">海淀主校区 · 校园图</h2><button id="close-campus-map" aria-label="关闭校园图">${iconSvg('close', { size: 20 })}</button></header>
        <div class="campus-map-scroll" tabindex="0" aria-label="校园图，可滚动查看各区域"><canvas id="campus-map-expanded" width="700" height="998" role="img" aria-label="海淀主校区地图，绿色圆点为撤离点，金色圆点为玩家当前位置"></canvas></div>
        <p id="campus-map-note">金色圆点：当前位置 · 金色菱形：当前剧情线索 · 绿色：已调查／撤离点 · 查看时暂停 · M / Esc 关闭<br>校园夜景底图用于游戏导航，不能用于现实导航。</p>
      </dialog>
      <dialog id="raid-settings" class="rules-dialog raid-settings" aria-labelledby="raid-settings-title">
        <header class="rules-header"><h1 id="raid-settings-title">探索已暂停</h1><button id="resume-raid" class="secondary" type="button">继续游戏 · Esc</button></header>
        <div class="rules-content"><div id="raid-settings-slot" class="settings"></div>
          <div class="settings-links"><button id="hud-rules" class="secondary" type="button">游戏规则</button><button id="mobile-fullscreen" class="secondary" type="button" aria-label="全屏游戏">全屏</button></div>
          <div id="raid-details-slot">${valueCard}${nightCard}${questCard}${debugCard}</div>
        </div>
        <footer class="rules-footer"><button id="abandon" class="secondary abandon-button" type="button">放弃并返回大厅</button></footer>
      </dialog>${storyDialogMarkup()}${confirmMarkup()}${roomPageMarkup()}`;
}
