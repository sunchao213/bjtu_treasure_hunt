import { gameRulesMarkup } from './game-rules';

/** D's replaceable DOM shell. No business data is written by this module. */
export function mountShell(root: HTMLElement): void {
  root.innerHTML = `
    <header class="masthead">
      <a class="brand" href="./" aria-label="交大摸金录首页"><span class="brand-mark">交</span>
      <span>交大摸金录<small>思源密码 / CAMPUS EXTRACTION</small></span></a>
      <div class="header-actions"><div class="build-label"><span class="status-dot"></span>海淀校区 · 夜巡</div><button id="open-rules" class="rules-button">游戏规则</button></div>
    </header>
    <main>
      <div class="play-layout">
        <section class="map-panel" aria-label="游戏地图">
          <div class="map-top"><span><i class="status-dot"></i><b id="phase-label">准备出发</b></span>
            <span>生命 <b id="health">100</b> <em>/</em> 剩余 <b id="timer">10:00</b></span></div>
          <div class="map-viewport"><div id="game-canvas" role="application" aria-label="校园地图"></div>
          <canvas id="campus-overview" class="campus-overview" width="512" height="360" role="img" aria-label="海淀主校区概览，金色圆点为当前位置"></canvas>
          <div id="touch-controls" class="touch-controls" aria-label="触屏操作">
            <div class="touch-stick" role="group" aria-label="移动摇杆"><span class="stick-arrows" aria-hidden="true">↑<br>← &rarr;<br>↓</span><span class="stick-knob"></span></div>
            <div class="touch-actions">
              <button data-touch-action="E" class="touch-interact" disabled>交互</button>
              <button data-touch-action="SPACE" disabled>攻击</button>
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
            <p id="quest-status" class="muted">线索：图书馆外残缺手记</p>
          </section>
          <section class="side-card" id="preparation"><h2>行前准备</h2>
            <label class="field-label" for="starter-weapon">初始武器</label><select id="starter-weapon"><option value="">不携带武器</option><option value="training-bat">训练棍 · 伤害 35</option><option value="stun-baton">电击器 · 伤害 15 · 可使用 15 次</option></select>
            <label class="field-label" for="loadout">从仓库带入一件物品（不计本局价值）</label><select id="loadout"><option value="">轻装出发 · 不带入物品</option></select>
            <label class="consent"><input id="risk-consent" type="checkbox" />我已了解：失败或刷新会损失本局携带物，未带入的仓库物品保留。</label>
            <button id="start" class="primary" disabled>开始探索 <span>↗</span></button>
          </section>
          <section class="side-card" id="inventory-panel" hidden><div class="section-kicker">临时背包 <span id="bag-count">0 / 6</span></div>
            <ul id="inventory" class="inventory"></ul>
            <button id="extract" class="primary">在撤离点申请撤离</button>
            <details class="danger-area"><summary>结束当前对局</summary><p>放弃会损失本局携带物。</p><button id="abandon" class="secondary">确认放弃</button></details>
          </section>
          <section class="side-card result-card" id="result-panel" hidden><h2 id="result-title">本次结算</h2><p id="result-detail"></p>
            <button id="retry-save" class="primary" hidden>重试保存</button><button id="next" class="primary" hidden>返回准备</button>
          </section>
          <section class="side-card archive"><div class="section-kicker">永久仓库 <span id="warehouse-count">0 件</span></div>
            <p id="archive-detail">成功撤离后，物品和图鉴会保存在此浏览器。</p>
            <details><summary>存档管理</summary>
              <button id="export-save" class="secondary">导出存档备份</button><button id="reset-save" class="text-button">重置存档</button></details>
          </section>
          <details id="debug-panel" class="debug" hidden><summary>开发调试</summary><button id="damage" class="secondary">模拟受到 25 点伤害</button><button id="fatal" class="text-button">模拟死亡</button></details>
        </aside>
      </div>
      <p id="notice" class="notice" role="status" aria-live="polite">南门集合，等待出发。</p>
    </main>${gameRulesMarkup()}`;
}
