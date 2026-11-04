/** A separate room view; the running game stays mounted while it is hidden. */
export function roomPageMarkup(): string {
  return `<section id="room-page" class="room-page" aria-labelledby="room-title" hidden>
    <header class="room-header">
      <div><p class="rules-eyebrow">思源密码 / CAMPUS EXTRACTION</p><h1 id="room-title" tabindex="-1">联机大厅</h1></div>
      <button id="close-room" class="rules-button">返回校园</button>
    </header>
    <main class="room-content">
      <div class="room-connection"><p id="network-status" role="status" aria-live="polite">正在连接联机服务…</p><button id="network-connect" class="rules-button">重新连接</button></div>
      <div id="room-entry" class="room-entry">
        <section class="side-card" aria-labelledby="room-create-title">
          <div class="section-kicker">01 / 发起集合</div><h2 id="room-create-title">创建房间</h2>
          <p class="muted">自动生成 6 位数字房间号，你将成为房主。将房间号分享给同伴，最多 10 人同行。</p>
          <label class="field-label" for="network-name">当前昵称</label><input id="network-name" maxlength="18" readonly>
          <button id="network-create" class="primary">创建房间 <span>＋</span></button>
        </section>
        <section class="side-card" aria-labelledby="room-join-title">
          <div class="section-kicker">02 / 与同伴汇合</div><h2 id="room-join-title">加入房间</h2>
          <p class="muted">输入同伴分享的房间号，加入后选择装备并准备。</p>
          <form id="network-form">
            <label class="field-label" for="network-room">6 位数字房间号</label>
            <input id="network-room" name="room" type="text" inputmode="numeric" pattern="[0-9]{6}" minlength="6" maxlength="6" autocomplete="off" required placeholder="例如 583219" aria-describedby="network-room-help">
            <p id="network-room-help" class="muted">房间上限 10 人，游戏开始后暂不可加入。</p>
            <button id="network-join" type="submit" class="primary">加入房间 <span>↗</span></button>
          </form>
        </section>
      </div>
      <div id="room-lobby" hidden>
        <div class="room-summary"><div><p class="rules-eyebrow">房间号 · 分享给同伴</p><h2 id="room-state-title" class="room-code"></h2></div><div class="room-summary-actions"><span id="room-count" class="build-label">0 / 10 人</span><button id="network-copy" class="rules-button">复制房间号</button><button id="network-leave" class="rules-button">退出房间</button></div></div>
        <div class="room-lobby-layout">
          <section class="side-card" aria-label="房间成员"><div class="section-kicker">集合成员 <span>最多 10 人</span></div><ul id="network-players" class="room-players"></ul></section>
          <section class="side-card room-preparation" aria-labelledby="room-prepare-title"><div class="section-kicker">行动准备</div><h2 id="room-prepare-title">选择装备，等待出发</h2><div id="room-preparation-slot"></div><p id="room-ready-hint" class="muted" role="status"></p><button id="network-ready" class="primary" aria-pressed="false">准备</button><button id="network-start" class="primary" hidden>开始游戏 <span>↗</span></button></section>
        </div>
        <p class="muted room-note">房主等待所有队友准备后开始游戏。房主退出时，房主身份将自动转交给下一位成员。</p>
      </div>
    </main>
  </section>`;
}
