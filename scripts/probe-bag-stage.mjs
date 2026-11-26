/** 背包仓库整屏（v4 舞台）验收：截全屏 + 报关键元素落点 + 收控制台报错 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve(`artifacts/bag-stage-${Date.now()}`);
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
async function shot(name, clip) {
  const params = { format: 'png', captureBeyondViewport: true };
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
  await command('Page.navigate', { url: 'http://127.0.0.1:5173/local-game.html' });
  await delay(3500);
  for (let i = 0; i < 12; i++) {
    const done = await evaluate(
      `(() => { const skip = document.querySelector('#prologue-skip'); const p = document.querySelector('#prologue'); if (!skip || !p || p.hidden) return true; skip.click(); return false; })()`,
    );
    if (done) break;
    await delay(400);
  }
  await delay(600);
  await evaluate(`document.querySelector('#v19-loadout-open').click()`);
  await delay(1000);

  const info = await evaluate(
    `(() => {
      const stage = document.querySelector('.bp-stage');
      const sr = stage.getBoundingClientRect();
      const k = sr.width / 1672;
      const at = (sel) => {
        const n = document.querySelector(sel);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return { x: +((r.x - sr.x) / k).toFixed(1), y: +((r.y - sr.y) / k).toFixed(1),
                 w: +(r.width / k).toFixed(1), h: +(r.height / k).toFixed(1) };
      };
      const slots = [...document.querySelectorAll('.wh-slot')];
      return {
        stage: { w: +sr.width.toFixed(1), h: +sr.height.toFixed(1), k: +k.toFixed(4) },
        panel: at('.wh-panel'),
        bag: at('.bp-bag'),
        grid: at('.wh-scroll'),
        slot0: at('.wh-slot'),
        bagSlot: at('.bp-slot'),
        balance: at('.bp-balance'),
        load: at('.bp-load'),
        tabs: at('.wh-tabs'),
        cap: at('.wh-capacity'),
        value: at('.wh-value'),
        sort: at('.wh-sort'),
        slotCount: slots.length,
        scroll: (() => { const s = document.querySelector('[data-wh-scroll]'); return { sh: s.scrollHeight, ch: s.clientHeight }; })(),
      };
    })()`,
  );
  console.log(JSON.stringify(info, null, 2));
  // 只截舞台本身：窗口物理像素可能小于 CSS 视口，按舞台 rect 裁才拍得全
  // 按舞台自身 rect 截（rect 已含大厅画框的缩放）
  const sr = await evaluate(
    `(() => { const r = document.querySelector('.bp-stage').getBoundingClientRect();
              return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
  );
  await shot('full', sr);
  // 交互验证：滚动 / 详情 / 分类切换
  const ui = await evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const sc = document.querySelector('[data-wh-scroll]');
    sc.scrollTop = sc.scrollHeight;
    await wait(300);
    const rows = [...document.querySelectorAll('.wh-slot')];
    const last = rows[rows.length - 1].getBoundingClientRect();
    const box = sc.getBoundingClientRect();
    const panel = document.querySelector('.wh-panel').getBoundingClientRect();
    // 点第一格看详情
    document.querySelector('.wh-slot').click();
    await wait(300);
    const detail = document.querySelector('[data-wh-detail]');
    const dRect = detail.getBoundingClientRect();
    const opened = !detail.hidden;
    const inside = dRect.left >= panel.left - 2 && dRect.right <= panel.right + 2
      && dRect.top >= panel.top - 2 && dRect.bottom <= panel.bottom + 2;
    document.querySelector('[data-wh-detail-close]')?.click();
    await wait(200);
    // 分类切换
    document.querySelector('[data-wh-filter="props"]').click();
    await wait(300);
    const filter = document.querySelector('.wh-panel').dataset.filter;
    document.querySelector('[data-wh-filter="all"]').click();
    await wait(200);
    return {
      maxScroll: +(sc.scrollHeight - sc.clientHeight).toFixed(1),
      lastRowGap: +(last.bottom - box.bottom).toFixed(1),
      detailOpened: opened,
      detailInsidePanel: inside,
      detailRect: { w: +dRect.width.toFixed(0), h: +dRect.height.toFixed(0) },
      filterSwitched: filter,
    };
  })()`);
  console.log('ui', JSON.stringify(ui));

  // 交互验证：带 2 件装备 → 左面板应出现 2 格 → 一键放入后清空
  const flow = await evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const slots = () => [...document.querySelectorAll('.bp-slot')].filter((s) => s.dataset.empty === 'false').length;
    const before = slots();
    const putAll = document.querySelector('[data-bp-put-all]');
    const disabledBefore = putAll.disabled;
    putAll.click();
    await wait(400);
    return { bagBefore: before, disabledBefore, bagAfter: slots() };
  })()`);
  console.log('bagflow', JSON.stringify(flow));
  console.log('errors', JSON.stringify(errors));
  console.log('dir', directory);
} finally {
  try {
    await command('Browser.close');
  } catch {
    /* ignore */
  }
  browser.kill();
}
