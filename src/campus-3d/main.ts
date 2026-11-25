import './style.css';
import { ITEM_DEFINITIONS, RAID_RULES } from '../config/game-config';
import { acquireSaveLock } from '../modules/save/single-writer';
import { SoundManager } from '../modules/ui/sound-manager';
import {
  AREA_NAME,
  IS_DISTRICT,
  DISTRICT_LAYOUT,
  CONTEXT_LANDMARKS,
  EXTRACTION_NAME,
  IS_SIYUAN,
  MAP_BUILDINGS,
  MAP_ROADS,
  TREES,
  TRIAL_AUDIO_KEY,
  TRIAL_LOCK,
  TRIAL_MAP,
} from './map';
import { TrialControls } from './input';
import { EMPTY_INPUT, TrialSession } from './session';
import { CampusView } from './view';
import { MODEL_URL } from './map';
import type { NightAction } from './night';
import type { CombatWeaponId } from '../modules/world/night-systems';

const NIGHT_MODE = new URLSearchParams(location.search).get('time') !== 'day';
document.body.classList.toggle('night', NIGHT_MODE);
const modeLink = new URL(location.href);
modeLink.searchParams.set('time', NIGHT_MODE ? 'day' : 'night');

document.title = `${AREA_NAME}漫游 · 三维校园试验区`;
const root = document.getElementById('campus-app')!;
root.innerHTML = `
  <main class="campus-shell">
    <div id="world" class="world"></div>
    <header class="masthead">
      <div class="brand"><span class="brand-mark" aria-hidden="true">交</span><div><h1>${AREA_NAME}漫游</h1><p>三维试验区 · 独立存档</p></div></div>
      <nav aria-label="试验区操作"><a class="area-link" href="?area=${IS_DISTRICT ? 'siyuan' : 'district'}">${IS_DISTRICT ? '思源楼样板' : '连续校园区块'}</a>${IS_DISTRICT ? '<button id="overview-button" class="quiet" aria-pressed="false">区域总览</button>' : ''}<button id="bag-button" class="quiet" disabled>背包 <kbd>B</kbd></button><button id="pause-button" class="quiet" disabled>暂停 <kbd>Esc</kbd></button></nav>
    </header>
    <section id="hud" class="hud" aria-label="本局状态" hidden>
      <div><span>撤离目标</span><strong><b id="value">0</b><small> / 100</small></strong><progress id="value-progress" max="100" value="0" aria-label="撤离价值"></progress></div>
      <div><span>剩余时间</span><strong id="time">10:00</strong><span id="bag-count">背包 0 / 6</span></div>
      ${NIGHT_MODE ? '<div class="health-status"><span>生命</span><strong><b id="health">100</b><small> / 100</small></strong><progress id="health-progress" max="100" value="100" aria-label="生命值"></progress></div>' : ''}
    </section>
    <aside class="map-card" aria-label="${AREA_NAME}周边地图">
      <div class="map-label"><span>${AREA_NAME}周边</span><span>${IS_SIYUAN || IS_DISTRICT ? '参考布局' : '↑ 北'}</span></div>
      <svg viewBox="0 0 ${TRIAL_MAP.width} ${TRIAL_MAP.height}" role="img" aria-label="校园示意图，金色点为宝箱，绿色区域为撤离点">
        <rect width="${TRIAL_MAP.width}" height="${TRIAL_MAP.height}" rx="24" fill="#a7bb91"/>
        ${IS_DISTRICT ? `<polygon points="${DISTRICT_LAYOUT.forecourt.lawn.polygon.map((p) => `${p.x},${p.y}`).join(' ')}" fill="#6d983e"/><polygon points="${DISTRICT_LAYOUT.forecourt.plaza.polygon.map((p) => `${p.x},${p.y}`).join(' ')}" fill="#c7bb8a" stroke="#a67e68" stroke-width="10"/>` : ''}
        ${IS_DISTRICT ? `<polygon points="${DISTRICT_LAYOUT.lake.map((p) => `${p.x},${p.y}`).join(' ')}" fill="#4d92a5"/>` : ''}
        ${MAP_ROADS.map((road) => `<polyline points="${road.points.map((p) => `${p.x},${p.y}`).join(' ')}" stroke="#e9dfbf" stroke-width="${road.width}" fill="none"/>`).join('')}
        ${MAP_BUILDINGS.map((building) => `<rect x="${building.x}" y="${building.y}" width="${building.width}" height="${building.height}" fill="#657c70" rx="6"/>`).join('')}
        ${CONTEXT_LANDMARKS.map((landmark) => `<g class="context-landmark" aria-label="${landmark.title}，${landmark.status}"><circle cx="${landmark.x}" cy="${landmark.y}" r="26" fill="none" stroke="#617c72" stroke-width="6" stroke-dasharray="10 8"/><text x="${landmark.x}" y="${landmark.y - 48}" text-anchor="middle" style="font-size:72px">${landmark.title}</text></g>`).join('')}
        ${TREES.map((tree) => `<circle cx="${tree.x}" cy="${tree.y}" r="24" fill="#6c8b59"/>`).join('')}
        <rect x="${TRIAL_MAP.extraction.x}" y="${TRIAL_MAP.extraction.y}" width="${TRIAL_MAP.extraction.width}" height="${TRIAL_MAP.extraction.height}" fill="#dbeab0" stroke="#506e41" stroke-width="6"/>
        ${TRIAL_MAP.chests.map((chest, i) => `<g id="map-${chest.id}"><circle cx="${chest.x}" cy="${chest.y}" r="16" fill="#ebbc5a" stroke="#795b22" stroke-width="4"/><text x="${chest.x}" y="${chest.y - 24}" text-anchor="middle">${i + 1}</text></g>`).join('')}
        <circle id="map-player" cx="${TRIAL_MAP.spawn.x}" cy="${TRIAL_MAP.spawn.y}" r="16" fill="#fff" stroke="#254b3c" stroke-width="7"/>
      </svg>
      <p><i></i> 宝箱 <i class="player-dot"></i> 你的位置</p>
      ${IS_SIYUAN ? '<p class="building-key">思源西楼 · 思源楼 · 思源东楼<br/>后方虚线标记为待建建筑</p>' : ''}
    </aside>
    <section id="welcome" class="welcome surface" aria-labelledby="welcome-title">
      <p class="eyebrow">CAMPUS FIELD NOTES / ${NIGHT_MODE ? 'NIGHT' : 'DAY'}</p>
      <p class="mode-choice">${NIGHT_MODE ? '月下校园 · 夜间探索' : '白昼校园 · 自由探索'} <a href="${modeLink.href}">切换${NIGHT_MODE ? '白昼' : '黑夜'}</a></p>
      ${NIGHT_MODE ? '<p class="night-intro">用手电照亮宝箱再搜索。F 开关手电，T 更换电池，G 放置照明弹。电量可连续使用约 3 分钟，每局有 2 节备用电池和 2 枚持续 30 秒的照明弹。移动鼠标转动视角，手电照向镜头前方。Esc 释放鼠标并暂停。</p>' : ''}
      ${NIGHT_MODE ? '<p class="night-intro">巡逻动物会追击，红圈提示攻击将至。左键或空格攻击镜头前方，长按 Q 安抚抱抱怪；攻击它或请求超时会触发变异。受伤会中断搜索和撤离，生命归零本局失败。</p><label class="weapon-choice">本局武器 <select id="starter-weapon"><option value="training-bat">训练棍 · 35伤害，可反复使用</option><option value="stun-baton">电击器 · 15伤害，眩晕，15次</option></select></label>' : ''}
      <h2 id="welcome-title">${IS_DISTRICT ? '从南门到明湖，<br/>走进这一片校园。' : IS_SIYUAN ? '走近思源楼，<br/>沿银杏大道漫游。' : '从南门出发，<br/>逛一小段校园。'}</h2>
      <p class="intro">${IS_DISTRICT ? '按你选取的区域重建思源楼一带、图书馆、教学楼、明湖和天佑会堂，以道路和庭园连成一片。<br/>可切换区域总览，沿途搜集四件物资，再回南门。建筑细部与尺寸为参考估算。' : IS_SIYUAN ? '左侧思源西楼，中间思源楼，右侧思源东楼，三栋楼之间可沿道路通行。西楼后方为信息中心，东楼后方为科学会堂（后方两栋待建）。<br/>找到四件物资，再回到楼前集合点。' : '穿过树影，沿着小路寻找宝箱。带上四件物资，再回到红色拱门。<br/>参考交大虚拟校园南门外观，按探索尺度重建。'}</p>
      <div class="rules-grid"><div><strong>8</strong><span>只宝箱</span></div><div><strong>100</strong><span>撤离价值</span></div><div><strong>5 秒</strong><span>${IS_SIYUAN ? '集合点撤离' : '南门撤离'}</span></div></div>
      <p class="instruction"><kbd>W A S D</kbd> / 方向键移动<br/>移动鼠标转向 · 滚轮缩放 · <kbd>R</kbd> 重置镜头<br/><kbd>E</kbd> 长按搜索，按下开始撤离<br/><kbd>B</kbd> 背包 <kbd>Esc</kbd> 暂停</p>
      <p class="risk">每局 10 分钟，背包 6 格。失败或局中刷新会失去本局物资。试验进度独立保存。</p>
      <label class="consent"><input id="consent" type="checkbox"/> 我已了解本局物资的损失规则</label>
      <button id="start" class="primary" disabled>正在准备校园…</button>
      <p id="loading" role="status">正在加载${AREA_NAME}样板、角色与宝箱</p>
      <p id="saved-summary" class="saved-summary"></p>
    </section>
    <div id="interaction" class="interaction" hidden><p id="prompt">寻找金色宝箱</p><progress id="interaction-progress" max="1" value="0" aria-label="交互进度" hidden></progress></div>
    <section id="night-kit" class="night-kit" aria-label="夜间照明装备" hidden>
      <div class="battery-status"><span id="flashlight-status">手电开启</span><strong id="battery-value">100%</strong></div>
      <progress id="battery-progress" max="100" value="100" aria-label="手电剩余电量"></progress>
      <div class="night-actions"><button id="flashlight-button" class="quiet">手电 <kbd>F</kbd></button><button id="battery-button" class="quiet">电池 <span id="spare-count">2</span> <kbd>T</kbd></button><button id="flare-button" class="quiet">照明弹 <span id="flare-count">2</span> <kbd>G</kbd></button></div>
      <p>手电随镜头朝向 · Esc 释放鼠标</p>
      <p class="combat-status"><span id="weapon-status">训练棍</span> · 左键／空格 攻击 · Q 抱抱</p>
    </section>
    <footer class="field-footer"><span><i class="status-dot"></i> ${AREA_NAME} · ${NIGHT_MODE ? '黑夜探索' : '白昼探索'}</span><span id="control-hint">WASD 移动 · 鼠标转向 · 滚轮缩放 · R 重置 · E 交互</span></footer>
    <p id="notice" class="notice" role="status" hidden></p>
    <div id="damage-overlay" class="damage-overlay" aria-hidden="true" hidden></div>
    <dialog id="bag-dialog" aria-labelledby="bag-title"><div class="dialog-heading"><div><p class="eyebrow">FIELD COLLECTION</p><h2 id="bag-title">本局背包</h2></div><button id="close-bag" class="quiet">返回探索</button></div><p>丢弃后物品会留在脚边，可以按 E 拾回。</p><ul id="bag-list" class="bag-list"></ul><p id="bag-empty">还没有找到物资，去看看金色宝箱。</p></dialog>
    <dialog id="pause-dialog" aria-labelledby="pause-title"><p class="eyebrow">TAKE A BREATH</p><h2 id="pause-title">探索已暂停</h2><p id="pause-reason">准备好后继续。</p><button id="resume" class="primary">继续探索</button><button id="abandon" class="text-button">结束本局并放弃物资</button><details><summary>显示设置与运行信息</summary><label class="volume">音量 <input id="volume" type="range" min="0" max="1" step="0.05"/></label><p id="metrics"></p></details></dialog>
    <dialog id="abandon-dialog" aria-labelledby="abandon-title"><h2 id="abandon-title">结束这次探索？</h2><p>本局物资将全部失去，已经保存的试验收藏不受影响。</p><button id="cancel-abandon" class="primary">继续留在校园</button><button id="confirm-abandon" class="text-button">确认放弃本局物资</button></dialog>
    <section id="result" class="result surface" aria-labelledby="result-title" hidden><p class="eyebrow">EXPLORATION REPORT</p><h2 id="result-title">本次探索结束</h2><p id="result-message"></p><div class="result-value"><span>本局价值</span><strong id="result-value">0</strong></div><p id="result-save"></p><button id="retry-save" class="primary" hidden>重试保存结算</button><button id="again" class="primary" hidden>再逛一次校园</button></section>
    <section id="fatal" class="fatal surface" role="alert" hidden><h2>校园暂时无法打开</h2><p id="fatal-message"></p><button id="reload" class="primary">重新加载</button></section>
  </main>`;

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

