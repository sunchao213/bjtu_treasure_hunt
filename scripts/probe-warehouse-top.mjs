/** 量仓库面板顶部两个数字的实际落点（容量 / 总价值），并截取放大条 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve(`artifacts/wh-top-${Date.now()}`);
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
  const params = { format: 'png' };
  if (clip) params.clip = { ...clip, scale: 1 };
  const reply = await command('Page.captureScreenshot', params);
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
    width: 1600,
    height: 1000,
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
  await delay(800);
  await evaluate(`document.querySelector('#v19-loadout-open').click()`);
  await delay(900);

  const info = await evaluate(
    `(() => {
      const panel = document.querySelector('.wh-panel');
      const pb = panel.getBoundingClientRect();
      const k = pb.width / 790; // 设计稿像素 → 屏幕像素
      const rect = (sel) => {
        const n = document.querySelector(sel);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { x: +((r.x - pb.x) / k).toFixed(1), y: +((r.y - pb.y) / k).toFixed(1),
                 w: +(r.width / k).toFixed(1), h: +(r.height / k).toFixed(1) };
      };
      const range = (sel) => {
        const n = document.querySelector(sel);
        const rg = document.createRange();
        rg.selectNodeContents(n);
        const rs = [...rg.getClientRects()].map((r) => ({ x: +((r.x - pb.x) / k).toFixed(1), y: +((r.y - pb.y) / k).toFixed(1), w: +(r.width / k).toFixed(1), h: +(r.height / k).toFixed(1) }));
        return rs;
      };
      return {
        panel: { w: +pb.width.toFixed(1), h: +pb.height.toFixed(1), k: +k.toFixed(4) },
        capBox: rect('.wh-capacity'), capText: rect('[data-wh-capacity]'), capRange: range('.wh-capacity'),
        valBox: rect('.wh-value'), valRange: range('.wh-value'),
        fs: getComputedStyle(document.querySelector('.wh-capacity')).fontSize,
      };
    })()`,
  );
  console.log(JSON.stringify(info, null, 2));
  const pb = await evaluate(
    `(() => { const r = document.querySelector('.wh-panel').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`,
  );
  await shot('top', {
    x: Math.round(pb.x + 240 * (pb.w / 790)),
    y: Math.round(pb.y + 45 * (pb.w / 790)),
    width: Math.round(490 * (pb.w / 790)),
    height: Math.round(90 * (pb.w / 790)),
  });
  // 最坏情况：容量满格 + 五位数总价值，看会不会溢出或被裁
  await evaluate(
    `(() => { document.querySelector('[data-wh-capacity]').textContent = '100'; document.querySelector('[data-wh-value]').textContent = '10240'; })()`,
  );
  await delay(200);
  await shot('top-max', {
    x: Math.round(pb.x + 240 * (pb.w / 790)),
    y: Math.round(pb.y + 45 * (pb.w / 790)),
    width: Math.round(490 * (pb.w / 790)),
    height: Math.round(90 * (pb.w / 790)),
  });
  const over = await evaluate(
    `(() => {
      const panel = document.querySelector('.wh-panel').getBoundingClientRect();
      const k = panel.width / 790;
      const r = document.querySelector('.wh-value').getBoundingClientRect();
      return { valRight: +((r.right - panel.x) / k).toFixed(1), capScroll: document.querySelector('.wh-capacity').scrollWidth - document.querySelector('.wh-capacity').clientWidth };
    })()`,
  );
  console.log('overflow check:', JSON.stringify(over));
  await writeFile(join(directory, 'meta.json'), JSON.stringify({ directory, pb, info }, null, 2));
  console.log('dir', directory);
} finally {
  browser.kill();
  process.exit(0);
}
