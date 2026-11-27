/** 截图仓库面板（本地试玩模式，无需后端） */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve(`artifacts/warehouse-ui-${Date.now()}`);
await mkdir(directory, { recursive: true });

const executable = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((path) => path && existsSync(path));
if (!executable) throw new Error('chrome not found');

const browser = spawn(
  executable,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--window-size=1600,1000',
    `--user-data-dir=${join(directory, 'profile')}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);

let socket;
const pending = new Map();
let nextId = 0;
let sessionId;
function command(method, params = {}, session = sessionId) {
  const id = ++nextId;
  return new Promise((done, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, 20000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
  });
}
async function evaluate(expression) {
  const reply = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}
async function shot(name, clip) {
  await evaluate('Promise.all(Array.from(document.images).map(i => i.decode().catch(() => {})))');
  const params = { format: 'png' };
  if (clip) params.clip = { ...clip, scale: 1 };
  const reply = await command('Page.captureScreenshot', params);
  await writeFile(join(directory, `${name}.png`), Buffer.from(reply.data, 'base64'));
  console.log('saved', name);
}

try {
  let port;
  for (let i = 0; i < 150; i++) {
    try {
      port = (await readFile(join(directory, 'profile/DevToolsActivePort'), 'utf8')).split('\n')[0];
      break;
    } catch {
      await delay(100);
    }
  }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((done) => socket.addEventListener('open', done, { once: true }));
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { done, reject, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else done(message.result);
    }
  });
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  sessionId = (await command('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command('Page.navigate', { url: 'http://127.0.0.1:5173/local-game.html' });
  await delay(3500);

  // 跳过序章
  for (let i = 0; i < 12; i++) {
    const done = await evaluate(
      `(() => { const skip = document.querySelector('#prologue-skip'); const p = document.querySelector('#prologue'); if (!skip || !p || p.hidden) return true; skip.click(); return false; })()`,
    );
    if (done) break;
    await delay(400);
  }
  await delay(800);
  await shot('01-lobby', { x: 0, y: 0, width: 1600, height: 1000 });

  const opened = await evaluate(
    `(() => { const b = document.querySelector('#v19-loadout-open'); if (!b) return 'no-button'; b.click(); return 'ok'; })()`,
  );
  console.log('open dialog:', opened);
  await delay(900);
  const box = await evaluate(
    `(() => { const d = document.querySelector('#v19-loadout-dialog'); const r = d.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, open: d.open, bg: getComputedStyle(d.querySelector('.wh-panel')).backgroundImage }; })()`,
  );
  console.log('dialog box:', JSON.stringify(box));
  const rects = await evaluate(
    `(() => {
      const panel = document.querySelector('.wh-panel').getBoundingClientRect();
      const pick = (sel) => {
        const node = document.querySelector(sel);
        if (!node) return null;
        const r = node.getBoundingClientRect();
        return { x: +(r.x - panel.x).toFixed(1), y: +(r.y - panel.y).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
      };
      return { panel: { w: +panel.width.toFixed(1), h: +panel.height.toFixed(1) },
        capacity: pick('[data-wh-capacity]'), value: pick('[data-wh-value]'),
        sort: pick('[data-wh-sort]'), tab1: pick('[data-wh-filter="all"]') };
    })()`,
  );
  console.log('rects:', JSON.stringify(rects));
  const cs = await evaluate(
    `(() => {
      const s = document.querySelector('[data-wh-scroll]');
      const c = getComputedStyle(s);
      const g = getComputedStyle(document.querySelector('[data-wh-grid]'));
      const sl = getComputedStyle(document.querySelector('[data-wh-slot]'));
      const p = getComputedStyle(document.querySelector('.wh-panel'));
      return { pos: c.position, top: c.top, h: c.height, w: c.width, ovf: c.overflowY,
        cols: g.gridTemplateColumns, gap: g.gap, slotH: sl.height, slotW: sl.width,
        panelPos: p.position, panelH: p.height, ct: p.containerType };
    })()`,
  );
  console.log('computed:', JSON.stringify(cs));
  await shot('02-dialog-full', { x: 0, y: 0, width: 1600, height: 1000 });
  if (box.open) {
    await shot('03-panel', {
      x: Math.max(0, box.x - 10),
      y: Math.max(0, box.y - 60),
      width: Math.min(1600, box.w + 20),
      height: Math.min(1000, box.h + 80),
    });
    for (const [filter, name] of [
      ['props', '04-props'],
      ['collection', '05-collection'],
      ['all', '06-all'],
    ]) {
      await evaluate(`document.querySelector('[data-wh-filter="${filter}"]').click()`);
      await delay(400);
      await shot(name, {
        x: Math.max(0, box.x - 10),
        y: Math.max(0, box.y - 60),
        width: Math.min(1600, box.w + 20),
        height: Math.min(1000, box.h + 80),
      });
    }
    const errors = await evaluate('window.__errors ?? []');
    console.log('page errors:', JSON.stringify(errors));
    // 滚动检查：16 件物品会铺到 20 格（4 行），超出一屏应可滚
    const scrollClip = {
      x: Math.max(0, box.x - 10),
      y: Math.max(0, box.y - 60),
      width: Math.min(1600, box.w + 20),
      height: Math.min(1000, box.h + 80),
    };
    const info = await evaluate(
      `(() => { const s = document.querySelector('[data-wh-scroll]'); return { sh: s.scrollHeight, ch: s.clientHeight, st: s.scrollTop, slots: document.querySelectorAll('[data-wh-slot]').length, scrollable: document.querySelector('.wh-panel').dataset.scrollable, barH: document.querySelector('[data-wh-bar] i')?.style.height }; })()`,
    );
    console.log('scroll:', JSON.stringify(info));
    await shot('07-scroll-top', scrollClip);
    await evaluate(
      `(() => { const s = document.querySelector('[data-wh-scroll]'); s.scrollTop = s.scrollHeight; })()`,
    );
    await delay(300);
    const after = await evaluate(
      `(() => { const s = document.querySelector('[data-wh-scroll]'); return { st: s.scrollTop, barH: document.querySelector('[data-wh-bar] i')?.style.height, barT: document.querySelector('[data-wh-bar] i')?.style.transform }; })()`,
    );
    console.log('scroll after:', JSON.stringify(after));
    await shot('08-scroll-bottom', scrollClip);

    // 详情：点第一个非空格子
    await evaluate(
      `(() => { const s = document.querySelector('[data-wh-scroll]'); s.scrollTop = 0; })()`,
    );
    await delay(250);
    await evaluate(`document.querySelectorAll('[data-wh-slot][data-item]')[0].click()`);
    await delay(400);
    const detail = await evaluate(
      `(() => { const l = document.querySelector('[data-wh-detail]');
        return { hidden: l.hidden,
          name: l.querySelector('[data-wh-detail-name]').textContent,
          meta: l.querySelector('[data-wh-detail-meta]').textContent,
          value: l.querySelector('[data-wh-detail-value]').textContent,
          count: l.querySelector('[data-wh-detail-count]').textContent,
          desc: l.querySelector('[data-wh-detail-desc]').textContent.slice(0, 30) }; })()`,
    );
    console.log('detail:', JSON.stringify(detail));
    await shot('09-detail', scrollClip);
    await evaluate(`document.querySelector('[data-wh-detail-close]').click()`);
    await delay(250);

    // 拖拽互换：第 1 格 → 第 3 格
    const before = await evaluate(
      `Array.from(document.querySelectorAll('[data-wh-slot][data-item]')).map((s) => s.dataset.item)`,
    );
    const points = await evaluate(
      `(() => { const all = document.querySelectorAll('[data-wh-slot][data-item]');
        const a = all[0].getBoundingClientRect(); const b = all[2].getBoundingClientRect();
        return { ax: Math.round(a.x + a.width / 2), ay: Math.round(a.y + a.height / 2),
          bx: Math.round(b.x + b.width / 2), by: Math.round(b.y + b.height / 2) }; })()`,
    );
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: points.ax,
      y: points.ay,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    for (let i = 1; i <= 8; i += 1) {
      await command('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(points.ax + ((points.bx - points.ax) * i) / 8),
        y: Math.round(points.ay + ((points.by - points.ay) * i) / 8),
        button: 'left',
        buttons: 1,
      });
      await delay(25);
    }
    // 停在目标格正中，确认高亮
    await command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: points.bx,
      y: points.by,
      button: 'left',
      buttons: 1,
    });
    await delay(120);
    const g = await evaluate(
      `(() => { const el = document.querySelector('.wh-ghost'); if (!el) return 'none';
        const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
        const drop = document.querySelector('[data-drop]');
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
          pos: cs.position, z: cs.zIndex, dropItem: drop?.dataset.item ?? null,
          dropLeft: drop ? Math.round(drop.getBoundingClientRect().x) : null,
          pointer: [${points.bx}, ${points.by}] }; })()`,
    );
    console.log('ghost:', JSON.stringify(g));
    await shot('11-dragging', scrollClip);
    const ghosted = await evaluate(`!!document.querySelector('.wh-ghost')`);
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: points.bx,
      y: points.by,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await delay(600);
    const afterDrag = await evaluate(
      `Array.from(document.querySelectorAll('[data-wh-slot][data-item]')).map((s) => s.dataset.item)`,
    );
    console.log('drag ghost appeared:', ghosted);
    console.log('order before:', JSON.stringify(before.slice(0, 4)));
    console.log('order after :', JSON.stringify(afterDrag.slice(0, 4)));
    console.log(
      'detail after drag (should stay hidden):',
      await evaluate(`document.querySelector('[data-wh-detail]').hidden`),
    );
    await shot('10-after-drag', scrollClip);

    // 带入装备：同一物品有两件，先带一件、再带一件，看角标从「带」变「带2」
    await evaluate(`document.querySelector('[data-wh-slot][data-item="bandage"]').click()`);
    await delay(350);
    const carryBefore = await evaluate(
      `(() => { const b = document.querySelector('[data-wh-carry]');
        return { text: b.textContent, disabled: b.disabled,
          note: document.querySelector('[data-wh-carry-note]').textContent,
          slots: document.querySelector('#loadout-slots').textContent }; })()`,
    );
    console.log('carry before:', JSON.stringify(carryBefore));
    await evaluate(`document.querySelector('[data-wh-carry]').click()`);
    await delay(350);
    const carryOne = await evaluate(
      `(() => { const b = document.querySelector('[data-wh-carry]');
        return { text: b.textContent, disabled: b.disabled,
          note: document.querySelector('[data-wh-carry-note]').textContent,
          tag: document.querySelector('[data-wh-slot][data-item="bandage"] .wh-slot-carry')?.textContent }; })()`,
    );
    console.log('carry 1:', JSON.stringify(carryOne));
    await shot('12a-carry-one', scrollClip);
    await evaluate(`document.querySelector('[data-wh-carry]').click()`);
    await delay(350);
    const carryAfter = await evaluate(
      `(() => { const b = document.querySelector('[data-wh-carry]');
        const marked = Array.from(document.querySelectorAll('[data-wh-slot][data-carry="true"]'))
          .map((s) => ({ item: s.dataset.item, tag: s.querySelector('.wh-slot-carry')?.textContent }));
        return { text: b.textContent, disabled: b.disabled,
          note: document.querySelector('[data-wh-carry-note]').textContent,
          slots: document.querySelector('#loadout-slots').textContent,
          checked: document.querySelectorAll('#loadout input:checked').length,
          clearVisible: !document.querySelector('[data-wh-uncarry]').hidden,
          marked }; })()`,
    );
    console.log('carry after:', JSON.stringify(carryAfter));
    await shot('12-carry-detail', scrollClip);
    await evaluate(`document.querySelector('[data-wh-detail-close]').click()`);
    await delay(250);
    await shot('13-carry-mark', scrollClip);

    // 行前准备子弹窗：旧那套仍在，且状态是同一份
    await evaluate(`document.querySelector('#v19-prepare-dialog').showModal()`);
    await delay(500);
    const prep = await evaluate(
      `(() => { const d = document.querySelector('#v19-prepare-dialog');
        const r = d.getBoundingClientRect();
        return { open: d.open, w: Math.round(r.width), h: Math.round(r.height), y: Math.round(r.y),
          checked: Array.from(d.querySelectorAll('#loadout input:checked')).map((i) => i.dataset.itemId),
          slots: d.querySelector('#loadout-slots').textContent,
          weapon: d.querySelector('#starter-weapon').value }; })()`,
    );
    console.log('prepare dialog:', JSON.stringify(prep));
    await shot('14-prepare-dialog', { x: 0, y: 0, width: 1600, height: 1000 });
    // 在旧列表里取消一件，仓库面板角标应从「带2」回到「带」
    await evaluate(`document.querySelector('#loadout input:checked')?.click()`);
    await delay(350);
    const afterUncheck = await evaluate(
      `(() => ({ slots: document.querySelector('#loadout-slots').textContent,
        checked: document.querySelectorAll('#loadout input:checked').length }))()`,
    );
    console.log('uncheck one in prepare:', JSON.stringify(afterUncheck));
    await evaluate(`document.querySelector('#v19-prepare-dialog').close()`);
    await delay(300);
    console.log(
      'bandage tag after uncheck:',
      await evaluate(
        `document.querySelector('[data-wh-slot][data-item="bandage"] .wh-slot-carry')?.textContent ?? null`,
      ),
    );
  }
} catch (error) {
  console.error('FAILED', error);
  process.exitCode = 1;
} finally {
  try {
    socket?.close();
  } catch {
    /* 浏览器已退出时忽略 */
  }
  browser.kill();
  console.log('out:', directory);
}
