/** 验收仓库第三签：三个 filter 状态各自指向哪张面板图、服务器返回的图是不是最新素材 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve(`artifacts/tab3-${Date.now()}`);
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
const errors = [];
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

const md5 = (buffer) => createHash('md5').update(buffer).digest('hex');

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
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails.text);
    }
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

  const report = [];
  for (const filter of ['all', 'props', 'collection']) {
    await evaluate(`document.querySelector('[data-wh-filter="${filter}"]').click()`);
    await delay(420);
    const state = await evaluate(
      `(() => {
        const panel = document.querySelector('#warehouse-panel .wh-panel');
        const bg = getComputedStyle(panel).backgroundImage;
        const url = bg.slice(5, -2);
        const active = [...document.querySelectorAll('[data-wh-filter]')]
          .filter((b) => b.getAttribute('aria-pressed') === 'true')
          .map((b) => b.dataset.whFilter);
        return { filter: panel.dataset.filter, url, active };
      })()`,
    );
    const pathname = new URL(state.url).pathname;
    const response = await fetch(`http://127.0.0.1:5173${pathname}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const local = await readFile(join('public', pathname.replace(/^\//, '')));
    report.push({
      ...state,
      http: response.status,
      bytes: buffer.length,
      servedMatchesDisk: md5(buffer) === md5(local),
    });
    await shot(`filter-${filter}`);
  }

  console.log(JSON.stringify({ directory, report, errors }, null, 2));
} finally {
  browser.kill();
}
