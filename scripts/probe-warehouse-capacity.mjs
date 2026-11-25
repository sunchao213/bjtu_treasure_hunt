/** 验收仓库 100 上限：满仓拦截 + 信箱补发 + 领取。跑之前确保 dev server 在 5173。 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = resolve(`artifacts/warehouse-cap-${Date.now()}`);
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
  const reply = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}
async function shot(name) {
  const reply = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, `${name}.png`), Buffer.from(reply.data, 'base64'));
}

async function boot(query) {
  await command('Page.navigate', { url: `http://127.0.0.1:5173/local-game.html${query}` });
  await delay(3200);
  for (let i = 0; i < 14; i++) {
    const done = await evaluate(
      `(() => { const skip = document.querySelector('#prologue-skip'); const p = document.querySelector('#prologue'); if (!skip || !p || p.hidden) return true; skip.click(); return false; })()`,
    );
    if (done) break;
    await delay(400);
  }
  await delay(700);
}

const mailState = () =>
  evaluate(`(() => {
    const panel = document.querySelector('[data-lobby-panel="mail"]');
    const badge = document.querySelector('#mail-unread-badge');
    const list = document.querySelector('#lobby-mail-list');
    const claims = [...document.querySelectorAll('[data-mail-claim]')];
    return {
      badge: badge ? { hidden: badge.hidden, text: badge.textContent } : null,
      meta: document.querySelector('#lobby-mail-meta')?.textContent,
      emptyHidden: document.querySelector('#lobby-mail-empty')?.hidden,
      letters: list ? list.children.length : -1,
      rows: claims.map((b) => ({ text: b.textContent, disabled: b.disabled })),
      hints: [...document.querySelectorAll('.mail-hint')].map((n) => n.textContent),
      chipCount: document.querySelectorAll('.mail-chip').length,
      claimAll: (() => { const b = document.querySelector('#mail-claim-all'); return b ? { text: b.textContent, disabled: b.disabled } : null; })(),
      status: document.querySelector('#lobby-mail-status')?.textContent,
    };
  })()`);

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
  await command('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });

  // ── 场景 A：满仓 100 件 + 1 封 3 件补发邮件
  await boot('?warehouse=full');
  await evaluate(`document.querySelector('[data-lobby-tab="mail"]').click()`);
  await delay(500);
  await shot('01-mail-full-warehouse');
  const full = await mailState();
  console.log('FULL mail:', JSON.stringify(full, null, 1));

  const blocked = await evaluate(
    `(() => { const b = document.querySelector('#mail-claim-all'); b.disabled = false; b.click(); return true; })()`,
  );
  await delay(600);
  console.log('claim with full warehouse →', JSON.stringify(await mailState().then((s) => ({ status: s.status, letters: s.letters }))), blocked ? '' : '');
  await shot('02-mail-claim-blocked');

  await evaluate(`document.querySelector('[data-lobby-tab="shop"]').click()`);
  await delay(500);
  const shop = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('[data-shop-buy]')];
    return { rows: buttons.map((b) => ({ text: b.textContent, disabled: b.disabled })), status: document.querySelector('#shop-status')?.textContent };
  })()`);
  console.log('SHOP at full:', JSON.stringify(shop, null, 1));
  await shot('03-shop-full');
  await evaluate(
    `(() => { const b = document.querySelector('[data-shop-buy]'); b.disabled = false; b.click(); })()`,
  );
  await delay(800);
  const shopAfter = await evaluate(`(() => ({
    status: document.querySelector('#shop-status')?.textContent,
    balance: document.querySelector('#shop-balance')?.textContent,
    writes: window.__saveWrites ?? 0,
  }))()`);
  console.log('SHOP blocked purchase:', JSON.stringify(shopAfter, null, 1));
  await shot('04-shop-blocked');

  // 满仓时仓库面板顶部的容量数字应转红（先回大厅，仓库入口只在大厅可见）
  await evaluate(`document.querySelector('[data-lobby-tab="prepare"]')?.click()`);
  await delay(400);
  await evaluate(`document.querySelector('#v19-loadout-open').click()`);
  await delay(1000);
  const cap = await evaluate(`(() => {
    const node = document.querySelector('.wh-capacity');
    const panel = document.querySelector('.wh-panel').getBoundingClientRect();
    return {
      text: node?.textContent,
      full: node?.dataset.full,
      color: node ? getComputedStyle(node.querySelector('b')).color : null,
      panel: { x: Math.round(panel.x), y: Math.round(panel.y), w: Math.round(panel.width), h: Math.round(panel.height) },
    };
  })()`);
  console.log('WAREHOUSE at full:', JSON.stringify(cap));
  await shot('05-warehouse-full');
  await evaluate(`document.querySelector('[data-wh-close]')?.click() ?? document.querySelector('#v19-loadout-dialog')?.close()`);
  await delay(400);

  // ── 场景 B：90 格 + 1 封 3 件邮件 → 全部领取
  await boot('?warehouse=roomy');
  await evaluate(`document.querySelector('[data-lobby-tab="mail"]').click()`);
  await delay(500);
  await shot('05-mail-roomy');
  console.log('ROOMY mail:', JSON.stringify(await mailState(), null, 1));
  await evaluate(`document.querySelector('#mail-claim-all').click()`);
  await delay(900);
  console.log('ROOMY after claim:', JSON.stringify(await mailState(), null, 1));
  await shot('06-mail-claimed');
  const after = await evaluate(`(() => ({
    capacity: document.querySelector('[data-wh-capacity]')?.textContent,
    badge: document.querySelector('#mail-unread-badge')?.hidden,
    writes: window.__saveWrites ?? 0,
  }))()`);
  console.log('ROOMY state:', JSON.stringify(after));

  console.log('errors:', JSON.stringify(await evaluate('window.__errors ?? []')));
  console.log('dir', directory);
} finally {
  browser.kill();
  process.exit(0);
}
