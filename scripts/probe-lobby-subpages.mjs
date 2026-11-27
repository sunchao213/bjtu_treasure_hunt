/** 验证大厅设置/邮件子页能正常显示（2026-11-26） */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const baseUrl = process.env.PROBE_BASE_URL ?? 'http://localhost:5199';
const directory = resolve(`artifacts/subpage-${Date.now()}`);
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
  const failures = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      failures.push(message.params.entry.text.slice(0, 120));
    }
    if (message.method === 'Network.loadingFailed')
      failures.push(`net: ${message.params.errorText}`);
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
  await command('Log.enable');
  await command('Network.enable');
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

  const openSubpage = async (tab, shotName) => {
    await evaluate(`document.querySelector('[data-lobby-tab="${tab}"]')?.click()`);
    await delay(1200);
    const state = await evaluate(`(() => {
      const panel = document.querySelector('[data-lobby-panel="${tab}"]');
      const r = panel?.getBoundingClientRect();
      const cs = panel ? getComputedStyle(panel) : null;
      const chain = [];
      let node = panel?.parentElement;
      while (node && chain.length < 6) {
        const st = getComputedStyle(node);
        const rc = node.getBoundingClientRect();
        chain.push({ tag: node.tagName, cls: String(node.className).slice(0, 50), display: st.display, rect: [Math.round(rc.width), Math.round(rc.height)] });
        node = node.parentElement;
      }
      return {
        exists: !!panel,
        hidden: panel?.hidden ?? null,
        attrHidden: panel?.hasAttribute('hidden') ?? null,
        display: cs?.display ?? null,
        position: cs?.position ?? null,
        rect: r ? { w: Math.round(r.width), h: Math.round(r.height) } : null,
        sampleText: panel?.querySelector('h2, .lobby-panel-heading, p, label')?.textContent?.slice(0, 40) ?? '',
        childCount: panel?.children.length ?? 0,
        chain,
      };
    })()`);
    console.log(`${tab}:`, JSON.stringify(state, null, 1));
    await shot(shotName);
    // 通过「返回大厅」按钮关闭子页
    await evaluate(
      `document.querySelector('[data-lobby-panel="${tab}"] .v19-back-button')?.click()`,
    );
    await delay(300);
    return state;
  };

  // 诊断：全部面板的父节点
  const nesting = await evaluate(`(() => {
    const panels = [...document.querySelectorAll('[data-lobby-panel]')];
    const prepPage = document.querySelector('#prep-view > .prep-page');
    return {
      panels: panels.map((p) => ({
        id: p.dataset.lobbyPanel,
        parent: p.parentElement === document.querySelector('main') ? 'MAIN(游离!)'
          : p.parentElement === prepPage ? 'prep-page'
          : p.parentElement?.tagName + '.' + String(p.parentElement?.className).split(' ').slice(0,2).join('.'),
        insidePrep: !!p.closest('#prep-view'),
      })),
      prepPageChildren: prepPage ? [...prepPage.children].map((c) => c.tagName + (c.dataset.lobbyPanel ? '[' + c.dataset.lobbyPanel + ']' : '.' + String(c.className).split(' ')[0])) : null,
    };
  })()`);
  console.log('nesting:', JSON.stringify(nesting, null, 1));

  const settings = await openSubpage('settings', 'settings.png');
  const mail = await openSubpage('mail', 'mail.png');
  console.log('errors:', failures.slice(0, 5).length ? failures.slice(0, 5) : 'none');
  const pass = !settings.hidden && settings.childCount > 0 && !mail.hidden && mail.childCount > 0;
  console.log(pass ? 'PASS' : 'FAIL');
} finally {
  browser.kill();
}
