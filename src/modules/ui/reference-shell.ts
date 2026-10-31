import { gameRulesMarkup } from './game-rules';
import { codexMarkup } from './codex';
import { storyDialogMarkup } from './story-dialog';
import { tutorialMarkup } from './tutorial';

/**
 * R01 准备页整页首屏（与助教要求一致）：
 * 首屏主内容固定为「初始武器 / 带入选择 / 风险提示 / 勾选框 / 开始按钮」，
 * 仓库与存档等次要入口收在页面底部的折叠区，不占用首屏。
 */
export function prepViewMarkup(): string {
  return `
      <section id="prep-view" class="prep-view" hidden aria-label="行前准备">
        <div class="prep-page">
          <nav class="lobby-nav" aria-label="准备大厅功能">
            <div class="lobby-nav-brand"><span class="lobby-nav-mark">交</span><span><b>思源密码</b><small>OPERATIONS DESK</small></span></div>
            <div class="lobby-profile-mini"><span class="lobby-avatar">D</span><span><b>夜巡调查员</b><small>海淀校区 · 本地存档</small></span><i class="status-dot"></i></div>
            <p class="lobby-nav-label">行动中心</p>
            <button class="lobby-nav-item is-active" type="button" data-lobby-tab="prepare">出发准备</button>
            <button class="lobby-nav-item" type="button" data-lobby-tab="warehouse">仓库</button>
            <!-- 商店与好友/邀请不在 V1.0 冻结范围内（不新增经济系统与多人联机）：
                 界面代码保留，入口先隐藏，排期后再开放。 -->
            <button class="lobby-nav-item" type="button" data-lobby-tab="shop" hidden>商店</button>
            <p class="lobby-nav-label">系统</p>
            <button class="lobby-nav-item" type="button" data-lobby-tab="friends" hidden>好友 / 邀请</button>
            <button class="lobby-nav-item" type="button" data-lobby-tab="settings">设置</button>
            <div class="lobby-nav-footer"><span class="status-dot"></span>本地存档 · 单机运行<br /><small>V1.0 冻结范围</small></div>
          </nav>
          <section class="lobby-panel is-active" data-lobby-panel="prepare" aria-labelledby="lobby-prepare-title">
          <div class="lobby-commandbar"><div><span class="lobby-eyebrow">准备大厅 / 任务简报</span><strong>夜间行动窗口 · 23:40 - 04:30</strong></div><div class="lobby-weather"><span class="weather-moon">◐</span><span><b>小雨 · 能见度低</b><small>异常活动：轻度</small></span></div></div>
          <header class="prep-hero">
            <p class="prep-kicker">思源密码 · 行前准备</p>
            <h2 id="lobby-prepare-title">晚归的路上，多看了一眼那盏灯</h2>
            <p class="prep-brief">你只是忘了带校园卡，回宿舍比平时晚了一点。图书馆外旧书架旁多出一盏从没见过的灯，页脚写着「思源」。今晚把线索带出去，别走地图上没有的路。</p>
            <div class="lobby-mission-strip"><span class="mission-number">01</span><span><b>第一章 · 明湖边的异常羽毛</b><small>带回两件证据，并从南门安全撤离</small></span><span class="mission-status">未开始</span></div>
            <ol class="prep-goals" aria-label="本局目标">
              <li><b>残缺手记</b><span>图书馆外 · 旧书架</span></li>
              <li><b>异常羽毛</b><span>明湖 · 石碑</span></li>
              <li><b>携带价值 ≥ 100</b><span>南门 · 撤离点</span></li>
            </ol>
          </header>
          <div class="prep-main">
            <section class="prep-block prep-kit" aria-labelledby="prep-kit-title">
              <h3 id="prep-kit-title">装备与带入</h3>
              <ul class="prep-equipment">
                <li><b>手电筒</b><span>电量 100% · 默认开启，照亮搜索点</span></li>
              </ul>
              <label class="field-label" for="starter-weapon">初始武器</label>
              <select id="starter-weapon"><option value="">不携带武器</option><option value="training-bat">训练棍 · 伤害 35</option><option value="stun-baton">电击器 · 伤害 15 · 可使用 15 次</option></select>
              <label class="field-label" for="loadout">带入选择 · 从仓库带入一件物品（不计本局价值）</label>
              <select id="loadout"><option value="">轻装出发 · 不带入物品</option></select>
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
            <div class="lobby-panel-heading"><div><p class="prep-kicker">永久保存</p><h2 id="lobby-warehouse-title">仓库与剧情档案</h2></div><span class="lobby-panel-meta" id="warehouse-count-label">0 件物品</span></div>
            <p class="lobby-panel-intro" id="warehouse-panel-intro">成功撤离后，物品和图鉴会保存在此浏览器。</p>
            <section class="side-card archive"><div class="section-kicker">永久仓库 <span id="warehouse-count">0 件</span></div>
              <p id="archive-detail">成功撤离后，物品和图鉴会保存在此浏览器。</p>
              <button id="archive-codex" class="secondary">查看图鉴 / 导出图片</button>
              <details class="codex-panel"><summary>图鉴与剧情档案</summary>
                <ul id="codex-list" class="codex-list"></ul>
                <div id="story-archive" class="story-archive"></div>
              </details>
              <details><summary>存档管理</summary>
                <button id="export-save" class="secondary">导出存档备份（JSON）</button><button id="reset-save" class="text-button">重置存档</button></details>
            </section>
          </section>
          <section class="lobby-panel lobby-panel-wide" data-lobby-panel="shop" hidden aria-labelledby="lobby-shop-title">
            <div class="lobby-panel-heading"><div><p class="prep-kicker">补给与装备</p><h2 id="lobby-shop-title">商店</h2></div><span class="lobby-panel-meta">范围外预留</span></div>
            <p class="lobby-panel-intro">商店与经济系统不在 V1.0 冻结范围内，本版不提供入口；当前可在出发准备中选择初始武器。</p>
            <div class="lobby-empty-state"><span class="lobby-empty-icon">◇</span><strong>未纳入 V1.0</strong><span>开放前需按冻结变更流程评审并更新需求、设计与用例。</span></div>
          </section>
          <section class="lobby-panel lobby-panel-wide" data-lobby-panel="friends" hidden aria-labelledby="lobby-friends-title">
            <div class="lobby-panel-heading"><div><p class="prep-kicker">组队探索</p><h2 id="lobby-friends-title">好友与邀请</h2></div><span class="lobby-panel-meta">范围外预留</span></div>
            <p class="lobby-panel-intro">多人联机不在 V1.0 冻结范围内，本版不提供入口。</p>
            <div class="lobby-friends-actions"><button class="secondary" type="button" disabled>邀请好友</button><button class="secondary" type="button" disabled>添加好友</button></div>
            <div class="lobby-empty-state"><span class="lobby-empty-icon">＋</span><strong>未纳入 V1.0</strong><span>开放前需按冻结变更流程评审并更新需求、设计与用例。</span></div>
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
    <section id="prologue" class="prologue" aria-label="序章对话" aria-modal="true" role="dialog" tabindex="-1">
      <div class="prologue-stage">
        <img id="prologue-image" class="prologue-image" src="/images/prologue-discovery.svg" alt="图书馆外的夜路、旧书架与被路灯照亮的草稿纸" />
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
      <div class="header-actions"><div class="build-label"><span class="status-dot"></span>海淀校区 · 夜巡</div><button id="open-codex" class="rules-button">物品图鉴</button><button id="open-rules" class="rules-button">游戏规则</button></div>
    </header>
    <main>${prepViewMarkup()}
      <div class="play-layout">
        <section class="map-panel" aria-label="游戏地图">
          <div class="map-top"><span><i class="status-dot"></i><b id="phase-label">准备出发</b></span>
            <span>生命 <b id="health">100</b> <em>/</em> 剩余 <b id="timer">10:00</b></span></div>
          <div class="mobile-toolbar"><span id="mobile-hud"></span><button id="mobile-fullscreen" aria-label="全屏横屏显示">全屏</button><button id="mobile-sound" aria-pressed="false">开启声音</button><button id="mobile-codex">图鉴</button><button id="mobile-rules">规则</button><button id="mobile-bag" aria-controls="preparation">出发</button></div>
          <div class="map-viewport"><div id="game-canvas" role="application" aria-label="校园地图"></div>
          <p id="map-toast" class="map-toast" role="status" aria-live="polite" hidden></p>
          ${tutorialMarkup()}
          <button id="open-campus-map" class="campus-map-button" aria-haspopup="dialog" aria-label="放大校园地图">
            <canvas id="campus-overview" class="campus-overview" width="600" height="400" aria-hidden="true"></canvas>
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
            <ul id="quest-steps" class="quest-steps">
              <li data-evidence="torn-notebook">残缺手记 · 图书馆外</li>
              <li data-evidence="anomalous-feather">异常羽毛 · 明湖石碑</li>
            </ul>
            <p id="quest-status" class="muted">线索：图书馆外残缺手记</p>
          </section>
          <section class="side-card" id="inventory-panel" hidden><div class="section-kicker">临时背包 <span id="bag-count">0 / 6</span></div>
            <ul id="inventory" class="inventory"></ul>
            <button id="extract" class="primary">在撤离点申请撤离</button>
            <details class="danger-area"><summary>结束当前对局</summary><p>放弃会损失本局携带物。</p><button id="abandon" class="secondary">放弃探索</button></details>
          </section>
          <section class="side-card result-card" id="result-panel" hidden><h2 id="result-title">本次结算</h2><p id="result-detail"></p>
            <p id="quest-unlock" class="quest-unlock" hidden></p><p id="quest-lock" class="muted" hidden></p>
            <button id="retry-save" class="primary" hidden>重试保存</button><button id="next" class="primary" hidden>返回准备</button>
          </section>
          <details id="debug-panel" class="debug" hidden><summary>开发调试</summary><button id="damage" class="secondary">模拟受到 25 点伤害</button><button id="fatal" class="text-button">模拟死亡</button><button id="debug-grant-uncommon" class="secondary">发放 1 件稀有（25）</button><button id="debug-grant-epic" class="secondary">发放 1 件史诗（60）</button><button id="debug-grant-notebook" class="secondary">发放残缺手记（主线）</button><button id="debug-grant-feather" class="secondary">发放异常羽毛（主线）</button><button id="debug-tp-notebook" class="secondary">传送·图书馆书架</button><button id="debug-tp-feather" class="secondary">传送·明湖石碑</button><button id="debug-tp-extract" class="secondary">传送·南门撤离点</button></details>
        </aside>
      </div>
      <p id="notice" class="notice" role="status" aria-live="polite">南门集合，等待出发。</p>
    </main><div id="rotate-phone" class="rotate-phone" hidden><strong>请将手机横过来</strong><p>横屏后继续探索；当前对局已暂停。</p></div>${gameRulesMarkup()}
      <dialog id="campus-map-dialog" class="campus-map-dialog" aria-labelledby="campus-map-title" aria-describedby="campus-map-note">
        <header><h2 id="campus-map-title">海淀主校区 · 校园图</h2><button id="close-campus-map" aria-label="关闭校园图">×</button></header>
        <div class="campus-map-scroll" tabindex="0" aria-label="校园图，可滚动查看各区域"><canvas id="campus-map-expanded" width="1200" height="800" role="img" aria-label="海淀主校区简化布局，北朝上，金色圆点为玩家当前位置"></canvas></div>
        <p id="campus-map-note">金色圆点：当前位置 · 南门：唯一撤离点 · 查看时暂停 · 手机可滑动查看<br>依据小组提供的海淀主校区地图简化制作，非 1:1 测绘，不能用于现实导航。</p>
      </dialog>${codexMarkup()}${storyDialogMarkup()}`;
}
