import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

// Exercise the actual lobby markup and shared browser without a backend or an account.
const directory = resolve(`artifacts/archive-ui-${Date.now()}`);
await mkdir(directory, { recursive: true });
await writeFile(
  join(directory, 'preview.html'),
  `<!doctype html><html lang="zh-CN" class="lobby-open"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>收藏与仓库预览</title></head><body><div id="stage"><div id="app" data-phase="preparing"><main id="preview"></main></div></div><script type="module">
import '/src/style.css';
import '/src/mobile-layout.css';
import '/src/archive-browser.css';
import { prepViewMarkup } from '/src/modules/ui/reference-shell.ts';
import { exportCodexImage } from '/src/modules/ui/codex.ts';
import { renderArchiveBrowser, VALUE_COLLECTION_IDS } from '/src/modules/ui/archive-browser.ts';
import { ITEM_DEFINITIONS } from '/src/config/game-config.ts';
import { bindStage } from '/src/modules/ui/stage.ts';
import { bindMobileLayout } from '/src/modules/ui/mobile-layout.ts';
document.querySelector('#preview').innerHTML = prepViewMarkup();
document.querySelector('#prep-view').hidden = false;
document.querySelector('[data-lobby-panel="prepare"]').hidden = true;
document.querySelector('[data-lobby-panel="warehouse"]').hidden = false;
document.querySelector('[data-lobby-tab="prepare"]').classList.remove('is-active');
document.querySelector('[data-lobby-tab="warehouse"]').classList.add('is-active');
document.querySelector('#lobby-player-name').textContent = '校园探索者';
document.querySelector('#lobby-archive-browser').dataset.mode = 'collection';
const itemIds = ['portable-medkit','morning-coffee','roller-skates','electric-bike-helmet','torn-notebook','anomalous-feather','marked-campus-map','soothe-charm','complete-record','bandage','yellow-bike','thick-down-jacket','silver-watch'];
window.archiveSample = { codexIds: VALUE_COLLECTION_IDS.filter(id => !['half-eraser','library-reward-ticket','strange-veined-ginkgo-leaf'].includes(id)), warehouse: [...itemIds, 'bandage', 'bandage'].map((itemId,i) => ({instanceId:'sample-'+i,itemId,origin:{kind:'carry-in'}})) };
window.renderArchiveSample = (snapshot = window.archiveSample) => { renderArchiveBrowser(document.querySelector('#lobby-archive-browser'), snapshot); };
window.renderArchiveSample();
document.querySelector('#warehouse-count-label').textContent = '15 件物品 · 320 交子';
window.exportsCompleted = 0;
for (const button of document.querySelectorAll('[data-archive-export]')) {
  button.onclick = async () => {
    button.disabled = true;
    try { await exportCodexImage(window.archiveSample.codexIds, []); window.exportsCompleted++; }
    finally { button.disabled = false; }
  };
}
bindMobileLayout(document.querySelector('#app'), () => {});
bindStage(() => {});
window.archiveReady = true;
</script></body></html>`,
);

