import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Real production frontend, browser, HTTP account saves, and WebSocket room service.
// All accounts and saves belong to a separate local database. No production writes.
const directory = resolve(`artifacts/game-flow-${Date.now()}`);
await mkdir(directory, { recursive: true });
// Serve an isolated release copy so the cache upgrade test never edits the build under review.
const contentRoot = join(directory, 'server');
const frontendRoot = join(directory, 'dist');
await mkdir(contentRoot);
await cp(resolve('dist'), frontendRoot, { recursive: true });
const executable = [
  process.env.BROWSER_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((path) => path && existsSync(path));
assert(executable, 'Install Chrome/Edge or set BROWSER_PATH to a Chromium browser');
const listener = net.createServer();
await new Promise((done) => listener.listen(0, '127.0.0.1', done));
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const origin = `http://127.0.0.1:${port}`;
let logs = '';
const server = spawn(
  'dotnet',
  [
    resolve('server/bin/Debug/net8.0/OnlineHost.dll'),
    '--contentRoot',
    contentRoot,
    '--urls',
    origin,
  ],
  {
    windowsHide: true,
    env: { ...process.env, Auth__DataDirectory: join(directory, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
server.stdout.on('data', (data) => (logs += data));
server.stderr.on('data', (data) => (logs += data));
let browser;
let socket;
let nextId = 0;
const pending = new Map();
const pages = new Map();
const passed = [];
const stamp = Date.now().toString(36);

function command(method, params = {}, sessionId) {
  const id = ++nextId;
  return new Promise((done, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Browser command timed out: ${method}`));
    }, 15000);
    pending.set(id, { done, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}
async function evaluate(page, expression) {
  const reply = await command(
    'Runtime.evaluate',
    { expression, awaitPromise: true, returnByValue: true },
    page.id,
  );
  if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
  return reply.result.value;
}
async function until(page, expression) {
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      if (await evaluate(page, expression)) return;
    } catch (error) {
      if (
        !/Inspected target navigated|Cannot find context|Execution context was destroyed/.test(
          String(error),
        )
      )
        throw error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out: ${expression}\n${await evaluate(page, 'document.body.innerText.slice(-2500)')}`,
  );
}
async function click(page, selector) {
  await until(
    page,
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); return element?.checkVisibility() && !element.disabled; })()`,
  );
  const point = await evaluate(
    page,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || !element.checkVisibility() || element.disabled) throw Error('Cannot click ' + ${JSON.stringify(selector)});
      element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
      const box = element.getBoundingClientRect();
      return {x: box.x + box.width / 2, y: box.y + box.height / 2};
    })()`,
  );
  await command(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', ...point, button: 'left', clickCount: 1 },
    page.id,
  );
  await command(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 },
    page.id,
  );
}
async function screenshot(page, name) {
  const shot = await command('Page.captureScreenshot', { format: 'png' }, page.id);
  await writeFile(join(directory, `${name}.png`), Buffer.from(shot.data, 'base64'));
}
function pass(message) {
  passed.push(message);
  console.log(`PASS ${message}`);
}

// Inspect the real production scene through Chrome's heap API. This needs no
// production debug globals or alternative gameplay implementation.
async function attachScene(page) {
  const phaserAsset = (await readdir(join(frontendRoot, 'assets'))).find((file) =>
    /^phaser-.*\.js$/.test(file),
  );
  assert(phaserAsset);
  const prototype = await command(
    'Runtime.evaluate',
    {
      expression: `import('/assets/${phaserAsset}').then(m => Object.values(m).map(v => { try { return typeof v === 'function' ? v() : v; } catch { return v; } }).find(v => v?.Scene)?.Scene.prototype)`,
      awaitPromise: true,
    },
    page.id,
  );
  const objects = await command(
    'Runtime.queryObjects',
    { prototypeObjectId: prototype.result.objectId },
    page.id,
  );
  await command(
    'Runtime.callFunctionOn',
    {
      objectId: objects.objects.objectId,
      functionDeclaration: `function() { globalThis.testScene = this.find(s => s.sys?.settings?.key === 'world' && s.sys.isActive()); }`,
    },
    page.id,
  );
  await until(page, '!!globalThis.testScene');
}

async function interact(page, heldMs = 150) {
  await command(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69 },
    page.id,
  );
  await delay(heldMs);
  await command(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69 },
    page.id,
  );
}

