/** 右上交子徽章验收：确认 CSS 引用的新素材加载成功且渲染完整，截徽章区域放大图 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const baseUrl = process.env.PROBE_BASE_URL ?? 'http://localhost:5199';
const directory = resolve(`artifacts/badge-${Date.now()}`);
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
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((a) => a.value ?? a.description).join(' '));
    }
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
  for (let i = 0; i < 40; i++) {
    const ready = await evaluate(`!!document.querySelector('#v19-loadout-open')`);
    if (ready) break;
    await delay(500);
  }
  await evaluate(`document.querySelector('#v19-loadout-open').click()`);
  await delay(1000);

  const info = await evaluate(
    `(() => {
      const badge = document.querySelector('.bp-balance');
      if (!badge) return { badgeFound: false };
      const cs = getComputedStyle(badge);
      const url = (cs.backgroundImage.match(/url\\("?(.*?)"?\\)/) ?? [])[1] ?? '';
      return fetch(url, { cache: 'no-store' })
        .then((r) => r.arrayBuffer())
        .then((buf) => ({
          badgeFound: true,
          backgroundImage: cs.backgroundImage,
          backgroundSize: cs.backgroundSize,
          assetBytes: buf.byteLength,
          assetUrl: url,
          balanceText: badge.querySelector('[data-bp-balance]')?.textContent ?? null,
        }));
    })()`,
  );
  console.log(JSON.stringify(info, null, 2));

  const rect = await evaluate(
    `(() => { const r = document.querySelector('.bp-balance').getBoundingClientRect();
              return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 }; })()`,
  );
  const reply = await command('Page.captureScreenshot', {
    format: 'png',
    clip: { ...rect, scale: 3 },
  });
  await writeFile(join(directory, 'badge-zoom.png'), Buffer.from(reply.data, 'base64'));

  const stage = await evaluate(
    `(() => { const r = document.querySelector('.bp-stage').getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  const full = await command('Page.captureScreenshot', {
    format: 'png',
    clip: { ...stage, scale: 1 },
  });
  await writeFile(join(directory, 'stage.png'), Buffer.from(full.data, 'base64'));
  console.log('saved to', directory);
} finally {
  browser.kill();
}
if (errors.length) {
  console.log('console errors:', JSON.stringify(errors, null, 2));
}
