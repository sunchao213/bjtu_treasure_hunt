/** 量仓库格子在面板内的落点，和 text-gen/cells/cells.json 的原图坐标逐格对比 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve(`artifacts/grid-${Date.now()}`);
await mkdir(directory, { recursive: true });

const executable = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((path) => path && existsSync(path));
if (!executable) throw new Error('chrome not found');

const viewW = Number(process.env.VIEW_W ?? 1280);
const viewH = Number(process.env.VIEW_H ?? 720);

const browser = spawn(
  executable,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--window-size=${viewW},${viewH}`,
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
  await writeFile(join(directory, `${name}.png`), Buffer.from(reply.data, 'base64'));
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
    width: viewW,
    height: viewH,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command('Page.navigate', { url: 'http://127.0.0.1:5173/local-game.html' });
  await delay(3500);
  for (let i = 0; i < 12; i++) {
    const done = await evaluate(
      `(() => { const skip = document.querySelector('#prologue-skip'); const p = document.querySelector('#prologue'); if (!skip || !p || p.hidden) return true; skip.click(); return false; })()`,
    );
    if (done) break;
    await delay(400);
  }
  await evaluate(`document.querySelector('#v19-loadout-open').click()`);
  await delay(900);
  await shot('grid');

  const measured = await evaluate(
    `(() => {
      const panel = document.querySelector('#warehouse-panel .wh-panel');
      const pr = panel.getBoundingClientRect();
      const scale = pr.width / 790;
      const rel = (el) => {
        const r = el.getBoundingClientRect();
        return {
          x: +((r.left - pr.left) / scale).toFixed(1),
          y: +((r.top - pr.top) / scale).toFixed(1),
          w: +(r.width / scale).toFixed(1),
          h: +(r.height / scale).toFixed(1),
        };
      };
      const slots = [...panel.querySelectorAll('.wh-slot')].slice(0, 15);
      const scroll = panel.querySelector('[data-wh-scroll]');
      const bar = panel.querySelector('[data-wh-bar]');
      const grid = panel.querySelector('[data-wh-grid]');
      return {
        scale: +scale.toFixed(4),
        panel: { w: +pr.width.toFixed(1), h: +pr.height.toFixed(1) },
        scroll: rel(scroll),
        grid: rel(grid),
        bar: bar ? rel(bar) : null,
        barVisible: panel.dataset.scrollable,
        empty: panel.querySelectorAll('.wh-slot[data-empty="true"]').length,
        emptyBg: (() => {
          const s = panel.querySelector('.wh-slot[data-empty="true"]');
          return s ? getComputedStyle(s).backgroundImage : null;
        })(),
        slots: slots.map(rel),
      };
    })()`,
  );

  // 滚到底，确认空格子有木色底图（v4/slot.png 曾缺文件，只回 index.html）
  await evaluate(
    `(() => { const s = document.querySelector('#warehouse-panel [data-wh-scroll]'); s.scrollTop = s.scrollHeight; })()`,
  );
  await delay(500);
  await shot('grid-bottom');
  console.log(JSON.stringify({ directory, measured }, null, 2));
} finally {
  browser.kill();
}