async function standAt(page, point, offsetY = 35) {
  await evaluate(
    page,
    `(() => {
    const target = ${JSON.stringify(point)};
    testScene.position = { x: target.x, y: target.y + ${offsetY} };
    testScene.player.setPosition(testScene.position.x, testScene.position.y);
    testScene.cameras.main.centerOn(testScene.position.x, testScene.position.y);
    testScene.aim = -Math.PI / 2;
    testScene.lighting.enabled = true;
    testScene.services.controller.activateInvulnerability(60000);
    // Keep this story/shop integration scenario independent of timed combat
    // spawns and hug requests, which have their own scene regression tests.
    testScene.combat.enemies = [];
    testScene.combat.updateSpawns = () => [];
    for (const object of testScene.enemyObjects.values()) object.destroy();
    testScene.enemyObjects.clear();
  })()`,
  );
  await delay(200);
  const aim = await evaluate(
    page,
    `(() => {
    const rect = testScene.game.canvas.getBoundingClientRect();
    const camera = testScene.cameras.main;
    return { x: rect.left + (${point.x} - camera.worldView.x) * camera.zoom * rect.width / testScene.scale.width,
      y: rect.top + (${point.y} - camera.worldView.y) * camera.zoom * rect.height / testScene.scale.height };
  })()`,
  );
  await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...aim }, page.id);
  await delay(100);
}