async function bootstrap(): Promise<void> {
  const abort = new AbortController();
  let releaseLock: (() => void) | null = null;
  let view: CampusView | undefined;
  let session: TrialSession | undefined;
  let controls: TrialControls | undefined;
  let sound: SoundManager | undefined;
  let animationId = 0;
  let disposed = false;
  let resourcesReady = false;
  let contextLost = false;
  let lastTime = performance.now();
  let lastUi = 0;
  let noticeUntil = 0;
  let bagSignature: string | null = null;
  const frameTimes: number[] = [];
  const options = { signal: abort.signal };
  const dialogs = ['bag-dialog', 'pause-dialog', 'abandon-dialog'].map((id) =>
    element<HTMLDialogElement>(id),
  );
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    cancelAnimationFrame(animationId);
    abort.abort();
    controls?.dispose();
    session?.dispose();
    sound?.dispose();
    view?.dispose();
    releaseLock?.();
  };
  const notify = (text: string) => {
    element('notice').textContent = text;
    element('notice').hidden = false;
    noticeUntil = performance.now() + 3600;
  };
  const clearInput = () => {
    controls?.clear();
    view?.stopCameraLook();
    session?.clearInteractions();
  };
  const playing = () => {
    const phase = session?.controller.getView().phase;
    return phase === 'active' || phase === 'extracting';
  };
  const pause = (dialogId: string, reason = '准备好后，继续寻找校园里的宝箱。') => {
    if (!playing()) {
      return;
    }
    session!.pause();
    controls?.releaseMouse();
    clearInput();
    sound?.setLoop('footsteps', false);
    dialogs.forEach((dialog) => dialog.close());
    if (dialogId === 'pause-dialog') {
      element('pause-reason').textContent = reason;
    }
    element<HTMLDialogElement>(dialogId).showModal();
  };
  const resume = () => {
    if (contextLost || document.hidden || !document.hasFocus()) {
      return;
    }
    dialogs.forEach((dialog) => dialog.close());
    clearInput();
    session?.controller.resume();
    view?.renderer.domElement.focus();
    if (view?.canOrbit()) controls?.captureMouse();
  };
  const shortcut = (key: string) => {
    if (!playing() || contextLost) {
      return;
    }
    const nightActions: Record<string, NightAction> = { f: 'flashlight', t: 'battery', g: 'flare' };
    if (nightActions[key]) {
      if (dialogs.some((dialog) => dialog.open)) return;
      const message = session?.nightAction(nightActions[key]);
      if (message) notify(message);
      return;
    }
    if (dialogs.some((dialog) => dialog.open)) {
      resume();
    } else {
      pause(key === 'b' ? 'bag-dialog' : 'pause-dialog');
    }
  };
  for (const dialog of dialogs) {
    dialog.addEventListener(
      'cancel',
      (event) => {
        event.preventDefault();
        resume();
      },
      options,
    );
  }
  element('reload').addEventListener('click', () => location.reload(), options);
  for (const [id, key] of [
    ['flashlight-button', 'f'],
    ['battery-button', 't'],
    ['flare-button', 'g'],
  ]) {
    element(id!).addEventListener(
      'click',
      () => {
        shortcut(key!);
        view?.renderer.domElement.focus();
      },
      options,
    );
  }
  element('overview-button')?.addEventListener(
    'click',
    () => {
      if (!view) return;
      const overview = view.toggleOverview();
      if (overview) controls?.releaseMouse();
      else if (playing() && !session!.controller.isPaused()) controls?.captureMouse();
      clearInput();
      element('overview-button').textContent = overview ? '返回人物' : '区域总览';
      element('overview-button').setAttribute('aria-pressed', String(overview));
      view.renderer.domElement.focus();
    },
    options,
  );
  element('bag-button').addEventListener('click', () => shortcut('b'), options);
  element('pause-button').addEventListener('click', () => shortcut('escape'), options);
  element('close-bag').addEventListener('click', resume, options);
  element('resume').addEventListener('click', resume, options);
  element('abandon').addEventListener('click', () => pause('abandon-dialog'), options);
  element('cancel-abandon').addEventListener('click', () => pause('pause-dialog'), options);
  element('confirm-abandon').addEventListener(
    'click',
    () => {
      dialogs.forEach((dialog) => dialog.close());
      session!.controller.resume();
      session!.controller.abandon();
      clearInput();
    },
    options,
  );
  window.addEventListener(
    'blur',
    () => {
      clearInput();
      if (!contextLost) {
        pause('pause-dialog', '窗口已失去焦点，探索与搜索已经暂停。');
      }
    },
    options,
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) {
        clearInput();
        pause('pause-dialog', '页面已切到后台，准备好后再继续。');
      }
    },
    options,
  );
  window.addEventListener(
    'pagehide',
    (event) => {
      if (event.persisted) {
        // A restored page must reacquire the save lock and rebuild its disposed WebGL view.
        window.addEventListener('pageshow', () => location.reload(), { once: true });
      }
      dispose();
    },
    options,
  );
  if (import.meta.hot) {
    import.meta.hot.dispose(dispose);
  }

  try {
    releaseLock = await acquireSaveLock(TRIAL_LOCK);
    if (disposed) {
      releaseLock?.();
      return;
    }
    if (!releaseLock) {
      throw new Error(
        '另一个三维试验页面正在使用存档。请关闭该页面后重新加载；原游戏可以同时打开。',
      );
    }
    sound = new SoundManager(TRIAL_AUDIO_KEY);
    sound.setMusic(false);
    session = new TrialSession(
      localStorage,
      Date.now,
      () => crypto.randomUUID(),
      (name) => sound!.play(name),
      TRIAL_MAP,
      NIGHT_MODE,
    );
    if (session.save.recoverInterrupted()) {
      notify('上次探索已中断，本局物资已按失败处理。已保存收藏不受影响。');
    }
    view = new CampusView(element('world'), NIGHT_MODE, {
      area: IS_DISTRICT ? 'district' : IS_SIYUAN ? 'siyuan' : 'south-gate',
      name: AREA_NAME,
      modelUrl: MODEL_URL,
      map: TRIAL_MAP,
      trees: TREES,
      roads: MAP_ROADS,
    });
    controls = new TrialControls(
      view.renderer.domElement,
      (x, y) => view!.groundPoint(x, y),
      shortcut,
      {
        enabled: () =>
          !contextLost && playing() && !session!.controller.isPaused() && view!.canOrbit(),
        orbit: (dx, dy) => view!.orbitCamera(dx, dy),
        zoom: (delta) => view!.zoomCamera(delta),
        reset: () => view!.resetCamera(),
        move: (point) => view!.movementDirection(point),
        aim: () => view!.cameraAim(),
        unlocked: () => pause('pause-dialog', '鼠标已释放，点击继续探索后恢复鼠标转向。'),
      },
    );
    view.renderer.domElement.addEventListener(
      'webglcontextlost',
      (event) => {
        event.preventDefault();
        contextLost = true;
        clearInput();
        pause('pause-dialog', '画面连接暂时中断，探索已暂停，正在等待恢复。');
        element<HTMLButtonElement>('resume').disabled = true;
        element<HTMLButtonElement>('start').disabled = true;
        if (!playing()) {
          element('loading').textContent = '画面连接中断，正在等待恢复。';
        }
      },
      options,
    );
    view.renderer.domElement.addEventListener(
      'webglcontextrestored',
      () => {
        contextLost = false;
        view!.restore();
        element<HTMLButtonElement>('resume').disabled = false;
        element<HTMLButtonElement>('start').disabled =
          !resourcesReady || !element<HTMLInputElement>('consent').checked;
        element('pause-reason').textContent = '画面已恢复，可以继续探索。';
        element('loading').textContent = '校园已准备好 · 推荐使用电脑键鼠探索';
        notify('画面已恢复，确认后继续。');
      },
      options,
    );
    const volume = element<HTMLInputElement>('volume');
    volume.value = String(sound.getSettings().volume);
    volume.addEventListener(
      'input',
      () => sound!.setSettings({ volume: Number(volume.value) }),
      options,
    );
    const consent = element<HTMLInputElement>('consent');
    const start = element<HTMLButtonElement>('start');
    consent.addEventListener(
      'change',
      () => {
        start.disabled = !resourcesReady || !consent.checked || contextLost;
      },
      options,
    );
    start.addEventListener(
      'click',
      () => {
        if (!resourcesReady || contextLost || !consent.checked) {
          return;
        }
        sound!.unlock();
        if (view!.canOrbit()) controls?.captureMouse();
        start.disabled = true;
        const weapon = NIGHT_MODE
          ? (element<HTMLSelectElement>('starter-weapon').value as CombatWeaponId)
          : undefined;
        void session!.start(weapon).then((result) => {
          if (disposed) {
            return;
          }
          if (!result.ok) {
            controls?.releaseMouse();
            notify('未能写入开局存档，请检查浏览器存储后重试。');
          }
          clearInput();
          if (result.ok && (document.hidden || !document.hasFocus())) {
            pause('pause-dialog', '探索已经准备好，返回页面后继续。');
          }
          start.disabled = !consent.checked || contextLost;
          view!.renderer.domElement.focus();
          renderUi();
        });
      },
      options,
    );
    element('again').addEventListener(
      'click',
      () => {
        if (session!.prepareNext()) {
          clearInput();
          bagSignature = null;
          renderUi();
        }
      },
      options,
    );
    element('retry-save').addEventListener(
      'click',
      () => {
        void session!.controller.retrySettlement();
      },
      options,
    );
    element('bag-list').addEventListener(
      'click',
      (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
          'button[data-drop]',
        );
        if (button?.dataset.drop && session!.drop(button.dataset.drop)) {
          bagSignature = null;
          renderUi();
        }
      },
      options,
    );

    function renderUi(): void {
      const current = session!.controller.getView();
      const frame = session!.frame();
      const active = current.phase === 'active' || current.phase === 'extracting';
      const settled =
        current.phase === 'settling' || current.phase === 'success' || current.phase === 'failed';
      element('welcome').hidden = current.phase !== 'preparing';
      element('hud').hidden = !active;
      element('night-kit').hidden = !active || !NIGHT_MODE;
      const night = frame.night;
      if (NIGHT_MODE) {
        element('health').textContent = String(current.health);
        element<HTMLProgressElement>('health-progress').value = current.health;
        element('health-progress').classList.toggle('low-health', current.health <= 30);
        const weapon = ITEM_DEFINITIONS[frame.combat.weapon]?.name ?? '未装备武器';
        element('weapon-status').textContent =
          `${weapon}${frame.combat.uses === null ? '' : ` · 余 ${frame.combat.uses} 次`}${frame.combat.cooldown > 0 ? ' · 冷却中' : ''}`;
        element('damage-overlay').hidden = frame.action !== 'hurt' || !active;
      }
      element('flashlight-status').textContent = night.flashlight
        ? '手电开启'
        : night.battery <= 0
          ? '电量耗尽 · 按 T 换电池'
          : '手电关闭 · 按 F 开启';
      element('battery-value').textContent = `${Math.ceil(night.battery)}%`;
      element<HTMLProgressElement>('battery-progress').value = night.battery;
      element('spare-count').textContent = String(night.spareBatteries);
      element('flare-count').textContent = String(night.flareCount);
      element('flashlight-button').setAttribute('aria-pressed', String(night.flashlight));
      const paused = session!.controller.isPaused();
      element<HTMLButtonElement>('flashlight-button').disabled = paused || night.battery <= 0;
      element<HTMLButtonElement>('battery-button').disabled =
        paused || night.spareBatteries === 0 || night.battery >= 100;
      element<HTMLButtonElement>('flare-button').disabled = paused || night.flareCount === 0;
      element('interaction').hidden = !active || session!.controller.isPaused();
      element('result').hidden = !settled;
      element<HTMLButtonElement>('bag-button').disabled = !active;
      element<HTMLButtonElement>('pause-button').disabled = !active;
      element('value').textContent = String(current.value);
      element<HTMLProgressElement>('value-progress').value = current.value;
      const seconds = Math.ceil(current.remainingMs / 1000);
      element('time').textContent =
        `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      const items = session!.inventory.getCarriedItems();
      element('bag-count').textContent =
        `背包 ${frame.combat.bagCount} / ${RAID_RULES.bagCapacity}`;
      element('prompt').textContent = frame.prompt;
      const progress = element<HTMLProgressElement>('interaction-progress');
      progress.value =
        current.phase === 'extracting' ? current.extractionProgress : frame.searchProgress;
      progress.hidden = progress.value === 0;
      const signature = items.map((item) => item.instanceId).join('|');
      if (signature !== bagSignature) {
        bagSignature = signature;
        element('bag-list').replaceChildren(
          ...items.map((item) => {
            const li = document.createElement('li');
            const name = document.createElement('span');
            const definition = ITEM_DEFINITIONS[item.itemId]!;
            const equipped = Object.values(session!.inventory.getEquipment()).some(
              (p) => p.instanceId === item.instanceId,
            );
            name.textContent = `${definition.name} · ${equipped ? '已装备，不占背包格' : item.origin.kind === 'carry-in' ? '带入物，不计撤离价值' : `${RAID_RULES.values[definition.rarity]} 价值`}`;
            const button = document.createElement('button');
            button.textContent = '丢弃';
            button.dataset.drop = item.instanceId;
            button.className = 'quiet';
            li.append(name, button);
            return li;
          }),
        );
      }
      element('bag-empty').hidden = items.length > 0;
      const player = document.getElementById('map-player')!;
      player.setAttribute('cx', String(frame.position.x));
      player.setAttribute('cy', String(frame.position.y));
      for (const chest of TRIAL_MAP.chests) {
        document.getElementById(`map-${chest.id}`)!.style.display = frame.visibleChests.includes(
          chest.id,
        )
          ? ''
          : 'none';
        document
          .getElementById(`map-${chest.id}`)!
          .setAttribute('opacity', frame.opened.includes(chest.id) ? '0.2' : '1');
      }
      if (current.phase === 'preparing' || settled) {
        const saved = session!.save.view();
        const summary = `试验收藏 ${saved.warehouse.length} 件 · 交子 ${saved.currency} · 已完成 ${saved.settledRaidIds.length} 次探索`;
        element('saved-summary').textContent = summary;
        element('result-save').textContent = current.saveError
          ? '保存失败，本局结算仍保留。请重试保存。'
          : current.phase === 'settling'
            ? '正在保存本次探索…'
            : `已保存到独立试验存档。${summary}`;
      }
      if (settled) {
        controls?.releaseMouse();
        dialogs.forEach((dialog) => dialog.close());
        const successful = current.result?.outcome === 'success';
        element('result-title').textContent = successful
          ? `带着收获，回到${EXTRACTION_NAME}。`
          : '这次探索，暂告一段落。';
        element('result-message').textContent = successful
          ? '物资已经带回。重复收藏会按现有规则兑换为交子。'
          : current.result?.reason === 'death'
            ? '生命归零，本局携带物资已失去。'
            : current.result?.reason === 'timeout'
              ? '探索时间已结束，本局物资没有带回。'
              : '本局物资已失去，已保存的试验收藏保持不变。';
        element('result-value').textContent = String(current.result?.value ?? current.value);
        element('again').hidden = current.phase === 'settling';
        element('retry-save').hidden = !current.saveError;
        element<HTMLButtonElement>('retry-save').disabled = current.isBusy;
      }
      if (performance.now() > noticeUntil) {
        element('notice').hidden = true;
      }
    }

    const animate = (now: number) => {
      if (disposed) {
        return;
      }
      const delta = Math.max(0, now - lastTime);
      lastTime = now;
      if (delta < 1000) {
        frameTimes.push(delta);
        if (frameTimes.length > 240) {
          frameTimes.shift();
        }
      }
      session!.update(delta, resourcesReady && !contextLost ? controls!.read() : EMPTY_INPUT);
      const frame = session!.frame();
      sound!.setLoop('footsteps', frame.moving && !session!.controller.isPaused());
      if (!contextLost) {
        view!.render(frame, now, delta);
      }
      if (now - lastUi > 80) {
        renderUi();
        const mean =
          frameTimes.reduce((sum, time) => sum + time, 0) / Math.max(1, frameTimes.length);
        const sorted = [...frameTimes].sort((a, b) => a - b);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        const info = view!.renderer.info;
        element('metrics').textContent =
          `${(1000 / Math.max(1, mean)).toFixed(0)} FPS · 平均 ${mean.toFixed(1)} ms · P95 ${p95.toFixed(1)} ms · ${info.render.calls} 次绘制 · ${info.memory.geometries} 个几何体 / ${info.memory.textures} 张纹理。${view!.cameraInfo()}`;
        lastUi = now;
      }
      animationId = requestAnimationFrame(animate);
    };
    animationId = requestAnimationFrame(animate);
    await view.init();
    if (disposed) {
      return;
    }
    resourcesReady = true;
    start.textContent = '开始这次漫游　→';
    start.disabled = !consent.checked || contextLost;
    element('loading').textContent = '校园已准备好 · 推荐使用电脑键鼠探索';
    renderUi();
  } catch (error) {
    dispose();
    element('welcome').hidden = true;
    element('fatal').hidden = false;
    element('fatal-message').textContent =
      error instanceof Error ? error.message : '加载失败，请重新打开页面。';
    // The startup abort controller has been released; this recovery button owns a new handler.
    element('reload').onclick = () => location.reload();
    console.error('Campus 3D startup failed', error);
  }
}

void bootstrap();
