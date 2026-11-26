/** 跨面板拖拽验收：仓库格拖到随身背包=带入，再拖回仓库=放回（2026-11-26） */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const baseUrl = process.env.PROBE_BASE_URL ?? 'http://localhost:5199';
const directory = resolve(`artifacts/wh-cross-drag-${Date.now()}`);
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
    '--window-size=1800,1000',
    '--force-device-scale-factor=1',
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
async function shot(name) {
  const reply = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, name), Buffer.from(reply.data, 'base64'));
}
/** 用合成 PointerEvent 沿折线拖拽（>6px 触发阈值） */
async function drag(fromSel, toSel) {
  await evaluate(`(() => {
    const from = document.querySelector(${JSON.stringify(fromSel)});
    const to = document.querySelector(${JSON.stringify(toSel)});
    if (!from || !to) throw new Error('drag target missing');
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    window.__dragPath = {
      x0: a.x + a.width / 2, y0: a.y + a.height / 2,
      x1: b.x + b.width / 2, y1: b.y + b.height / 2,
    };
  })()`);
  const { x0, y0, x1, y1 } = await evaluate(`window.__dragPath`);
  const steps = 12;
  await evaluate(`(() => {
    const from = document.querySelector(${JSON.stringify(fromSel)});
    from.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, button: 0, pointerId: 7, clientX: ${x0}, clientY: ${y0},
    }));
  })()`);
  let ghostSeen = false;
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    await evaluate(`window.dispatchEvent(new PointerEvent('pointermove', {
      bubbles: true, pointerId: 7, clientX: ${x}, clientY: ${y},
    }));`);
    if (i === 5) ghostSeen = await evaluate(`!!document.querySelector('.wh-ghost')`);
    await delay(30);
  }
  console.log('  ghost during drag:', ghostSeen);
  await evaluate(`window.dispatchEvent(new PointerEvent('pointerup', {
    bubbles: true, pointerId: 7, clientX: ${x1}, clientY: ${y1},
  }));`);
  const hit = await evaluate(`(() => {
    const el = document.elementFromPoint(${x1}, ${y1});
    return {
      tag: el?.tagName, cls: String(el?.className ?? '').slice(0, 40),
      whItem: el?.closest?.('[data-wh-slot]')?.dataset?.item ?? null,
      inWhPanel: !!el?.closest?.('.wh-panel'),
      bpInstance: el?.closest?.('[data-bp-instance]')?.dataset?.bpInstance ?? null,
    };
  })()`);
  console.log('  drop point hit:', JSON.stringify(hit));
  await delay(400);
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
    width: 1800,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command('Page.navigate', { url: `${baseUrl}/local-game.html` });
  await delay(3500);
  for (let i = 0; i < 12; i++) {
    const done = await evaluate(
      `(() => { const skip = document.querySelector('#prologue-skip'); const p = document.querySelector('#prologue'); if (!skip || !p || p.hidden) return true; skip.click(); return false; })()`,
    );
    if (done) break;
    await delay(400);
  }
  await delay(600);
  let ready = false;
  for (let i = 0; i < 80; i++) {
    ready = await evaluate(`!!document.querySelector('#v19-loadout-open')`);
    if (ready) break;
    await delay(500);
  }
  if (!ready) throw new Error('v19-loadout-open 未出现');
  await evaluate(`document.querySelector('#v19-loadout-open').click()`);
  await delay(1000);

  const before = await evaluate(`(() => ({
    bagCarried: [...document.querySelectorAll('[data-bp-bag-grid] [data-bp-instance]')]
      .filter((s) => s.dataset.bpInstance && s.dataset.empty === 'false').length,
    load: document.querySelector('[data-bp-load]')?.textContent,
    whFilled: document.querySelectorAll('.wh-slot[data-empty="false"]').length,
    capacity: document.querySelector('[data-wh-capacity]')?.textContent,
  }))()`);
  console.log('before:', JSON.stringify(before));

  // 1) 仓库第一件有物品的格子 → 背包第二格（空格 disabled，拖到格子区坐标即可）
  const firstWhItem = `.wh-slot[data-empty='false']`;
  await drag(firstWhItem, '[data-bp-bag-grid] [data-bp-instance]:nth-child(2)');
  const afterCarry = await evaluate(`(() => ({
    bagCarried: [...document.querySelectorAll('[data-bp-bag-grid] [data-bp-instance]')]
      .filter((s) => s.dataset.bpInstance && s.dataset.empty === 'false').length,
    load: document.querySelector('[data-bp-load]')?.textContent,
    whFilled: document.querySelectorAll('.wh-slot[data-empty="false"]').length,
    capacity: document.querySelector('[data-wh-capacity]')?.textContent,
    carriedBadge: !!document.querySelector('.wh-slot[data-carry]'),
  }))()`);
  console.log('after carry:', JSON.stringify(afterCarry));
  await shot('after-carry.png');

  // 2) 背包第一件 → 仓库可视滚动区（.wh-grid 20 行高，中心在视口外，必须用可视容器）
  await drag('[data-bp-bag-grid] [data-bp-instance][data-empty="false"]', '.wh-panel .wh-scroll');
  const afterUncarry = await evaluate(`(() => ({
    bagCarried: [...document.querySelectorAll('[data-bp-bag-grid] [data-bp-instance]')]
      .filter((s) => s.dataset.bpInstance && s.dataset.empty === 'false').length,
    load: document.querySelector('[data-bp-load]')?.textContent,
    whFilled: document.querySelectorAll('.wh-slot[data-empty="false"]').length,
    capacity: document.querySelector('[data-wh-capacity]')?.textContent,
  }))()`);
  console.log('after uncarry:', JSON.stringify(afterUncarry));
  await shot('after-uncarry.png');

  const pass =
    before.bagCarried === 0 &&
    afterCarry.bagCarried === 1 &&
    afterUncarry.bagCarried === 0 &&
    before.load === '0' &&
    afterCarry.load !== '0' &&
    afterUncarry.load === '0' &&
    // 带入后仓库格子少一件（原位空出来），放回后复原
    afterCarry.whFilled === before.whFilled - 1 &&
    afterUncarry.whFilled === before.whFilled &&
    afterCarry.capacity === String(Number(before.capacity) - 1) &&
    afterUncarry.capacity === before.capacity &&
    !afterCarry.carriedBadge;
  console.log(pass ? 'PASS' : 'FAIL');
} finally {
  browser.kill();
}
