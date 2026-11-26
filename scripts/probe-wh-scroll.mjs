/** 仓库格子滚动验收：滚动 .wh-scroll 后截面板区域，确认烘焙格框不再露出（2026-11-26） */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const baseUrl = process.env.PROBE_BASE_URL ?? 'http://localhost:5199';
const directory = resolve(`artifacts/wh-scroll-${Date.now()}`);
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
  if (!ready) {
    await shot('not-ready.png');
    throw new Error('v19-loadout-open 未出现');
  }
  await evaluate(`document.querySelector('#v19-loadout-open').click()`);
  await delay(1000);

  const meta = await evaluate(
    `(() => {
      const sc = document.querySelector('.wh-scroll');
      const panel = document.querySelector('.bp-wh');
      const r = panel.getBoundingClientRect();
      return {
        scrollTopMax: sc.scrollHeight - sc.clientHeight,
        slots: document.querySelectorAll('.wh-slot').length,
        panelRect: { x: r.x, y: r.y, w: r.width, h: r.height },
      };
    })()`,
  );
  console.log(JSON.stringify(meta));

  // 静止 → 滚动 175（半行）→ 滚动到底，各截一张面板区域
  await shot('rest.png');
  await evaluate(
    `document.querySelector('.wh-scroll').scrollTop = Math.min(175, ${meta.scrollTopMax})`,
  );
  await delay(300);
  await shot('scrolled-175.png');
  await evaluate(`document.querySelector('.wh-scroll').scrollTop = ${meta.scrollTopMax}`);
  await delay(300);
  await shot('scrolled-bottom.png');
  console.log('shots saved to', directory);
} finally {
  browser.kill();
}