const executable = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
].find((path) => path && existsSync(path));
assert(executable, 'Chrome/Edge or BROWSER_PATH is required');
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const port = server.httpServer.address().port;
const browser = spawn(
  executable,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${join(directory, 'profile')}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' },
);
let socket;
const pending = new Map();
const errors = [];
let nextId = 0;
let sessionId;
function command(method, params = {}, session = sessionId) {
  const id = ++nextId;
  return new Promise((done, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 15000);
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
async function screenshot(name) {
  await evaluate('Promise.all(Array.from(document.images).map(i => i.decode().catch(() => {})))');
  const shot = await command('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(directory, `${name}.png`), Buffer.from(shot.data, 'base64'));
}
const lobby = '#lobby-archive-browser';
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const text = (selector) =>
  evaluate(`document.querySelector(${JSON.stringify(selector)}).textContent`);
async function noHorizontalOverflow(selector) {
  assert(
    await evaluate(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}); return r.scrollWidth <= r.clientWidth + 2; })()`,
    ),
    `${selector} fits without horizontal overflow`,
  );
}
async function descriptionVisible(root) {
  const geometry = await evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(root)});
      const inspector = root.querySelector('.archive-inspector').getBoundingClientRect();
      const description = root.querySelector('[data-archive-description]').getBoundingClientRect();
      return { inspector: inspector.toJSON(), description: description.toJSON(), visible: description.top >= inspector.top - 1 && description.bottom <= inspector.bottom + 1
        && description.left >= inspector.left - 1 && description.right <= inspector.right + 1 };
    })()`);
  assert(
    geometry.visible,
    `${root} shows the complete item effect without scrolling: ${JSON.stringify(geometry)}`,
  );
}
async function exportFrom(selector) {
  const before = await evaluate('window.exportsCompleted');
  await click(selector);
  for (let i = 0; i < 100 && (await evaluate('window.exportsCompleted')) === before; i++)
    await delay(50);
  assert.equal(await evaluate('window.exportsCompleted'), before + 1, `${selector} exports PNG`);
}
try {
  let debuggerPort;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      debuggerPort = (await readFile(join(directory, 'profile/DevToolsActivePort'), 'utf8')).split(
        '\n',
      )[0];
      break;
    } catch {
      await delay(100);
    }
  }
  assert(debuggerPort, 'headless browser started');
  const version = await (await fetch(`http://127.0.0.1:${debuggerPort}/json/version`)).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((done) => socket.addEventListener('open', done, { once: true }));
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.done(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  });
  const target = await command('Target.createTarget', { url: 'about:blank' }, null);
  sessionId = (
    await command('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)
  ).sessionId;
  await command('Page.enable');
  await command('Runtime.enable');
  await command(
    'Browser.setDownloadBehavior',
    { behavior: 'allow', downloadPath: join(directory, 'downloads') },
    null,
  );
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command('Page.navigate', {
    url: `http://127.0.0.1:${port}/${directory.replace(resolve('.'), '').replaceAll('\\', '/').replace(/^\//, '')}/preview.html`,
  });
  for (let i = 0; i < 100 && !(await evaluate('!!window.archiveReady')); i++) await delay(100);
  assert(await evaluate('!!window.archiveReady'), 'archive initialized');
  assert.equal(await text(`${lobby} [data-archive-count]`), '7 / 10');
  await click(`${lobby} [data-archive-item="silver-watch"]`);
  assert.equal(await text(`${lobby} [data-archive-name]`), '银色手表');
  assert.equal(await text(`${lobby} [data-archive-value]`), '100');
  assert(
    await evaluate(`!document.querySelector('${lobby} [data-archive-item="portable-medkit"]')`),
    'functional items excluded from collection',
  );
  await screenshot('collection-desktop');
  assert.equal(await text(`${lobby} [data-archive-export]`), '导出图鉴');
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(`${lobby} [data-archive-export]`)}).hidden`,
    ),
    false,
  );
  await exportFrom(`${lobby} [data-archive-export]`);
  await click(`${lobby} [data-archive-mode="warehouse"]`);
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(`${lobby} [data-archive-export]`)}).hidden`,
    ),
    true,
    'export is hidden in warehouse mode',
  );
  await click(`${lobby} [data-archive-mode="collection"]`);
  await click(`${lobby} [data-archive-item="half-eraser"]`);
  assert.equal(await text(`${lobby} [data-archive-name]`), '未解锁物品');
  assert.equal(await text(`${lobby} [data-archive-value]`), '—');
  assert.equal(
    await evaluate(`document.querySelector('${lobby} [data-archive-art] img') === null`),
    true,
  );
  await click(`${lobby} [data-archive-mode="warehouse"]`);
  await click(`${lobby} [data-archive-item="portable-medkit"]`);
  assert.equal(await text(`${lobby} [data-archive-value]`), '15');
  assert.match(await text(`${lobby} [data-archive-description]`), /恢复 15 点生命/);
  assert.equal(await text(`${lobby} [data-archive-item="bandage"] .archive-item-quantity`), '×3');
  await noHorizontalOverflow(lobby);
  await screenshot('warehouse-desktop');
  await click(`${lobby} [data-archive-mode="collection"]`);
  assert.equal(
    await text(`${lobby} [data-archive-name]`),
    '未解锁物品',
    'selection persists across tabs',
  );

  for (const [width, height, name] of [
    [844, 390, 'landscape'],
    [667, 375, 'small-landscape'],
    [640, 320, 'compact-landscape'],
    [390, 844, 'forced-landscape'],
  ]) {
    await command('Emulation.setTouchEmulationEnabled', { enabled: true });
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: true,
    });
    await evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    assert.equal(await evaluate('document.documentElement.dataset.touch'), 'true');
    assert.equal(
      await evaluate('document.documentElement.dataset.rotated'),
      String(height > width),
    );
    await click(`${lobby} [data-archive-mode="warehouse"]`);
    await click(`${lobby} [data-archive-item="torn-notebook"]`);
    await noHorizontalOverflow(lobby);
    await descriptionVisible(lobby);
    await screenshot(`warehouse-${name}`);
  }

  await evaluate('window.renderArchiveSample({codexIds: [], warehouse: []})');
  await click(`${lobby} [data-archive-mode="warehouse"]`);
  assert.match(await text(`${lobby} [data-archive-grid]`), /仓库暂时空着/);
  assert.equal(await text(`${lobby} [data-archive-name]`), '暂无物品');
  assert.deepEqual(errors, [], 'no runtime errors');
  assert(
    (await readdir(join(directory, 'downloads'))).some((file) => file.endsWith('.png')),
    'export downloads a PNG file',
  );
  console.log(`Archive browser checks passed. Screenshots: ${directory}`);
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await command('Browser.close', {}, null).catch(() => {});
    socket.close();
  }
  browser.kill();
  await server.close();
}
