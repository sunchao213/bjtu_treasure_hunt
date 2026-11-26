/** 验证大厅底部不再有常驻提示栏（2026-11-26） */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const baseUrl = process.env.PROBE_BASE_URL ?? 'http://localhost:5199';
const directory = resolve(`artifacts/notice-bar-${Date.now()}`);
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
  await delay(800);

  const state = await evaluate(`(() => {
    const notice = document.querySelector('#notice');
    const r = notice?.getBoundingClientRect();
    return {
      noticeExists: !!notice,
      noticeHidden: notice?.hidden ?? null,
      noticeText: notice?.textContent ?? '',
      rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
      visible: !!r && r.width > 0 && r.height > 0,
    };
  })()`);
  console.log('notice state:', JSON.stringify(state));
  await shot('lobby-bottom.png');

  // 再触发一次 notify：背包面板的「维修」按钮必然弹提示（装备耐久暂未启用）
  await evaluate(`document.querySelector('#v19-loadout-open')?.click()`);
  await delay(800);
  await evaluate(`document.querySelector('[data-bp-repair]')?.click()`);
  await delay(500);
  const toastShown = await evaluate(
    `(() => { const n = document.querySelector('#notice'); return { hidden: n.hidden, text: n.textContent.slice(0, 30) }; })()`,
  );
  console.log('after trigger:', JSON.stringify(toastShown));
  await shot('toast.png');
  await delay(3600);
  const toastHidden = await evaluate(
    `(() => { const n = document.querySelector('#notice'); return { hidden: n.hidden }; })()`,
  );
  console.log('after 3.6s:', JSON.stringify(toastHidden));

  const pass =
    state.noticeExists &&
    state.noticeHidden === true &&
    state.noticeText === '' &&
    !state.visible &&
    toastShown.hidden === false &&
    toastHidden.hidden === true;
  console.log(pass ? 'PASS' : 'FAIL');
} finally {
  browser.kill();
}
