/** 复现「一点开本地试玩链接就是背包界面」：进页面不点任何东西，截图 + 报告谁在遮谁 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve(`artifacts/local-open-${Date.now()}`);
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
  await delay(800);
  await shot('on-load');

  const info = await evaluate(
    `(() => {
      const dialog = document.querySelector('#v19-loadout-dialog');
      const cs = dialog ? getComputedStyle(dialog) : null;
      const stage = document.querySelector('.bp-stage');
      const r = stage ? stage.getBoundingClientRect() : null;
      const open = dialog ? dialog.hasAttribute('open') : null;
      const modal = dialog ? dialog.matches(':modal') : null;
      // 谁在视口中心点最上层？
      const cx = innerWidth / 2, cy = innerHeight / 2;
      const stack = document.elementsFromPoint(cx, cy).slice(0, 8).map((n) => {
        const s = getComputedStyle(n);
        return n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') +
          (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\\s+/).join('.') : '') +
          ' z=' + s.zIndex + ' pos=' + s.position;
      });
      const visibleDialogs = [...document.querySelectorAll('dialog')].map((d) => ({
        id: d.id,
        open: d.hasAttribute('open'),
        display: getComputedStyle(d).display,
      }));
      return {
        viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
        dialog: { open, modal, display: cs?.display, visibility: cs?.visibility },
        stage: r ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } : null,
        scaleVar: stage ? stage.style.getPropertyValue('--bp-scale') : null,
        stack,
        visibleDialogs,
      };
    })()`,
  );
  console.log(JSON.stringify({ directory, info, errors }, null, 2));

  // 再点开背包，确认打开后铺满且缩放正确
  await evaluate(`document.querySelector('#v19-loadout-open').click()`);
  await delay(900);
  await shot('opened');
  const opened = await evaluate(
    `(() => {
      const stage = document.querySelector('.bp-stage');
      const r = stage.getBoundingClientRect();
      const d = document.querySelector('#v19-loadout-dialog');
      const bag = document.querySelector('.bp-bag').getBoundingClientRect();
      const wh = document.querySelector('#warehouse-panel').getBoundingClientRect();
      return {
        modal: d.matches(':modal'),
        scale: stage.style.getPropertyValue('--bp-scale'),
        stage: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        stageClient: { w: stage.clientWidth, h: stage.clientHeight },
        stageTransform: getComputedStyle(stage).transform,
        stageParent: stage.parentElement.id || stage.parentElement.tagName,
        lobbyTransform: getComputedStyle(document.querySelector('#stage')).transform,
        dialogRect: (() => { const q = d.getBoundingClientRect(); return { x: +q.x.toFixed(1), w: +q.width.toFixed(1) }; })(),
        dialogClient: { w: d.clientWidth, h: d.clientHeight },
        dialogParent: d.parentElement.className,
        bagRight: +bag.right.toFixed(1),
        whRight: +wh.right.toFixed(1),
        overflowRight: +(wh.right - innerWidth).toFixed(1),
        slots: document.querySelectorAll('.bp-slot').length,
        filled: document.querySelectorAll('.bp-slot[data-empty="false"]').length,
        load: (() => {
          const n = document.querySelector('.bp-load');
          if (!n) return null;
          const q = n.getBoundingClientRect();
          const s = getComputedStyle(n);
          return {
            text: n.textContent,
            rect: { x: +q.x.toFixed(1), y: +q.y.toFixed(1), w: +q.width.toFixed(1), h: +q.height.toFixed(1) },
            color: s.color,
            fontSize: s.fontSize,
            opacity: s.opacity,
            visibility: s.visibility,
          };
        })(),
      };
    })()`,
  );
  console.log(JSON.stringify({ opened, errors }, null, 2));

  // 再关掉，确认回到大厅
  await evaluate(`document.querySelector('#v19-loadout-close').click()`);
  await delay(500);
  await shot('closed');
  const closed = await evaluate(
    `(() => {
      const d = document.querySelector('#v19-loadout-dialog');
      return { open: d.open, display: getComputedStyle(d).display, modal: d.matches(':modal') };
    })()`,
  );
  console.log(JSON.stringify({ closed }, null, 2));
} finally {
  browser.kill();
}