async function searchEvidence(page, itemId, screenshotName) {
  const point = await evaluate(
    page,
    `testScene.searchPoints.find(p => p.itemId === ${JSON.stringify(itemId)})`,
  );
  assert(point, `${itemId} search point exists`);
  await standAt(page, point);
  assert(
    await evaluate(page, `testScene.chestObjects.get(${JSON.stringify(point.id)}).visible`),
    `flashlight reveals ${itemId}: ${JSON.stringify(await evaluate(page, '({position:testScene.position,aim:testScene.aim,interaction:testScene.interaction})'))}`,
  );
  assert(
    await evaluate(
      page,
      `testScene.player.depth > testScene.chestObjects.get(${JSON.stringify(point.id)}).depth`,
    ),
    'player in front of box is drawn above it',
  );
  await interact(page, 1000);
  if (screenshotName) await screenshot(page, screenshotName);
  await interact(page, 2500);
  await until(page, 'document.querySelector("#story-dialog").open');
  await click(page, '#story-skip');
  await delay(150);
}
async function newPage(name, { mobile = false, failAsset = false, legacyCache = false } = {}) {
  const { browserContextId } = await command('Target.createBrowserContext', {
    disposeOnDetach: true,
  });
  const { targetId } = await command('Target.createTarget', {
    url: 'about:blank',
    browserContextId,
  });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const page = { id: sessionId, browserContextId, name, errors: [], frames: [], failAsset };
  pages.set(sessionId, page);
  await command('Runtime.enable', {}, sessionId);
  await command('Page.enable', {}, sessionId);
  await command('Network.enable', {}, sessionId);
  await command(
    'Emulation.setDeviceMetricsOverride',
    {
      width: mobile ? 390 : 1440,
      height: mobile ? 844 : 900,
      deviceScaleFactor: 1,
      mobile,
    },
    sessionId,
  );
  if (mobile)
    await command(
      'Emulation.setTouchEmulationEnabled',
      { enabled: true, maxTouchPoints: 1 },
      sessionId,
    );
  if (failAsset)
    await command('Fetch.enable', { patterns: [{ urlPattern: '*player-idle.png*' }] }, sessionId);
  await command('Page.navigate', { url: origin }, sessionId);
  await until(page, '!!document.querySelector("#auth-form")');
  if (legacyCache) await primeLegacySpriteCache(page);
  await click(page, '#tab-register');
  await evaluate(
    page,
    `(() => {
    document.querySelector('#auth-username').value = ${JSON.stringify(`flow_${stamp}_${name}`)};
    document.querySelector('#auth-name').value = ${JSON.stringify(`测试${name}`)};
    document.querySelector('#auth-password').value = document.querySelector('#auth-confirm').value = ${JSON.stringify(randomBytes(24).toString('base64url'))};
  })()`,
  );
  await click(page, '#auth-submit');
  await until(
    page,
    `document.querySelector('#game-load-status')?.dataset.state === '${failAsset ? 'error' : 'ready'}'`,
  );
  assert.equal(
    await evaluate(page, '!!document.querySelector("#game-rules[open]")'),
    false,
    'rules do not obstruct entry',
  );
  await click(page, '#prologue-skip');
  return page;
}
async function primeLegacySpriteCache(page) {
  // The November 3 release used 128px frames at the same URLs; the new release uses 176px.
  // Materialize those earlier dimensions and warm the real HTTP cache before upgrading files.
  const paths = (await readdir(join(frontendRoot, 'assets/characters/processed')))
    .filter((file) => file.endsWith('.png'))
    .map((file) => `assets/characters/processed/${file}`);
  const fixtures = await evaluate(
    page,
    `(async () => Promise.all(${JSON.stringify(paths)}.map(async path => {
      const image = new Image();
      image.src = path + '?cache-fixture=current';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth / 176 * 128;
      canvas.height = 128;
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return {path, base64: canvas.toDataURL('image/png').split(',')[1]};
    })))()`,
  );
  const originals = await Promise.all(
    paths.map(async (path) => ({ path, bytes: await readFile(join(frontendRoot, path)) })),
  );
  try {
    const modified = new Date(Date.now() - 7 * 86400000);
    for (const { path, base64 } of fixtures) {
      const file = join(frontendRoot, path);
      await writeFile(file, Buffer.from(base64, 'base64'));
      await utimes(file, modified, modified);
    }
    const dimensions = await evaluate(
      page,
      `(async () => Promise.all(${JSON.stringify(paths)}.map(async path => {
        const bytes = await (await fetch(path)).arrayBuffer();
        return new DataView(bytes).getUint32(20);
      })))()`,
    );
    assert(
      dimensions.every((height) => height === 128),
      'legacy sprite files warmed in cache',
    );
  } finally {
    for (const { path, bytes } of originals) await writeFile(join(frontendRoot, path), bytes);
  }
  assert.equal(
    await evaluate(
      page,
      '(async () => new DataView(await (await fetch("assets/characters/processed/duck-idle.png")).arrayBuffer()).getUint32(20))()',
    ),
    128,
    'old unversioned image remains cached after server files upgrade to 176px',
  );
}
async function consent(page) {
  if (!(await evaluate(page, 'document.querySelector("#risk-consent").checked')))
    await click(page, '#risk-consent');
}
async function abandon(page) {
  if (!(await evaluate(page, 'document.querySelector(".danger-area").open')))
    await click(page, '.danger-area > summary');
  await click(page, '#abandon');
  await click(page, '#confirm-ok');
  await until(page, 'document.querySelector("#app").dataset.phase === "failed"');
  await until(page, '!document.querySelector("#next").hidden');
}
async function move(page, duration = 350) {
  await command(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 },
    page.id,
  );
  await delay(duration);
  await command(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key: 'd', code: 'KeyD', windowsVirtualKeyCode: 68 },
    page.id,
  );
}
const marker = `(() => {
  const canvas = document.querySelector('#campus-overview');
  const pixels = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
  let x=0,y=0,n=0;
  for(let i=0;i<pixels.length;i+=4) if(pixels[i]===255 && pixels[i+1]===199 && pixels[i+2]===103){x+=(i/4)%canvas.width;y+=Math.floor(i/4/canvas.width);n++;}
  return n ? {x:x/n,y:y/n} : null;
})()`;

