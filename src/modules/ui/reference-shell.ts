/** D's replaceable DOM shell. No business data is written by this module. */
export function mountShell(root: HTMLElement): void {
  root.innerHTML = `
    <header class="masthead">
      <a class="brand" href="./" aria-label="交大摸金录首页"><span class="brand-mark">交</span>
      <span>交大摸金录<small>思源密码 / CAMPUS EXTRACTION</small></span></a>
      <div class="build-label"><span class="status-dot"></span>A 阶段 · 可运行框架</div>
    </header>
    <main>
      <section class="intro"><div><p class="eyebrow">北京交通大学 · 校园探索</p>
        <h1>搜寻校园记忆，<span>带着收获归来。</span></h1>
        <p class="lede">物资达到 <strong>100</strong> 价值后，前往南侧撤离点。继续搜索，还是见好就收？</p>
      </div><div class="edition">01<span>思源行动</span></div></section>
      <div class="play-layout">
        <section class="map-panel" aria-label="游戏地图">
          <div class="map-top"><span><i class="status-dot"></i><b id="phase-label">准备出发</b></span>
            <span>生命 <b id="health">100</b> <em>/</em> 剩余 <b id="timer">10:00</b></span></div>
          <div id="game-canvas" role="application" aria-label="WASD移动，靠近物资长按E搜索，撤离区按E撤离"></div>
          <div class="interaction"><span id="interaction-label">正在加载校园地图…</span><progress id="interaction-progress" max="1" value="0" aria-label="交互进度"></progress></div>
          <div class="key-help"><span><kbd>W A S D</kbd> 移动</span><span><kbd>E</kbd> 搜索 / 撤离</span><span><i class="gold-dot"></i> 物资点</span><span><i class="mint-dot"></i> 南侧撤离点</span></div>
        </section>
        <aside>
          <section class="side-card value-card"><div class="section-kicker">本局物资价值 <span id="gate-label">尚未出发</span></div>
            <div class="value"><b id="loot-value">0</b><span>/ 100</span></div>
            <progress id="value-progress" max="100" value="0" aria-label="撤离价值达成"></progress>
            <p id="value-hint">只有本局搜到并仍携带的物品计入。</p>
          </section>
          <section class="side-card" id="preparation"><h2>行前准备</h2>
            <p class="muted">免费训练棍始终可用。本阶段先验证搜索与撤离，战斗、抱抱和剧情由组员继续接入。</p>
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
          <section class="side-card archive"><div class="section-kicker">联调仓库 <span id="warehouse-count">0 件</span></div>
            <p id="archive-detail">成功撤离后，物品和图鉴会保存在此浏览器。</p>
            <details><summary>存档与框架说明</summary><p>使用独立的联调存档，不是正式游戏存档。请勿清理浏览器数据；剧情系统尚未接入。</p>
              <button id="export-save" class="secondary">导出存档备份</button><button id="reset-save" class="text-button">确认后重置联调存档</button></details>
          </section>
          <section id="debug-panel" class="side-card debug" hidden><h2>开发联调入口</h2><p>仅开发环境显示，代替 C 的伤害事件。</p><button id="damage" class="secondary">模拟受到 25 点伤害</button><button id="fatal" class="text-button">模拟死亡</button></section>
        </aside>
      </div>
      <p id="notice" class="notice" role="status" aria-live="polite">八个物资点、两条探索路线。先带回四件稀有物品，打通你的第一局。</p>
      <footer><span>素材由代码绘制 · 无账号 / 无敏感数据</span><span>框架阶段：A 主流程 · B 数据参考适配器 · C / D 正式玩法待接入</span></footer>
    </main>`;
}
