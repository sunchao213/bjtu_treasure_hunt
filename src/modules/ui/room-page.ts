import { RAID_RULES } from '../../config/game-config';

/** A separate room view; the running game stays mounted while it is hidden. */
export function roomPageMarkup(): string {
  return `<section id="room-page" class="room-page" aria-labelledby="room-title" hidden>
    <header class="room-header">
      <div><p class="rules-eyebrow">思源密码 / CAMPUS EXTRACTION</p><h1 id="room-title" tabindex="-1">联机大厅</h1></div>
      <button id="close-room" class="rules-button">返回游戏大厅</button>
    </header>
    <main class="room-content">
      <div class="room-connection"><p id="network-status" role="status" aria-live="polite">正在连接联机服务…</p><span id="network-quality" class="network-quality">等待连接</span><button id="network-connect" class="rules-button">重新连接</button></div>
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
          <section class="side-card" aria-label="房间成员"><div class="section-kicker">集合成员 <span id="room-readiness">等待准备</span></div><ul id="network-players" class="room-players"></ul>
            <fieldset id="room-settings" class="room-settings"><legend>房间规则</legend>
              <label for="network-capacity">人数上限<select id="network-capacity">${Array.from({ length: 9 }, (_, i) => `<option value="${i + 2}">${i + 2} 人</option>`).join('')}</select></label>
              <label for="network-admission">加入权限<select id="network-admission"><option value="open">凭房间号加入</option><option value="closed">关闭加入</option></select></label>
              <p id="room-settings-hint" class="muted">仅房主可修改；规则变更后，队友需要重新准备。</p>
            </fieldset>
            <dl class="room-rules-summary"><div><dt>探索时限</dt><dd>${RAID_RULES.durationMs / 60_000} 分钟</dd></div><div><dt>撤离条件</dt><dd>个人价值达到 ${RAID_RULES.threshold}</dd></div><div><dt>队友识别</dt><dd>相同角色 · 昵称区分</dd></div></dl>
            <p class="muted room-note">同伴共享位置与地图布局；物资、战斗和撤离进度各自计算。所有成员结束后，可在原房间准备下一局。</p>
          </section>
          <section class="side-card room-preparation" aria-labelledby="room-prepare-title"><div class="section-kicker">行动准备</div><h2 id="room-prepare-title">选择装备，等待出发</h2><div id="room-preparation-slot"></div></section>
        </div>
        <footer class="room-launchbar"><p id="room-ready-hint" class="muted" role="status"></p><button id="network-ready" class="primary" aria-pressed="false">准备</button><button id="network-start" class="primary" hidden>开始游戏 <span>↗</span></button></footer>
      </div>
    </main>
  </section>`;
}