try {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(logs);
    try {
      if ((await fetch(`${origin}/health`)).ok) break;
    } catch {
      /* starting */
    }
    await delay(100);
  }
  browser = spawn(
    executable,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--autoplay-policy=no-user-gesture-required',
      '--remote-debugging-port=0',
      `--user-data-dir=${join(directory, 'profile')}`,
      'about:blank',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
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
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.done(message.result);
    }
    const page = pages.get(message.sessionId);
    if (!page) return;
    if (message.method === 'Runtime.exceptionThrown')
      page.errors.push(message.params.exceptionDetails);
    if (message.method === 'Page.javascriptDialogOpening')
      void command('Page.handleJavaScriptDialog', { accept: true }, page.id);
    if (message.method === 'Fetch.requestPaused')
      void command(
        'Fetch.failRequest',
        { requestId: message.params.requestId, errorReason: 'Failed' },
        page.id,
      );
    if (message.method === 'Network.webSocketFrameReceived') {
      try {
        page.frames.push(JSON.parse(message.params.response.payloadData));
      } catch {
        /* non-game frame */
      }
    }
  });

  const upgraded = await newPage('upgraded', { legacyCache: true });
  await consent(upgraded);
  await click(upgraded, '#start');
  await until(
    upgraded,
    'document.querySelector("#app").dataset.phase === "active" && document.querySelector("#timer").textContent !== "10:00"',
  );
  assert(await evaluate(upgraded, marker), 'upgraded browser has a working minimap');
  await screenshot(upgraded, '08-cache-upgrade');
  await abandon(upgraded);
  await command('Target.disposeBrowserContext', { browserContextId: upgraded.browserContextId });
  pass('Cached 128px sprites → new 176px release → solo launch without clearing browser data');

  const host = await newPage('host');
  assert.equal(await evaluate(host, 'document.querySelector("#start").disabled'), true);
  assert.equal(await evaluate(host, '!!document.querySelector("#room-panel")'), false);
  await screenshot(host, '01-lobby');
  await consent(host);
  await click(host, '#start');
  await until(
    host,
    'document.querySelector("#app").dataset.phase === "active" && document.querySelector("#timer").textContent !== "10:00"',
  );
  const before = await evaluate(host, marker);
  assert(before, 'minimap initialized with player');
  await move(host);
  await delay(300);
  const after = await evaluate(host, marker);
  assert(after.x > before.x + 2, 'keyboard moves player and minimap');
  await screenshot(host, '02-single-game');
  await click(host, '#hud-rules');
  const pausedTime = await evaluate(host, 'document.querySelector("#timer").textContent');
  await delay(1100);
  assert.equal(
    await evaluate(host, 'document.querySelector("#timer").textContent'),
    pausedTime,
    'rules pause the raid',
  );
  await click(host, '#close-rules');
  await abandon(host);
  await screenshot(host, '03-result');
  await click(host, '#next');
  await until(host, 'document.querySelector("#app").dataset.phase === "preparing"');
  pass('Single player: consent → start → running timer → movement → pause → settlement → lobby');

  await command(
    'Emulation.setDeviceMetricsOverride',
    { width: 900, height: 500, deviceScaleFactor: 1, mobile: false },
    host.id,
  );
  await delay(300);
  await click(host, '#start');
  await until(host, 'document.querySelector("#app").dataset.phase === "active"');
  await abandon(host);
  await click(host, '#next');
  await command(
    'Emulation.setDeviceMetricsOverride',
    { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
    host.id,
  );
  pass('Second solo round and short desktop window remain usable');

  const storyPage = await newPage('story');
  await consent(storyPage);
  await click(storyPage, '#start');
  await until(storyPage, 'document.querySelector("#app").dataset.phase === "active"');
  await click(storyPage, '#tutorial-skip');
  await attachScene(storyPage);
  assert.deepEqual(
    await evaluate(
      storyPage,
      `(() => {
    const context = testScene.textures.get('campus-foreground').getSourceImage().getContext('2d');
    return [[160,1500], [235,1740], [150,1750]].map(([x,y]) => context.getImageData(x,y,1,1).data[3]);
  })()`,
    ),
    [0, 0, 255],
    'foreground preserves open pavement and gate doorway, and only covers the actual gate pillar',
  );
  await standAt(storyPage, { x: 990, y: 230 }, 0);
  await interact(storyPage);
  assert.equal(
    await evaluate(storyPage, 'testScene.services.controller.getView().steleInvestigated'),
    false,
    'stele still requires this raid notebook',
  );
  await searchEvidence(storyPage, 'torn-notebook', '09-notebook-search');
  await until(storyPage, 'document.querySelector("#quest-count").textContent === "1 / 2"');
  await standAt(storyPage, { x: 990, y: 230 }, 0);
  await interact(storyPage);
  await until(storyPage, 'document.querySelector("#story-dialog").open');
  assert(
    await evaluate(
      storyPage,
      'document.querySelector("#story-label").textContent.includes("石碑")',
    ),
  );
  await screenshot(storyPage, '10-stele-story');
  await click(storyPage, '#story-skip');
  await until(storyPage, 'document.querySelector("#quest-count").textContent === "2 / 2"');
  // Ordinary valuables only supply the extraction threshold; all story evidence
  // above and below is obtained through the actual world interactions.
  const addValuables = `(() => {
    const {inventory, controller} = testScene.services;
    const raidId = controller.getView().raidId;
    for (let i = 0; i < 2; i++) inventory.addLoot({instanceId: raidId + ':test-value:' + i, itemId: 'gpa-charm', origin: {kind:'raid-loot', obtainedInRaidId:raidId}});
  })()`;
  const finishChapter = async (expectedChapter, nextChapter) => {
    await evaluate(storyPage, addValuables);
    await standAt(storyPage, { x: 235, y: 1682 }, 0);
    await interact(storyPage);
    await until(
      storyPage,
      'document.querySelector("#app").dataset.phase === "success" && document.querySelector("#story-dialog").open',
    );
    assert.equal(
      await evaluate(storyPage, 'testScene.services.controller.getView().result.questComplete'),
      true,
    );
    assert.equal(
      await evaluate(
        storyPage,
        `document.querySelector('[data-chapter-story="${expectedChapter}"]') !== null`,
      ),
      false,
      'ending must close before chapter unlock',
    );
    await click(storyPage, '#story-skip');
    await until(storyPage, `!!document.querySelector('[data-chapter-story="${expectedChapter}"]')`);
    await click(storyPage, '#next');
    await until(
      storyPage,
      `!!document.querySelector('#lobby-missions [data-chapter="${nextChapter}"]')`,
    );
  };
  await finishChapter('siyuan-code', 'siyuan-key');
  await click(storyPage, '[data-lobby-tab="warehouse"]');
  await click(storyPage, '[data-chapter-story="siyuan-code"]');
  await until(storyPage, 'document.querySelector("#story-dialog").open');
  await click(storyPage, '#story-skip');
  await click(storyPage, '[data-lobby-tab="prepare"]');
  await click(storyPage, '#start');
  await until(storyPage, 'document.querySelector("#app").dataset.phase === "active"');
  await searchEvidence(storyPage, 'campus-map');
  await searchEvidence(storyPage, 'siyuan-key');
  await until(storyPage, 'document.querySelector("#quest-count").textContent === "2 / 2"');
  await finishChapter('siyuan-key', 'soothe-monster');
  await screenshot(storyPage, '11-chapter-three-unlocked');
  pass(
    'Authored story flow: notebook search → stele prerequisite and story → extraction → ending-gated cloud unlock → archive replay → chapter two evidence → chapter three',
  );

  await click(storyPage, '[data-lobby-tab="shop"]');
  const initialBalance = await evaluate(
    storyPage,
    'Number(document.querySelector("#shop-balance").textContent)',
  );
  assert(initialBalance >= 170, 'duplicate collectibles funded the shop through settlement');
  for (const itemId of ['bandage', 'yellow-bike', 'thick-down-jacket']) {
    await click(storyPage, `[data-shop-buy="${itemId}"]`);
    await until(storyPage, 'document.querySelector("#shop-status").dataset.state === "success"');
    await until(
      storyPage,
      `document.querySelector('[data-shop-item="${itemId}"] [data-shop-stock]').textContent === '1'`,
    );
  }
  const afterPurchase = initialBalance - 160;
  assert.equal(
    await evaluate(storyPage, 'Number(document.querySelector("#shop-balance").textContent)'),
    afterPurchase,
  );
  assert.equal(
    await evaluate(
      storyPage,
      'document.querySelector("[data-shop-buy=thick-down-jacket]").disabled',
    ),
    true,
  );
  await screenshot(storyPage, '12-shop-purchases');
  await command('Fetch.enable', { patterns: [{ urlPattern: '*/api/save' }] }, storyPage.id);
  await click(storyPage, '[data-shop-buy="bandage"]');
  await until(storyPage, 'document.querySelector("#shop-status").dataset.state === "error"');
  assert.equal(
    await evaluate(storyPage, 'Number(document.querySelector("#shop-balance").textContent)'),
    afterPurchase,
    'failed cloud save keeps balance',
  );
  assert.equal(
    await evaluate(
      storyPage,
      'document.querySelector("[data-shop-item=bandage] [data-shop-stock]").textContent',
    ),
    '1',
    'failed cloud save grants no item',
  );
  await command('Fetch.disable', {}, storyPage.id);
  await evaluate(
    storyPage,
    'document.querySelector("[data-shop-buy=bandage]").click(); document.querySelector("[data-shop-buy=bandage]").click()',
  );
  await until(storyPage, 'document.querySelector("#shop-status").dataset.state === "success"');
  assert.equal(
    await evaluate(storyPage, 'Number(document.querySelector("#shop-balance").textContent)'),
    afterPurchase - 10,
    'double click buys exactly one',
  );
  await command('Page.reload', {}, storyPage.id);
  await until(
    storyPage,
    'typeof globalThis.testScene === "undefined" && document.querySelector("#game-load-status")?.dataset.state === "ready"',
  );
  if (await evaluate(storyPage, 'document.querySelector("#prologue-skip").checkVisibility()'))
    await click(storyPage, '#prologue-skip');
  await click(storyPage, '[data-lobby-tab="shop"]');
  assert.equal(
    await evaluate(storyPage, 'Number(document.querySelector("#shop-balance").textContent)'),
    afterPurchase - 10,
    'wallet persists on reload',
  );
  assert.equal(
    await evaluate(
      storyPage,
      'document.querySelector("[data-shop-item=bandage] [data-shop-stock]").textContent',
    ),
    '2',
    'purchases persist on reload',
  );
  await click(storyPage, '#shop-prepare');
  await evaluate(
    storyPage,
    `document.querySelectorAll('#loadout input').forEach(input => { if (input.closest('label').textContent.match(/创可贴|小黄车|羽绒服/)) { input.checked = true; input.dispatchEvent(new Event('change')); } })`,
  );
  assert.equal(
    await evaluate(storyPage, 'document.querySelector("#loadout-slots").textContent'),
    '已选 5 / 6 格',
  );
  await consent(storyPage);
  await click(storyPage, '#start');
  await until(storyPage, 'document.querySelector("#app").dataset.phase === "active"');
  await attachScene(storyPage);
  await click(storyPage, '#inventory [data-item-id="bandage"] button');
  assert.equal(
    await evaluate(
      storyPage,
      'testScene.services.inventory.getCarriedItems().filter(i => i.itemId === "bandage").length',
    ),
    2,
    'full health does not consume healing',
  );
  await evaluate(storyPage, 'testScene.services.controller.applyDamage(20)');
  await click(storyPage, '#inventory [data-item-id="bandage"] button');
  assert.equal(
    await evaluate(storyPage, 'testScene.services.controller.getView().health'),
    90,
    'purchased bandage heals',
  );
  await click(storyPage, '#inventory [data-item-id="yellow-bike"] button');
  assert.equal(
    await evaluate(storyPage, 'testScene.services.controller.getMoveSpeedMultiplier()'),
    1.2,
    'purchased bike applies speed',
  );
  await click(storyPage, '#inventory [data-item-id="thick-down-jacket"] button');
  await evaluate(storyPage, 'testScene.services.controller.applyDamage(20)');
  assert.equal(
    await evaluate(storyPage, 'testScene.services.controller.getView().health'),
    90,
    'purchased jacket blocks damage',
  );
  await until(
    storyPage,
    '!document.querySelector("#inventory [data-item-id=yellow-bike]") && !document.querySelector("#inventory [data-item-id=thick-down-jacket]")',
  );
  await screenshot(storyPage, '13-purchased-items-used');
  await abandon(storyPage);
  pass(
    'Standalone shop: balance, all three purchases, insufficient funds, failed save rollback, duplicate click, cloud reload, carry-in, healing, speed and invulnerability',
  );

  await click(host, '#mode-room');
  await until(host, '!document.querySelector("#network-create").disabled');
  await click(host, '#network-create');
  await until(host, '/^[0-9]{6}$/.test(document.querySelector("#room-state-title").textContent)');
  const code = await evaluate(host, 'document.querySelector("#room-state-title").textContent');
  const guest = await newPage('guest');
  await click(guest, '#mode-room');
  await until(guest, '!document.querySelector("#network-join").disabled');
  await evaluate(guest, `document.querySelector('#network-room').value=${JSON.stringify(code)}`);
  await click(guest, '#network-join');
  await until(host, 'document.querySelector("#room-count").textContent.startsWith("2 /")');
  assert.equal(
    await evaluate(host, 'document.querySelector("#network-start").disabled'),
    true,
    'host waits for guest readiness',
  );
  await consent(guest);
  await click(guest, '#network-ready');
  await until(host, '!document.querySelector("#network-start").disabled');
  assert.equal(await evaluate(guest, 'document.querySelector("#room-settings").disabled'), true);
  await evaluate(
    host,
    `(() => { const select = document.querySelector('#network-capacity'); select.value = '2'; select.dispatchEvent(new Event('change')); })()`,
  );
  await until(guest, 'document.querySelector("#room-count").textContent === "2 / 2 人"');
  await until(host, 'document.querySelector("#network-start").disabled');
  await until(
    guest,
    'document.querySelector("#network-ready").getAttribute("aria-pressed") === "false"',
  );
  await evaluate(
    host,
    `(() => { const select = document.querySelector('#network-admission'); select.value = 'closed'; select.dispatchEvent(new Event('change')); })()`,
  );
  await until(guest, 'document.querySelector("#network-admission").value === "closed"');
  await until(host, '/ms/.test(document.querySelector("#network-quality").textContent)');
  await click(guest, '#network-ready');
  await until(host, '!document.querySelector("#network-start").disabled');
  pass(
    'Room rules: host-only capacity and admission, synchronized changes, readiness reset and live latency',
  );
  assert(
    await evaluate(
      host,
      `(() => { const box = document.querySelector('#network-start').getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; })()`,
    ),
    'room launch button stays inside the desktop frame',
  );
  await screenshot(host, '04-room-ready');
  await click(host, '#network-start');
  for (const page of [host, guest])
    await until(
      page,
      'document.querySelector("#app").dataset.phase === "active" && document.querySelector("#room-page").hidden',
    );
  const hostId = host.frames.find((frame) => frame.type === 'welcome').playerId;
  for (const page of [host, guest]) {
    assert.equal(await evaluate(page, 'document.querySelector("#team-status").hidden'), false);
    assert.equal(await evaluate(page, 'document.querySelectorAll("#team-players li").length'), 2);
    assert.equal(await evaluate(page, 'document.querySelector("#room-settings").disabled'), true);
    if (await evaluate(page, 'document.querySelector("#tutorial-skip").checkVisibility()'))
      await click(page, '#tutorial-skip');
  }
  const roomBefore = guest.frames.findLast((frame) => frame.type === 'room-state' && frame.started);
  const hostX = roomBefore.players.find((player) => player.playerId === hostId).position.x;
  await move(host);
  await delay(500);
  const roomAfter = guest.frames.findLast((frame) => frame.type === 'room-state' && frame.started);
  assert(
    roomAfter.players.find((player) => player.playerId === hostId).position.x > hostX,
    'peer receives actual server movement',
  );
  await screenshot(host, '05-room-game');
  await abandon(host);
  await click(host, '#next');
  await until(host, '!document.querySelector("#room-page").hidden');
  assert.equal(
    await evaluate(host, 'document.querySelector("#network-start").disabled'),
    true,
    'wait for remaining player to finish',
  );
  await abandon(guest);
  await click(guest, '#next');
  await until(guest, '!document.querySelector("#network-ready").disabled');
  await click(guest, '#network-ready');
  await until(host, '!document.querySelector("#network-start").disabled');
  await click(host, '#network-start');
  for (const page of [host, guest])
    await until(page, 'document.querySelector("#app").dataset.phase === "active"');
  await abandon(host);
  await abandon(guest);
  await click(host, '#next');
  await click(guest, '#next');
  await click(host, '.room-transfer');
  await click(host, '#confirm-ok');
  await until(guest, '!document.querySelector("#network-start").hidden');
  await until(host, '!document.querySelector("#network-ready").hidden');
  pass('Host transfer updates permissions in both browsers');
  await click(host, '#network-leave');
  await click(host, '#close-room');
  await click(host, '#mode-solo');
  await click(host, '#start');
  await until(host, 'document.querySelector("#app").dataset.phase === "active"');
  await abandon(host);
  pass(
    'Two accounts: join → ready → start together → sync movement → finish → next round → return to solo',
  );

  const mobile = await newPage('mobile', { mobile: true });
  await consent(mobile);
  await click(mobile, '#start');
  await until(
    mobile,
    'document.querySelector("#app").dataset.phase === "active" && document.querySelector("#timer").textContent !== "10:00"',
  );
  assert.equal(await evaluate(mobile, 'document.documentElement.dataset.touch'), 'true');
  assert(await evaluate(mobile, 'document.querySelector("#game-canvas").clientHeight > 100'));
  await screenshot(mobile, '06-mobile-game');
  pass('Portrait touch device: landscape layout and working solo launch');

  const failed = await newPage('missing', { failAsset: true });
  await consent(failed);
  assert.equal(await evaluate(failed, 'document.querySelector("#start").disabled'), true);
  assert.equal(await evaluate(failed, 'document.querySelector("#reload-game").hidden'), false);
  assert.equal(await evaluate(failed, 'document.querySelector("#app").dataset.phase'), 'preparing');
  await screenshot(failed, '07-load-error');
  pass('Missing sprite: visible recovery action and no raid started');

  const errors = [...pages.values()].flatMap((page) =>
    page.errors.map((error) => ({ page: page.name, error })),
  );
  assert.deepEqual(errors, [], 'no uncaught browser exceptions');
  await writeFile(
    join(directory, 'result.json'),
    JSON.stringify({ origin, passed, errors }, null, 2),
  );
  console.log(`Browser verification passed. Evidence: ${directory}`);
} catch (error) {
  for (const page of pages.values()) {
    await screenshot(page, `failure-${page.name}`).catch(() => {});
    console.error(page.name, JSON.stringify(page.errors));
  }
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await command('Browser.close').catch(() => {});
    socket.close();
  }
  for (const request of pending.values()) clearTimeout(request.timer);
  browser?.kill();
  server.kill();
  await writeFile(join(directory, 'server.log'), logs);
}
