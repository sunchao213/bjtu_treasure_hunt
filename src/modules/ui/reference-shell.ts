import { gameRulesMarkup } from './game-rules';
import { codexMarkup } from './codex';
import { roomPageMarkup } from './room-page';
import { iconSvg } from './icons';
import { confirmMarkup } from './confirm-dialog';
import { storyDialogMarkup } from './story-dialog';
import { tutorialMarkup } from './tutorial';
import { assetUrl } from '../../app/asset-url';

/**
 * F01 准备页整页首屏（与助教要求一致）：
 * 首屏主内容固定为「初始武器 / 带入选择 / 风险提示 / 勾选框 / 开始按钮」，
 * 仓库与存档等次要入口收在页面底部的折叠区，不占用首屏。
 */
export function prepViewMarkup(): string {
  return `
      <section id="prep-view" class="prep-view" hidden aria-label="行前准备">
        <div class="prep-page">
          <nav class="lobby-nav" aria-label="准备大厅功能">
            <div class="lobby-nav-brand"><span class="lobby-nav-mark">交</span><span><b>思源密码</b><small>OPERATIONS DESK</small></span></div>
            <div class="lobby-profile-mini"><span id="lobby-player-avatar" class="lobby-avatar"></span><span><b id="lobby-player-name"></b><small>海淀校区 · 账号云存档</small></span><i class="status-dot"></i></div>
            <p class="lobby-nav-label">行动中心</p>
            <button class="lobby-nav-item is-active" type="button" data-lobby-tab="prepare">出发准备</button>
            <button class="lobby-nav-item" type="button" data-lobby-tab="warehouse">仓库</button>
            <p class="lobby-nav-label">系统</p>
            <button class="lobby-nav-item" type="button" data-lobby-tab="settings">设置</button>
            <div class="lobby-nav-footer"><span class="status-dot"></span>账号云存档<br /><small>准备 · 探索 · 撤离</small></div>
          </nav>
          <section class="lobby-panel is-active" data-lobby-panel="prepare" aria-labelledby="lobby-prepare-title">
          <div class="lobby-commandbar"><div><span class="lobby-eyebrow">准备大厅 / 任务简报</span><strong>夜间行动窗口 · 23:40 - 04:30</strong></div><div class="lobby-weather"><span class="weather-moon">◐</span><span><b>小雨 · 能见度低</b><small>异常活动：轻度</small></span></div></div>
          <header class="prep-hero">
            <p class="prep-kicker">思源密码 · 行前准备</p>
            <h2 id="lobby-prepare-title">今晚，一起平安归来。</h2>
            <p class="prep-brief">搜集物资，调查校园异闻。携带价值达到 100 后，回到南门安全撤离。</p>
            <div class="lobby-mission-strip"><span class="mission-number">01</span><span><b>第一章 · 明湖边的异常羽毛</b><small>带回两件证据，并从南门安全撤离</small></span><span id="mission-status" class="mission-status">待调查</span></div>
            <ol class="prep-goals" aria-label="本局目标">
              <li><b>残缺手记</b><span>图书馆外 · 旧书架</span></li>
              <li><b>异常羽毛</b><span>明湖 · 石碑</span></li>
              <li><b>携带价值 ≥ 100</b><span>南门 · 撤离点</span></li>
            </ol>
          </header>
          <div class="mode-selection" role="group" aria-label="选择游戏模式">
            <button id="mode-solo" class="mode-option" aria-pressed="true"><span>01 / SOLO</span><b>单人探索</b><small>独自出发，自由调查校园</small></button>
            <button id="mode-room" class="mode-option" aria-pressed="false"><span>02 / SQUAD</span><b>组队探索 ↗</b><small>创建房间或输入房间号加入</small></button>
          </div>
          <div id="preparation" class="prep-main">
            <div class="game-load-feedback"><p id="game-load-status" class="game-load-status" role="status">正在加载校园与角色资源…</p><button id="reload-game" class="secondary" hidden>重新加载校园</button></div>
            <section class="prep-block prep-kit" aria-labelledby="prep-kit-title">
              <h3 id="prep-kit-title">装备与带入</h3>
              <ul class="prep-equipment">
                <li><b>手电筒</b><span>电量 100% · 默认开启，照亮搜索点</span></li>
              </ul>
              <label class="field-label" for="starter-weapon">初始武器</label>
              <select id="starter-weapon"><option value="">不携带武器</option><option value="training-bat" selected>训练棍 · 伤害 35</option><option value="stun-baton">电击器 · 伤害 15 · 可使用 15 次</option></select>
              <label class="field-label" for="loadout-item">仓库带入选择</label>
              <div id="loadout" class="loadout-options" aria-describedby="loadout-slots"><p class="loadout-empty">仓库中暂无可带入的功能物品。</p></div>
              <p id="loadout-slots" class="loadout-slots">已选 0 / 6 格</p>
              <label class="field-label" for="purchase-item">购买辅助道具</label>
              <div class="purchase-row">
                <select id="purchase-item" aria-label="购买辅助道具">
                  <option value="">选择辅助道具</option>
                  <option value="bandage">创可贴 · 10 交子 · 恢复 10 点生命 · 占 1 格</option>
                  <option value="yellow-bike">小黄车 · 50 交子 · 移速 +20% · 占 2 格</option>
                  <option value="thick-down-jacket">超厚羽绒服 · 100 交子 · 无敌 5 秒 · 占 1 格</option>
                </select>
                <button id="purchase-item-button" class="secondary" type="button">购买</button>
              </div>
            </section>
            <section class="prep-block prep-launch" aria-labelledby="prep-launch-title">
              <h3 id="prep-launch-title">出发前确认</h3>
              <p class="prep-warning">失败、超时或刷新页面会<b>损失本局全部携带物（含带入装备）</b>；未带入的仓库物品保留。</p>
              <label class="consent"><input id="risk-consent" type="checkbox" />我已了解上述风险，愿意出发。</label>
              <button id="start" class="primary prep-start" disabled>开始探索 <span>↗</span></button>
              <button id="tutorial-restart" class="text-button prep-tutorial" type="button">重看新手引导</button>
            </section>
          </div>
          </section>
          <section class="lobby-panel lobby-panel-wide" data-lobby-panel="warehouse" hidden aria-labelledby="lobby-warehouse-title">
            <div class="lobby-panel-heading"><div><p class="prep-kicker">永久保存</p><h2 id="lobby-warehouse-title">仓库与剧情档案</h2></div><span class="lobby-panel-meta" id="warehouse-count-label">0 件物品 · <b id="currency-count">0 交子</b></span></div>
            <p class="lobby-panel-intro" id="warehouse-panel-intro">成功撤离后，物品和图鉴会保存到当前账号的云端仓库。</p>
            <section class="side-card archive"><div class="section-kicker">永久仓库 <span id="warehouse-count">0 件</span></div>
              <p id="archive-detail">成功撤离后，物品和图鉴会保存到当前账号的云端仓库。</p>
              <div class="warehouse-sections" aria-label="永久仓库物品">
                <section class="warehouse-section"><h3>探索地图物品</h3><p class="warehouse-subtitle">探索带回的功能物品</p><ul id="exploration-warehouse" class="warehouse-list"></ul><p id="exploration-warehouse-empty" class="warehouse-empty">暂无功能物品</p></section>
                <section class="warehouse-section"><h3>购买道具</h3><p class="warehouse-subtitle">商店购买的功能道具</p><ul id="purchase-warehouse" class="warehouse-list"></ul><p id="purchase-warehouse-empty" class="warehouse-empty">暂无购买道具</p></section>
              </div>
              <button id="archive-codex" class="secondary">查看图鉴 / 导出图片</button>
              <div hidden><ul id="codex-list"></ul><div id="story-archive"></div></div>
              <details><summary>存档管理</summary>
                <button id="export-save" class="secondary">导出存档备份（JSON）</button><button id="reset-save" class="text-button">重置存档</button></details>
            </section>
          </section>
          <section class="lobby-panel lobby-panel-wide" data-lobby-panel="settings" hidden aria-labelledby="lobby-settings-title">
            <div class="lobby-panel-heading"><div><p class="prep-kicker">体验选项</p><h2 id="lobby-settings-title">设置</h2></div></div>
            <div id="lobby-settings-slot" class="lobby-settings-slot"></div>
          </section>
        </div>
      </section>`;
}

/** D's replaceable DOM shell. No business data is written by this module. */
export function mountShell(root: HTMLElement): void {
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
      <div class="header-actions"><div class="build-label"><span class="status-dot"></span>海淀校区 · 夜巡</div><button id="open-room" class="rules-button" aria-controls="room-page">联机房间</button><button id="open-codex" class="rules-button">物品图鉴</button><button id="open-rules" class="rules-button">游戏规则</button></div>
    </header>
    <main>${prepViewMarkup()}
      <div class="play-layout">
        <section class="map-panel" aria-label="游戏地图">
          <div class="map-top"><span><i class="status-dot"></i><b id="phase-label">准备出发</b></span>
            <span class="map-hud-right"><span>生命 <b id="health">100</b> <em>/</em> 剩余 <b id="timer">10:00</b></span><span class="map-actions"><button id="hud-codex" class="hud-button" aria-haspopup="dialog">图鉴</button><button id="hud-rules" class="hud-button" aria-haspopup="dialog">规则</button></span></span></div>
          <div class="mobile-toolbar"><span id="mobile-hud"></span><button id="mobile-fullscreen" aria-label="全屏横屏显示">全屏</button><button id="mobile-sound" aria-pressed="false">开启声音</button><button id="mobile-room" aria-controls="room-page">房间</button><button id="mobile-codex">图鉴</button><button id="mobile-rules">规则</button><button id="mobile-bag" aria-controls="prep-view">出发</button></div>
          <div id="team-status" class="team-status" aria-label="队伍状态" hidden><span id="team-connection" class="network-quality"></span><ul id="team-players"></ul></div>
          <div class="map-viewport"><div id="game-canvas" role="application" aria-label="校园地图"></div>
          <p id="map-toast" class="map-toast" role="status" aria-live="polite" hidden></p>
          <div id="key-prompt" class="key-prompt" hidden role="status">
            <div class="key-prompt-ring" aria-hidden="true"><span id="key-prompt-key" class="key-prompt-key">E</span></div>
            <span id="key-prompt-label" class="key-prompt-label">搜索</span>
          </div>
          ${tutorialMarkup()}
          <button id="open-campus-map" class="campus-map-button" aria-haspopup="dialog" aria-label="放大校园地图">
        <canvas id="campus-overview" class="campus-overview" width="180" height="180" aria-hidden="true"></canvas>
            <span>校园图 · 点击放大</span>
          </button>
          <div id="touch-controls" class="touch-controls" aria-label="触屏操作">
            <div class="touch-stick" role="group" aria-label="移动摇杆"><span class="stick-arrows" aria-hidden="true">↑<br>← &rarr;<br>↓</span><span class="stick-knob"></span></div>
            <div class="touch-aim touch-stick" role="group" aria-label="手电瞄准摇杆"><span class="aim-label">瞄准</span><span class="stick-knob"></span></div>
            <div class="touch-actions">
              <button data-touch-action="E" class="touch-interact" disabled>交互</button>
              <button data-touch-action="SPACE" disabled>攻击</button>
              <button data-touch-action="Q" disabled>抱抱</button>
              <button data-touch-action="L" aria-pressed="true" disabled>手电</button>
              <button data-touch-action="R" disabled>换电池</button>
              <button data-touch-action="G" disabled>照明棒</button>
            </div>
          </div>
          </div>
          <div class="interaction"><span id="interaction-label">正在加载校园地图…</span><progress id="interaction-progress" max="1" value="0" aria-label="交互进度"></progress></div>
        </section>
        <aside>
          <section class="side-card value-card"><div class="section-kicker">本局物资价值 <span id="gate-label">尚未出发</span></div>
            <div class="value"><b id="loot-value">0</b><span>/ 100</span></div>
            <progress id="value-progress" max="100" value="0" aria-label="撤离价值达成"></progress>
            <p id="value-hint">只有本局搜到并仍携带的物品计入。</p>
          </section>
          <section class="side-card night-card"><div class="section-kicker">夜间装备</div>
            <div class="meter-line"><span>手电电量</span><b id="battery">100%</b></div>
            <progress id="battery-progress" max="100" value="100" aria-label="手电电量"></progress>
            <p class="muted" id="light-reserves">备用电池 2 · 照明棒 2</p>
          </section>
          <section class="side-card quest-card" id="quest-panel"><div class="section-kicker">思源密码 · 任务进度 <span id="quest-count">0 / 2</span></div>
            <ul id="quest-steps" class="quest-steps"></ul>
            <p id="quest-status" class="muted">线索：思源楼前残缺手记</p>
          </section>
          <section class="side-card" id="inventory-panel" hidden><div class="section-kicker">临时背包 <span id="bag-count">0 / 6</span></div>
            <ul id="inventory" class="inventory"></ul>
            <button id="extract" class="primary">在撤离点申请撤离</button>
            <details class="danger-area"><summary>结束当前对局</summary><p>放弃会损失本局携带物。</p><button id="abandon" class="secondary">放弃探索</button></details>
          </section>
          <section class="side-card result-card" id="result-panel" role="dialog" aria-modal="true" aria-labelledby="result-title" hidden><h2 id="result-title">本次结算</h2><p id="result-detail"></p>
            <p id="quest-unlock" class="quest-unlock" hidden></p><p id="quest-lock" class="muted" hidden></p>
            <button id="retry-save" class="primary" hidden>重试保存</button><button id="next" class="primary" hidden>返回准备</button>
          </section>
          <details id="debug-panel" class="debug" hidden><summary>开发调试</summary><button id="damage" class="secondary">模拟受到 25 点伤害</button><button id="fatal" class="text-button">模拟死亡</button><button id="debug-grant-uncommon" class="secondary">发放 1 件稀有（25）</button><button id="debug-grant-epic" class="secondary">发放 1 件史诗（60）</button><button id="debug-grant-notebook" class="secondary">发放残缺手记（本局主线）</button><button id="debug-grant-feather" class="secondary">发放异常羽毛（普通收藏）</button><button id="debug-tp-notebook" class="secondary">传送·思源楼前</button><button id="debug-tp-feather" class="secondary">传送·明湖石碑</button><button id="debug-tp-extract" class="secondary">传送·南门撤离点</button></details>
        </aside>
      </div>
      <p id="notice" class="notice" role="status" aria-live="polite">南门集合，等待出发。</p>
    </main></div><div id="rotate-phone" class="rotate-phone" hidden><strong>请将手机横过来</strong><p>横屏后继续探索；当前对局已暂停。</p></div>${gameRulesMarkup()}
      <dialog id="campus-map-dialog" class="campus-map-dialog" aria-labelledby="campus-map-title" aria-describedby="campus-map-note">
        <header><h2 id="campus-map-title">海淀主校区 · 校园图</h2><button id="close-campus-map" aria-label="关闭校园图">${iconSvg('close', { size: 20 })}</button></header>
        <div class="campus-map-scroll" tabindex="0" aria-label="校园图，可滚动查看各区域"><canvas id="campus-map-expanded" width="700" height="998" role="img" aria-label="海淀主校区地图，绿色圆点为撤离点，金色圆点为玩家当前位置"></canvas></div>
        <p id="campus-map-note">金色圆点：当前位置 · 绿色圆点：撤离点 · 蓝色圆点：队友 · 查看时暂停 · 手机可滑动查看<br>校园夜景底图用于游戏导航，不能用于现实导航。</p>
      </dialog>${codexMarkup()}${storyDialogMarkup()}${confirmMarkup()}${roomPageMarkup()}`;
}
