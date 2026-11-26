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
const geometry = JSON.parse(await readFile('src/config/formal-campus.json', 'utf8'));
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
    resolve(process.env.BROWSER_TEST_SERVER_DLL ?? 'server/bin/Debug/net8.0/OnlineHost.dll'),
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
const chestsOnly = process.argv.includes('--chests-only');
const roomsOnly = process.argv.includes('--rooms-only');
const immersiveOnly = process.argv.includes('--immersive-only');
const steleOnly = process.argv.includes('--stele-only');
const healingOnly = process.argv.includes('--healing-only');
const hotbarOnly = process.argv.includes('--hotbar-only');
const durabilityOnly = process.argv.includes('--durability-only');
const utilityEffectsOnly = process.argv.includes('--utility-effects-only');
const detectorOnly = process.argv.includes('--detector-only');
const quickNoteOnly = process.argv.includes('--quick-note-only');
const rulerOnly = process.argv.includes('--ruler-only');
const catOnly = process.argv.includes('--cat-only');
const spawningOnly = process.argv.includes('--spawning-only');

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
    `Timed out: ${expression}\n${await evaluate(page, 'document.body.innerText.slice(-2500)')}\n${JSON.stringify(await evaluate(page, 'globalThis.testScene && ({phase:testScene.services.controller.getView(), disposed:testScene.disposed, network:testScene.services.network.getStatus(), roomHidden:document.querySelector("#room-page").hidden, modal:document.querySelector("dialog[open]")?.id,consent:document.querySelector("#risk-consent").checked})'))}`,
  );
}
async function click(page, selector) {
  // Release capture for HUD clicks in the harness; closing settings with Esc now recaptures it.
  if (
    selector !== '#game-canvas canvas' &&
    (await evaluate(page, '!!document.pointerLockElement'))
  ) {
    await attachScene(page);
    await evaluate(page, 'testScene.releaseMouse()');
    await until(page, '!document.pointerLockElement');
  }
  if (selector === '#mode-room') selector = '.v19-teammate-one';
  if (selector === '#mode-solo' && (await evaluate(page, '!testScene.services.network.isInRoom()')))
    return;
  if (
    selector === '#next' &&
    (await evaluate(page, 'document.querySelector("#app").dataset.phase === "preparing"'))
  ) {
    if (
      await evaluate(
        page,
        'testScene.services.network.isInRoom() && document.querySelector("#room-page").hidden',
      )
    )
      await click(page, '#start');
    return;
  }
  if (selector.startsWith('#inventory ')) {
    if (await evaluate(page, 'document.querySelector("#inventory-panel").hidden'))
      await click(page, '#toggle-inventory');
    const liSelector = selector.replace(/ (?:button|\[data-hotbar-assign\]).*$/, '');
    const id = await evaluate(
      page,
      `document.querySelector(${JSON.stringify(liSelector)})?.dataset.instanceId`,
    );
    if (id) await click(page, `.item-slot[data-item-id="${id}"]`);
  }
  await until(
    page,
    `(() => { const element = document.querySelector(${JSON.stringify(selector)}); return element?.checkVisibility() && !element.disabled; })()`,
  );
  let point;
  for (let attempt = 0; attempt < 20; attempt++) {
    point = await evaluate(
      page,
      `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element || !element.checkVisibility() || element.disabled) throw Error('Cannot click ' + ${JSON.stringify(selector)});
      if (!element.matches('#game-canvas canvas'))
        element.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
      const box = element.getBoundingClientRect();
      return {x: box.x + box.width / 2, y: box.y + box.height / 2};
    })()`,
    );
    await delay(80);
    const stable = await evaluate(
      page,
      `(() => {const el=document.querySelector(${JSON.stringify(selector)});const b=el.getBoundingClientRect(); const hit=document.elementFromPoint(${point.x},${point.y}); return Math.abs(b.x+b.width/2-${point.x})<0.5 && Math.abs(b.y+b.height/2-${point.y})<0.5 && (el===hit || el.contains(hit));})()`,
    );
    if (stable) break;
    if (attempt === 19) throw Error('Click target is obscured or moving: ' + selector);
  }
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
async function press(page, key, code, windowsVirtualKeyCode) {
  await command(
    'Input.dispatchKeyEvent',
    { type: 'keyDown', key, code, windowsVirtualKeyCode },
    page.id,
  );
  await command(
    'Input.dispatchKeyEvent',
    { type: 'keyUp', key, code, windowsVirtualKeyCode },
    page.id,
  );
}
async function touchDrag(page, selector, dx, dy) {
  const point = await evaluate(
    page,
    `(() => {const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
  );
  await command(
    'Input.dispatchTouchEvent',
    { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] },
    page.id,
  );
  await command(
    'Input.dispatchTouchEvent',
    { type: 'touchMove', touchPoints: [{ x: point.x + dx, y: point.y + dy, id: 1 }] },
    page.id,
  );
  await delay(250);
  await command('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, page.id);
  await delay(250);
}
function pass(message) {
  passed.push(message);
  console.log(`PASS ${message}`);
}

// Inspect the real production scene through Chrome's heap API. This needs no
// production debug globals or alternative gameplay implementation.
async function attachScene(page) {
  const sceneAsset = (await readdir(join(frontendRoot, 'assets'))).find((file) =>
    /^formal-world-.*\.js$/.test(file),
  );
  assert(sceneAsset);
  const prototype = await command(
    'Runtime.evaluate',
    {
      expression: `import('/assets/${sceneAsset}').then(m => Object.values(m).find(v => typeof v === 'function' && v.prototype?.start && v.prototype?.destroy)?.prototype)`,
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
      functionDeclaration: `function() { globalThis.testScene = this.find(s => s.view?.renderer?.domElement?.isConnected && !s.disposed); }`,
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
  if (await evaluate(page, '!!document.querySelector("#story-dialog[open]")'))
    await click(page, '#story-skip');
  await evaluate(
    page,
    `(() => {
    const target = ${JSON.stringify(point)};
    testScene.position = { x: target.x, y: target.y + ${offsetY} };
    testScene.clearInteractions();
    testScene.aim = -Math.PI / 2;
    testScene.view.resetCamera();
    testScene.lighting.enabled = true;
    testScene.services.controller.activateInvulnerability(60000);
    // Keep this story/shop integration scenario independent of timed combat
    // spawns and hug requests, which have their own scene regression tests.
    testScene.combat.enemies = testScene.combat.enemies.filter(e => e.id === 'story-garden-help');
    testScene.combat.updateSpawns = () => [];
  })()`,
  );
  await delay(200);
  if (await evaluate(page, '!!document.querySelector("#story-dialog[open]")'))
    await click(page, '#story-skip');
  // Desktop flashlight aim follows the camera, including without pointer lock.
  // Teleporting through the test seam needs two render frames: cameraAim reads
  // the last rendered avatar, then the following input frame uses its new position.
  await until(
    page,
    `!testScene.services.controller.isPaused() &&
    !document.querySelector('dialog[open]') && Math.abs(testScene.aim + Math.PI / 2) < 0.01`,
  );
}

async function searchEvidence(page, itemId, screenshotName) {
  await until(page, 'testScene.lastRaidId === testScene.services.controller.getView().raidId');
  const authored = {
    'marked-campus-map': geometry.chapterTwoPoints.campusMap,
    'siyuan-key': geometry.chapterTwoPoints.siyuanKey,
    'soothe-charm': geometry.chapterThreePoints.help,
    'complete-record': geometry.chapterThreePoints.record,
  }[itemId];
  if (authored) {
    await standAt(page, authored, itemId === 'soothe-charm' ? 20 : 35);
    if (itemId === 'soothe-charm') {
      await command(
        'Input.dispatchKeyEvent',
        { type: 'keyDown', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 },
        page.id,
      );
      await delay(1800);
      await command(
        'Input.dispatchKeyEvent',
        { type: 'keyUp', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 },
        page.id,
      );
    } else await interact(page);
    await until(
      page,
      `testScene.services.inventory.getCarriedItems().some(i => i.itemId === ${JSON.stringify(itemId)})`,
    );
    await until(page, 'document.querySelector("#story-dialog").open');
    if (screenshotName) await screenshot(page, screenshotName);
    await click(page, '#story-skip');
    return;
  }
  const point = await evaluate(
    page,
    `testScene.searchPoints.find(p => p.itemId === ${JSON.stringify(itemId)})`,
  );
  assert(point, `${itemId} search point exists`);
  await standAt(page, point);
  assert(
    await evaluate(page, `testScene.frame().visibleChests.includes(${JSON.stringify(point.id)})`),
    `flashlight reveals ${itemId}: ${JSON.stringify(await evaluate(page, '({position:testScene.position,aim:testScene.aim,interaction:testScene.interaction})'))}`,
  );
  assert(
    await evaluate(
      page,
      `testScene.view.chests.get(${JSON.stringify(point.id)}).mesh.material.depthWrite`,
    ),
    'chest cutout participates in 3D depth testing',
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
  await command('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
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
  if (!(await evaluate(page, 'document.querySelector("#raid-settings").open')))
    await click(page, '#open-raid-settings');
  await click(page, '#abandon');
  await click(page, '#confirm-ok');
  await until(page, 'document.querySelector("#app").dataset.phase === "preparing"');
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

async function verifyImmersiveLayout(page, width, height, mobile = false) {
  await command(
    'Emulation.setDeviceMetricsOverride',
    {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    },
    page.id,
  );
  await delay(300);
  const layout = await evaluate(
    page,
    `(() => {
    const canvas = document.querySelector('#game-canvas canvas').getBoundingClientRect();
    const selectors = ['.raid-location', '.formal-story-objective', '#tutorial', '#team-status',
      '#raid-value', '.map-hud-right', '#open-campus-map', '.formal-camera-controls',
      '.interaction', '#raid-hotbar', '#toggle-inventory', '#key-prompt', '#map-toast',
      '.touch-controls .touch-stick', '.touch-aim', '.touch-actions'];
    const boxes = selectors.flatMap(selector => {
      const el = document.querySelector(selector);
      if (!el?.checkVisibility()) return [];
      const r = el.getBoundingClientRect();
      return [{selector, x:r.x, y:r.y, width:r.width, height:r.height}];
    });
    return {width:innerWidth, height:innerHeight, canvas:{x:canvas.x,y:canvas.y,width:canvas.width,height:canvas.height},
      scroll:document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
      boxes, bars:document.querySelectorAll('.map-top').length};
  })()`,
  );
  assert.equal(layout.bars, 0, 'old top bar removed');
  assert.equal(layout.scroll, false, 'no document scrolling');
  assert(
    Math.abs(layout.canvas.x) < 1 && Math.abs(layout.canvas.y) < 1,
    `canvas starts at viewport origin: ${JSON.stringify(layout)}`,
  );
  assert(
    Math.abs(layout.canvas.width - layout.width) < 1 &&
      Math.abs(layout.canvas.height - layout.height) < 1,
    `canvas fills viewport: ${JSON.stringify(layout)}`,
  );
  for (const box of layout.boxes) {
    assert(
      box.x >= -1 &&
        box.y >= -1 &&
        box.x + box.width <= layout.width + 1 &&
        box.y + box.height <= layout.height + 1,
      `HUD fits viewport: ${JSON.stringify(box)}`,
    );
  }
  for (let i = 0; i < layout.boxes.length; i++)
    for (let j = i + 1; j < layout.boxes.length; j++) {
      const a = layout.boxes[i],
        b = layout.boxes[j];
      assert(
        !(
          a.x < b.x + b.width - 1 &&
          b.x < a.x + a.width - 1 &&
          a.y < b.y + b.height - 1 &&
          b.y < a.y + a.height - 1
        ),
        `HUD overlap at ${width}×${height}: ${JSON.stringify([a, b])}`,
      );
    }
  await screenshot(page, `immersive-${mobile ? 'touch' : 'desktop'}-${width}x${height}`);
}

async function verifyImmersiveFlow() {
  const page = await newPage('immersive');
  await command('Browser.setPermission', {
    permission: { name: 'keyboard-lock' },
    setting: 'granted',
    browserContextId: page.browserContextId,
  });
  await evaluate(
    page,
    `(() => {
      const keyboard = navigator.keyboard;
      const lock = keyboard.lock.bind(keyboard), unlock = keyboard.unlock.bind(keyboard);
      globalThis.testKeyboardLocked = false;
      keyboard.lock = async (keys) => {
        await lock(keys);
        globalThis.testKeyboardLocked = keys.length === 1 && keys[0] === 'Escape';
      };
      keyboard.unlock = () => { unlock(); globalThis.testKeyboardLocked = false; };
    })()`,
  );
  await consent(page);
  await click(page, '#start');
  await until(page, 'document.querySelector("#app").dataset.phase === "active"');
  await attachScene(page);
  await until(
    page,
    'document.fullscreenElement === document.documentElement && testKeyboardLocked',
  );
  await until(page, 'document.pointerLockElement === testScene.view.renderer.domElement');
  await screenshot(page, 'immersive-fullscreen-entry');
  assert.equal(
    await evaluate(page, 'testScene.view.cameraInfo().includes("俯角 18° · 缩放 5.0")'),
    true,
  );
  const yaw = await evaluate(page, 'testScene.view.cameraRig.yaw');
  for (const x of [550, 570, 590])
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 450 }, page.id);
  await delay(150);
  assert.notEqual(
    await evaluate(page, 'testScene.view.cameraRig.yaw'),
    yaw,
    'start captures continuous mouse look without a canvas click',
  );
  // Story events arrive during gameplay without a fresh user gesture.
  for (const method of ['mouse', 'Enter', ' ']) {
    await evaluate(
      page,
      `testScene.services.events.emit('StoryDiscovered', {
        raidId: testScene.services.controller.getView().raidId,
        locationId: 'pointer-lock-story-${method}', chapterId: 'siyuan-code',
        title: '视角恢复测试', text: '剧情结束后直接转动视角。'
      })`,
    );
    await until(page, 'document.querySelector("#story-dialog").open');
    assert.equal(
      await evaluate(page, 'document.pointerLockElement === testScene.view.renderer.domElement'),
      true,
      'story keeps the cursor captured while reading',
    );
    assert.equal(await evaluate(page, 'testScene.services.controller.isPaused()'), true);
    const storyYaw = await evaluate(page, 'testScene.view.cameraRig.yaw');
    for (const x of [600, 620, 640])
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 450 }, page.id);
    await delay(100);
    assert.equal(await evaluate(page, 'testScene.view.cameraRig.yaw'), storyYaw);
    for (let advance = 0; advance < 2; advance++) {
      if (method === 'mouse') {
        for (const type of ['mousePressed', 'mouseReleased'])
          await command(
            'Input.dispatchMouseEvent',
            { type, x: 640, y: 450, button: 'left', clickCount: 1 },
            page.id,
          );
      } else {
        await press(
          page,
          method,
          method === 'Enter' ? 'Enter' : 'Space',
          method === 'Enter' ? 13 : 32,
        );
      }
      if (!(await evaluate(page, 'document.querySelector("#story-dialog").open'))) break;
    }
    await until(
      page,
      '!document.querySelector("#story-dialog").open && !testScene.services.controller.isPaused()',
    );
    assert.equal(
      await evaluate(page, 'document.pointerLockElement === testScene.view.renderer.domElement'),
      true,
      'closing the story keeps the cursor captured without a canvas click',
    );
    for (const x of [660, 680, 700])
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 450 }, page.id);
    await delay(100);
    assert.notEqual(
      await evaluate(page, 'testScene.view.cameraRig.yaw'),
      storyYaw,
      'mouse movement immediately resumes camera look after the story',
    );
  }
  await screenshot(page, 'immersive-story-mouse-look');
  await press(page, 'Escape', 'Escape', 27);
  await until(
    page,
    'document.querySelector("#raid-settings").open && !document.pointerLockElement',
  );
  assert.equal(await evaluate(page, '!!document.fullscreenElement && testKeyboardLocked'), true);
  await click(page, '#resume-raid');
  await until(page, 'document.pointerLockElement === testScene.view.renderer.domElement');
  for (const [key, code, keyCode] of [
    ['Escape', 'Escape', 27],
    ['m', 'KeyM', 77],
  ]) {
    await press(page, 'm', 'KeyM', 77);
    await until(
      page,
      'document.querySelector("#campus-map-dialog").open && !document.pointerLockElement',
    );
    await press(page, key, code, keyCode);
    await until(
      page,
      '!document.querySelector("#campus-map-dialog").open && document.pointerLockElement === testScene.view.renderer.domElement',
    );
  }
  await press(page, 'Escape', 'Escape', 27);
  await until(page, 'document.querySelector("#raid-settings").open');
  await press(page, 'Escape', 'Escape', 27);
  await until(
    page,
    '!document.querySelector("#raid-settings").open && document.pointerLockElement === testScene.view.renderer.domElement',
  );
  const resumedYaw = await evaluate(page, 'testScene.view.cameraRig.yaw');
  for (const x of [610, 630, 650])
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 450 }, page.id);
  await delay(150);
  assert.notEqual(
    await evaluate(page, 'testScene.view.cameraRig.yaw'),
    resumedYaw,
    'M/Escape transitions restore continuous mouse look without a canvas click',
  );
  await screenshot(page, 'immersive-keyboard-resume');
  assert.equal(await evaluate(page, '!!document.fullscreenElement && testKeyboardLocked'), true);
  await evaluate(page, 'document.exitFullscreen()');
  await until(
    page,
    '!document.fullscreenElement && !testKeyboardLocked && !document.pointerLockElement && document.querySelector("#raid-settings").open',
  );
  await click(page, '#mobile-fullscreen');
  await until(page, '!!document.fullscreenElement && testKeyboardLocked');
  await click(page, '#resume-raid');
  await until(page, 'document.pointerLockElement === testScene.view.renderer.domElement');
  await press(page, 'Tab', 'Tab', 9);
  await until(
    page,
    '!document.querySelector("#inventory-panel").hidden && !document.pointerLockElement',
  );
  await press(page, 'Escape', 'Escape', 27);
  await until(page, 'document.querySelector("#inventory-panel").hidden');
  // Use actual reset control after releasing capture via the normal settings flow.
  await click(page, '#camera-reset');
  await evaluate(page, 'testScene.services.controller.activateInvulnerability(60000)');
  for (const [width, height] of [
    [1920, 1080],
    [1366, 768],
    [1024, 768],
    [2560, 1080],
  ])
    await verifyImmersiveLayout(page, width, height);
  await click(page, '#open-campus-map');
  await until(
    page,
    'document.querySelector("#campus-map-dialog").open && !document.pointerLockElement',
  );
  await screenshot(page, 'immersive-expanded-map');
  await click(page, '#close-campus-map');
  await until(
    page,
    '!document.querySelector("#campus-map-dialog").open && document.pointerLockElement === testScene.view.renderer.domElement',
  );
  await abandon(page);
  assert.equal(
    await evaluate(page, 'testKeyboardLocked'),
    false,
    'lobby returns Escape to browser',
  );
  assert.equal(
    await evaluate(page, 'document.documentElement.classList.contains("raid-immersive")'),
    false,
    'lobby restores fixed stage',
  );
  await screenshot(page, 'immersive-return-lobby');
  await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });

  const denied = await newPage('hover');
  await consent(denied);
  await evaluate(
    denied,
    'HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new Error("Test capture denial"))',
  );
  await click(denied, '#start');
  await until(denied, 'document.querySelector("#app").dataset.phase === "active"');
  await attachScene(denied);
  const before = await evaluate(denied, 'testScene.view.cameraRig.yaw');
  for (const x of [600, 620, 640])
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y: 450 }, denied.id);
  assert.notEqual(
    await evaluate(denied, 'testScene.view.cameraRig.yaw'),
    before,
    'denied capture allows hover look without clicking',
  );
  await abandon(denied);
  await command('Target.disposeBrowserContext', { browserContextId: denied.browserContextId });

  const mobile = await newPage('itouch', { mobile: true });
  await consent(mobile);
  await click(mobile, '#start');
  await until(mobile, 'document.querySelector("#app").dataset.phase === "active"');
  await attachScene(mobile);
  for (const [width, height] of [
    [844, 390],
    [390, 844],
    [844, 300],
  ])
    await verifyImmersiveLayout(mobile, width, height, true);
  await command('Target.disposeBrowserContext', { browserContextId: mobile.browserContextId });
  pass(
    'Immersive entry, automatic capture/resume, hover fallback, full viewport, HUD clearance and lobby restoration',
  );
}

async function verifyWeaponDurabilityFlow() {
  for (const mobile of [false, true]) {
    const device = mobile ? 'touch' : 'desktop';
    const page = await newPage(mobile ? 'durt' : 'durd', { mobile });
    await consent(page);
    await evaluate(page, 'document.querySelector("#starter-weapon").value = "stun-baton"');
    await click(page, '#start');
    await until(page, 'document.querySelector("#app").dataset.phase === "active"');
    await click(page, '#tutorial-skip');
    await attachScene(page);
    await evaluate(
      page,
      `(() => {
      testScene.combat.enemies = [];
      testScene.combat.updateSpawns = () => [];
      globalThis.durabilityInput = {
        move: {x:0, y:0}, aim:0, interact:false, attack:false,
        hug:false, flashlight:false, refill:false, flare:false
      };
    })()`,
    );
    await until(
      page,
      '!document.querySelector("#hotbar-weapon-durability").hidden && document.querySelector("#hotbar-weapon-durability progress").value === 15',
    );
    await screenshot(page, 'durability-full-' + device);
    await evaluate(
      page,
      `(() => {
      for (let i=0; i<12; i++) {
        testScene.combat.tick(1200);
        testScene.tick(16, {...durabilityInput, attack:true});
      }
    })()`,
    );
    await until(
      page,
      'document.querySelector("#hotbar-weapon-durability").dataset.state === "low" && document.querySelector("#hotbar-weapon-durability progress").value === 3',
    );
    await screenshot(page, 'durability-low-' + device);
    await evaluate(
      page,
      `(() => {
      for (let i=0; i<3; i++) {
        testScene.combat.tick(1200);
        testScene.tick(16, {...durabilityInput, attack:true});
      }
    })()`,
    );
    await until(
      page,
      'document.querySelector("#hotbar-weapon-durability").dataset.state === "empty" && document.querySelector("#hotbar-weapon-durability progress").value === 0 && document.querySelector("#hotbar-hint").textContent.includes("次数已耗尽")',
    );
    assert(
      (await evaluate(page, 'document.querySelector("#map-toast").textContent')).includes(
        '次数已耗尽',
      ),
    );
    await screenshot(page, 'durability-empty-' + device);
    await evaluate(
      page,
      `(() => {
      testScene.tick(16, {...durabilityInput, quickSlot:3});
      testScene.tick(16, {...durabilityInput, quickSlot:0});
      testScene.combat.tick(1200);
      testScene.tick(16, {...durabilityInput, attack:true});
    })()`,
    );
    assert.equal(await evaluate(page, 'testScene.combat.getWeaponUsesRemaining("stun-baton")'), 0);
    assert.equal(await evaluate(page, 'testScene.combat.swingMs'), 0);
    const rect = await evaluate(
      page,
      `(() => {
      const r = document.querySelector('#hotbar-weapon-durability').getBoundingClientRect();
      return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:innerWidth, height:innerHeight};
    })()`,
    );
    assert(
      rect.left >= 0 && rect.top >= 0 && rect.right <= rect.width && rect.bottom <= rect.height,
      'durability stays inside the viewport',
    );
    assert(
      await evaluate(
        page,
        `(() => {
      const bar = document.querySelector('#hotbar-weapon-durability').getBoundingClientRect();
      const selectors = ['.interaction', '.hotbar-slots', '.touch-stick', '.touch-aim', '#toggle-inventory'];
      return selectors.every(selector => {
        const node = document.querySelector(selector);
        if (!node || !node.getClientRects().length) return true;
        const other = node.getBoundingClientRect();
        return bar.right <= other.left || other.right <= bar.left || bar.bottom <= other.top || other.bottom <= bar.top;
      });
    })()`,
      ),
      'durability does not overlap interactions, shortcuts or touch sticks',
    );
    await abandon(page);
    await until(page, 'document.querySelector("#raid-hotbar").hidden');
    await consent(page);
    await click(page, '#start');
    await until(
      page,
      'document.querySelector("#app").dataset.phase === "active" && document.querySelector("#hotbar-weapon-durability progress").value === 15',
    );
    await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
    pass(
      'Baton durability on ' +
        device +
        ': 15 uses, low warning, exhausted text/toast, no attack at zero, new raid resets',
    );
  }
}

async function verifyHotbarFlow() {
  const page = await newPage('hotbar');
  await consent(page);
  await click(page, '#start');
  await until(page, 'document.querySelector("#app").dataset.phase === "active"');
  await click(page, '#tutorial-skip');
  await attachScene(page);
  await evaluate(
    page,
    `(() => {
      testScene.combat.enemies = [];
      testScene.combat.updateSpawns = () => [];
      const inventory = testScene.services.inventory;
      const origin = {kind:'raid-loot', obtainedInRaidId:testScene.services.controller.getView().raidId};
      if (!inventory.getCarriedItems().some(item => item.itemId === 'training-bat'))
        inventory.addLoot({instanceId:'hotbar-bat',itemId:'training-bat',origin});
      for (let i=0;i<2;i++) inventory.addLoot({instanceId:'hotbar-bandage-'+i,itemId:'bandage',origin});
    })()`,
  );
  await until(
    page,
    'document.querySelectorAll("[data-hotbar-slot]").length === 4 && document.querySelectorAll("[data-hotbar-slot]")[1].dataset.instanceId === "hotbar-bandage-0" && document.querySelectorAll("[data-hotbar-slot]")[2].dataset.instanceId === "hotbar-bandage-1"',
  );
  assert.equal(
    await evaluate(page, 'document.querySelectorAll(".hotbar-count").length'),
    0,
    'no quantity badges, including ×1',
  );
  await screenshot(page, 'hotbar-individual-items');
  await press(page, '4', 'Digit4', 52);
  await until(
    page,
    'document.querySelectorAll("[data-hotbar-slot]")[3].getAttribute("aria-pressed") === "true"',
  );
  assert.equal(await evaluate(page, 'testScene.hotbar.selected().item'), null);
  await screenshot(page, 'hotbar-empty-selected');
  if (!(await evaluate(page, '!!document.pointerLockElement')))
    await click(page, '#game-canvas canvas');
  await click(page, '#game-canvas canvas');
  assert.equal(
    await evaluate(page, 'testScene.combat.swingMs'),
    0,
    'empty hands never swing a carried weapon',
  );
  assert.equal(
    await evaluate(
      page,
      'testScene.services.inventory.getCarriedItems().filter(i=>i.itemId==="bandage").length',
    ),
    2,
  );
  await press(page, '2', 'Digit2', 50);
  await until(
    page,
    'document.querySelectorAll("[data-hotbar-slot]")[1].getAttribute("aria-pressed") === "true"',
  );
  await click(page, '#game-canvas canvas');
  assert.equal(
    await evaluate(
      page,
      'testScene.services.inventory.getCarriedItems().filter(i=>i.itemId==="bandage").length',
    ),
    2,
    'full health keeps stock',
  );
  await evaluate(page, 'testScene.services.controller.applyDamage(30)');
  await command(
    'Input.dispatchMouseEvent',
    { type: 'mousePressed', x: 450, y: 350, button: 'left', clickCount: 1 },
    page.id,
  );
  await delay(250);
  await command(
    'Input.dispatchMouseEvent',
    { type: 'mouseReleased', x: 450, y: 350, button: 'left', clickCount: 1 },
    page.id,
  );
  await until(
    page,
    'document.querySelectorAll("[data-hotbar-slot]")[1].dataset.itemId === "" && !document.querySelectorAll("[data-hotbar-slot]")[1].querySelector(".hotbar-empty").hidden',
  );
  assert.equal(
    await evaluate(page, 'testScene.services.controller.getView().health'),
    80,
    'holding left mouse consumes only one bandage',
  );
  assert.equal(await evaluate(page, 'testScene.hotbar.selectedIndex'), 1);
  assert.equal(await evaluate(page, 'testScene.hotbar.slots()[2].instanceId'), 'hotbar-bandage-1');
  await screenshot(page, 'hotbar-bandage-used');
  await click(page, '#game-canvas canvas');
  assert.equal(
    await evaluate(
      page,
      'testScene.services.inventory.getCarriedItems().filter(i=>i.itemId==="bandage").length',
    ),
    1,
    'clicking the consumed slot cannot use a different bandage',
  );
  await press(page, '3', 'Digit3', 51);
  await click(page, '#game-canvas canvas');
  await until(page, 'document.querySelectorAll("[data-hotbar-slot]")[2].dataset.itemId === ""');
  assert.equal(await evaluate(page, 'testScene.hotbar.selected().item'), null);
  assert.equal(await evaluate(page, 'testScene.services.controller.getView().health'), 90);
  assert.equal(
    await evaluate(
      page,
      'document.querySelectorAll("[data-hotbar-slot]")[2].querySelector(".hotbar-icon").innerHTML',
    ),
    '',
  );
  await screenshot(page, 'hotbar-consumed-empty');
  await press(page, '1', 'Digit1', 49);
  await click(page, '#game-canvas canvas');
  await until(page, 'testScene.combat.attackCooldown > 0');
  await press(page, '4', 'Digit4', 52);
  await until(page, 'testScene.hotbar.selectedIndex === 3');
  await click(page, '#game-canvas canvas');
  assert.equal(await evaluate(page, 'testScene.hotbar.selected().item'), null);
  await press(page, 'Escape', 'Escape', 27);
  await until(page, 'document.querySelector("#raid-settings").open');
  await press(page, '1', 'Digit1', 49);
  assert.equal(
    await evaluate(page, 'testScene.hotbar.selectedIndex'),
    3,
    'settings block slot switching',
  );
  await press(page, 'Escape', 'Escape', 27);
  await until(page, '!document.querySelector("#raid-settings").open');
  await click(page, '[data-hotbar-slot="2"]');
  await until(
    page,
    'document.querySelectorAll("[data-hotbar-slot]")[2].getAttribute("aria-pressed") === "true"',
  );
  assert.equal(
    await evaluate(page, 'testScene.hotbar.selected().item'),
    null,
    'clicking an empty slot selects empty hands',
  );
  const layout = await evaluate(
    page,
    `(() => {
    const bar=document.querySelector('#raid-hotbar').getBoundingClientRect();
    const interaction=document.querySelector('.interaction').getBoundingClientRect();
    return {bar:bar.toJSON(),interaction:interaction.toJSON(),width:innerWidth,height:innerHeight};
  })()`,
  );
  assert(
    layout.bar.x >= 0 && layout.bar.right <= layout.width && layout.bar.bottom <= layout.height,
  );
  assert(layout.interaction.bottom <= layout.bar.top, 'interaction text stays above shortcuts');
  await screenshot(page, 'hotbar-final');
  await evaluate(
    page,
    `(() => {
    const origin = {kind:'raid-loot',obtainedInRaidId:testScene.services.controller.getView().raidId};
    for (let i=0;i<2;i++) testScene.services.inventory.addLoot({instanceId:'hotbar-bike-'+i,itemId:'yellow-bike',origin});
    testScene.services.inventory.addLoot({instanceId:'hotbar-shield',itemId:'thick-down-jacket',origin});
  })()`,
  );
  await until(
    page,
    'testScene.hotbar.slots()[1].instanceId === "hotbar-bike-0" && testScene.hotbar.slots()[2].instanceId === "hotbar-bike-1"',
  );
  await press(page, '2', 'Digit2', 50);
  await click(page, '#game-canvas canvas');
  await until(page, 'document.querySelectorAll("[data-hotbar-slot]")[1].dataset.itemId === ""');
  assert.equal(await evaluate(page, 'testScene.services.controller.getMoveSpeedMultiplier()'), 1.3);
  assert.equal(await evaluate(page, 'testScene.hotbar.slots()[2].instanceId'), 'hotbar-bike-1');
  await press(page, '3', 'Digit3', 51);
  await click(page, '#game-canvas canvas');
  assert.equal(
    await evaluate(
      page,
      'testScene.services.inventory.getCarriedItems().filter(i=>i.itemId==="yellow-bike").length',
    ),
    1,
    'active speed boost rejects repeated use without consuming the other instance',
  );
  assert.equal(await evaluate(page, 'testScene.hotbar.slots()[2].instanceId'), 'hotbar-bike-1');
  await press(page, '4', 'Digit4', 52);
  await click(page, '#game-canvas canvas');
  await until(page, 'document.querySelectorAll("[data-hotbar-slot]")[3].dataset.itemId === ""');
  await screenshot(page, 'hotbar-utilities-used');
  assert.equal(page.errors.length, 0, 'no browser exceptions during hotbar flow');
  pass(
    'Four shortcuts: keyboard/click empty-hand selection, highlight, weapon attack, one instance per slot, consumed slots empty without refilling, no badges, and modal guards',
  );
  await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
}

async function verifyHotbarRebindingFlow() {
  for (const mobile of [false, true]) {
    const page = await newPage('bind' + (mobile ? 'mob' : 'pc'), { mobile });
    await consent(page);
    await click(page, '#start');
    await until(page, 'document.querySelector("#app").dataset.phase === "active"');
    await click(page, '#tutorial-skip');
    await attachScene(page);
    await evaluate(
      page,
      `(() => {
      testScene.combat.enemies=[]; testScene.combat.updateSpawns=()=>[];
      const raidId=testScene.services.controller.getView().raidId;
      const ids=['training-bat','bandage','thick-down-jacket','electric-bike-helmet','morning-coffee','portable-medkit'];
      const items=ids.map(itemId=>({instanceId:'rebind-'+itemId,itemId,origin:{kind:'carry-in'}}));
      testScene.services.inventory.begin(raidId,items.slice(1),{primary:items[0]});
      globalThis.rebindBefore=JSON.stringify(testScene.services.inventory.getCarriedItems());
    })()`,
    );
    await click(page, '#inventory [data-item-id="morning-coffee"] [data-hotbar-assign]');
    await until(page, 'document.querySelector("#raid-hotbar").dataset.assigning === "true"');
    await screenshot(page, 'hotbar-rebind-' + (mobile ? 'touch' : 'desktop') + '-choosing');
    await click(page, '[data-hotbar-slot="1"]');
    await until(
      page,
      'document.querySelectorAll("[data-hotbar-slot]")[1].dataset.itemId === "morning-coffee"',
    );
    assert.equal(
      await evaluate(page, 'JSON.stringify(testScene.services.inventory.getCarriedItems())'),
      await evaluate(page, 'rebindBefore'),
      'binding never consumes or drops inventory',
    );
    assert.equal(await evaluate(page, 'testScene.services.controller.getView().health'), 100);
    assert.equal(await evaluate(page, 'document.querySelector("#inventory-panel").hidden'), false);
    await click(page, '#inventory [data-item-id="portable-medkit"] [data-hotbar-assign]');
    if (mobile) await click(page, '[data-hotbar-slot="2"]');
    else await press(page, '3', 'Digit3', 51);
    await until(
      page,
      'document.querySelectorAll("[data-hotbar-slot]")[2].dataset.itemId === "portable-medkit"',
    );
    await click(page, '#inventory [data-item-id="bandage"] [data-hotbar-assign]');
    await press(page, 'Escape', 'Escape', 27);
    await until(page, 'document.querySelector("#raid-hotbar").dataset.assigning === "false"');
    assert.equal(
      await evaluate(page, 'document.querySelector("#inventory-panel").hidden'),
      false,
      'Esc cancels assignment before closing bag',
    );
    assert.equal(await evaluate(page, 'testScene.hotbar.slots()[1].itemId'), 'morning-coffee');
    await screenshot(page, 'hotbar-rebind-' + (mobile ? 'touch' : 'desktop') + '-complete');
    await press(page, 'Tab', 'Tab', 9);
    await until(page, 'document.querySelector("#inventory-panel").hidden');
    if (mobile) await click(page, '[data-hotbar-slot="1"]');
    else await press(page, '2', 'Digit2', 50);
    await until(page, 'testScene.hotbar.selectedIndex === 1');
    await evaluate(page, 'testScene.services.controller.applyDamage(25)');
    if (mobile) await click(page, '[data-touch-action="SPACE"]');
    else {
      if (!(await evaluate(page, '!!document.pointerLockElement')))
        await click(page, '#game-canvas canvas');
      await click(page, '#game-canvas canvas');
    }
    await until(
      page,
      '!testScene.services.inventory.getCarriedItems().some(item=>item.itemId==="morning-coffee")',
    );
    assert.equal(await evaluate(page, 'testScene.services.controller.getView().health'), 100);
    assert.equal(await evaluate(page, 'testScene.services.inventory.getCarriedItems().length'), 5);
    // Choose between two identical items through their actual backpack instance.
    await evaluate(
      page,
      `(() => {
        const raidId = testScene.services.controller.getView().raidId;
        const result = testScene.services.inventory.addLoot({instanceId:'rebind-bandage-extra',itemId:'bandage',origin:{kind:'raid-loot',obtainedInRaidId:raidId}});
        if (!result.ok) throw new Error('duplicate seed rejected');
      })()`,
    );
    await click(page, '#inventory [data-instance-id="rebind-bandage-extra"] [data-hotbar-assign]');
    await click(page, '[data-hotbar-slot="1"]');
    await until(page, 'testScene.hotbar.slots()[1].instanceId === "rebind-bandage-extra"');
    await click(page, '#inventory [data-instance-id="rebind-bandage"] [data-hotbar-assign]');
    await click(page, '[data-hotbar-slot="3"]');
    await until(page, 'testScene.hotbar.slots()[3].instanceId === "rebind-bandage"');
    await screenshot(page, 'hotbar-duplicates-' + (mobile ? 'touch' : 'desktop'));
    await press(page, 'Tab', 'Tab', 9);
    await until(page, 'document.querySelector("#inventory-panel").hidden');
    await evaluate(page, 'testScene.services.controller.applyDamage(25)');
    if (mobile) await click(page, '[data-touch-action="SPACE"]');
    else {
      if (!(await evaluate(page, '!!document.pointerLockElement')))
        await click(page, '#game-canvas canvas');
      await click(page, '#game-canvas canvas');
    }
    await until(
      page,
      'document.querySelectorAll("[data-hotbar-slot]")[1].dataset.instanceId === ""',
    );
    assert.equal(await evaluate(page, 'testScene.hotbar.selectedIndex'), 1);
    assert.equal(await evaluate(page, 'testScene.hotbar.slots()[3].instanceId'), 'rebind-bandage');
    assert.equal(
      await evaluate(
        page,
        'testScene.services.inventory.getCarriedItems().filter(i=>i.itemId==="bandage").length',
      ),
      1,
    );
    assert.equal(await evaluate(page, 'document.querySelectorAll(".hotbar-count").length'), 0);
    await screenshot(page, 'hotbar-duplicate-used-' + (mobile ? 'touch' : 'desktop'));
    assert.equal(page.errors.length, 0);
    pass(
      (mobile ? 'Touch' : 'Desktop') +
        ' full six-slot inventory: replace shortcuts with fifth/sixth tools, cancel with Esc, assign exact duplicate instances, and empty only the used slot',
    );
    await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
  }
}

async function verifyHealingFlow(itemId = 'bandage') {
  const coffee = itemId === 'morning-coffee';
  const view = coffee ? 'coffeeHealing' : 'bandageHealing';
  const elapsed = coffee ? 'coffeeHealingElapsedMs' : 'bandageHealingElapsedMs';
  const label = coffee ? 'coffee' : 'healing';
  for (const mobile of [false, true]) {
    const page = await newPage(`${coffee ? 'coffee' : 'heal'}${mobile ? 'mob' : 'pc'}`, { mobile });
    await consent(page);
    await click(page, '#start');
    await until(page, 'document.querySelector("#app").dataset.phase === "active"');
    await click(page, '#tutorial-skip');
    await attachScene(page);
    await evaluate(
      page,
      `(() => {
      testScene.combat.enemies = [];
      testScene.combat.updateSpawns = () => [];
      testScene.services.inventory.addLoot({
        instanceId: 'healing-smoke-bandage', itemId: '${itemId}',
        origin: {kind: 'raid-loot', obtainedInRaidId: testScene.services.controller.getView().raidId},
      });
    })()`,
    );
    await click(page, `#inventory [data-item-id="${itemId}"] button`);
    assert.equal(await evaluate(page, `testScene.frame().${elapsed}`), undefined);
    assert.equal(await evaluate(page, `testScene.view.${view}.sprite.visible`), false);
    assert(
      await evaluate(
        page,
        `testScene.services.inventory.getCarriedItems().some(i => i.itemId === "${itemId}")`,
      ),
    );
    await evaluate(page, 'testScene.services.controller.applyDamage(20)');
    await click(page, `#inventory [data-item-id="${itemId}"] button`);
    await evaluate(
      page,
      `(() => {
      if (!document.querySelector('#inventory-panel').hidden)
        document.querySelector('#toggle-inventory').click();
    })()`,
    );
    await until(
      page,
      `testScene.view.${view}.sprite.visible && testScene.view.${view}.sprite.material.opacity > 0.2`,
    );
    const healing = await evaluate(
      page,
      `(() => {
      const sprite = testScene.view.${view}.sprite;
      const texture = sprite.material.map;
      return {health: testScene.services.controller.getView().health,
        consumed: !testScene.services.inventory.getCarriedItems().some(i => i.itemId === '${itemId}'),
        image: [texture.image.naturalWidth, texture.image.naturalHeight],
        repeat: texture.repeat.toArray(), depthWrite: sprite.material.depthWrite,
        headClearance: sprite.position.y - sprite.scale.y / 2,
        position: sprite.position.toArray(), player: {...testScene.position}};
    })()`,
    );
    assert.equal(healing.health, coffee ? 100 : 90);
    assert(healing.consumed);
    assert.deepEqual(healing.image, [1024, 1024]);
    assert.deepEqual(healing.repeat, [0.25, 0.25]);
    assert.equal(healing.depthWrite, false);
    assert(healing.headClearance > 1.44);
    assert(Math.abs(healing.position[0] - healing.player.x / 32) < 0.001);
    assert(Math.abs(healing.position[2] - healing.player.y / 32) < 0.001);
    await screenshot(page, `${label}-${mobile ? 'mobile' : 'desktop'}-active`);
    await until(page, `!testScene.view.${view}.sprite.visible`);
    assert.equal(await evaluate(page, `testScene.frame().${elapsed}`), undefined);
    await screenshot(page, `${label}-${mobile ? 'mobile' : 'desktop'}-finished`);
    pass(
      `${mobile ? 'Mobile' : 'Desktop'} ${itemId}: full-health rejection, successful use, transparent sheet, head clearance, and animation completion`,
    );
    await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
  }
}

async function verifyRulerEffectFlow() {
  for (const mobile of [false, true]) {
    const page = await newPage(mobile ? 'rulermob' : 'rulerpc', { mobile });
    await consent(page);
    await click(page, '#start');
    await until(page, 'document.querySelector("#app").dataset.phase === "active"');
    await until(
      page,
      '!document.querySelector(".explore-loader") || document.querySelector(".explore-loader").hidden',
    );
    await click(page, '#tutorial-skip');
    await attachScene(page);
    if (!mobile)
      await command(
        'Emulation.setDeviceMetricsOverride',
        { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false },
        page.id,
      );
    await evaluate(
      page,
      `(() => {
      const combat = testScene.combat;
      const map = combat.map();
      const source = combat.enemies.find(e => e.kind === 'patrol' && e.species !== 'cat');
      if (!source) throw Error('No patrol target');
      globalThis.rulerTarget = structuredClone(source);
      combat.enemies = [];
      combat.updateSpawns = () => [];
      // Keep real attack collision/damage/cooldowns, hold enemy movement for stable screenshots.
      combat.update = (dt) => { combat.tick(Math.min(100,dt)); return {
        damage:0,calmed:[],slowHit:false,tinnitusHit:false,soundWaveHit:false,amplifierWindups:[]}; };
      const origin = testScene.position;
      const clear = p => !map.obstacles.some(r => p.x+65>r.x && p.x-65<r.x+r.width && p.y+65>r.y && p.y-65<r.y+r.height);
      let found;
      for(let dy=-160;dy<=160&&!found;dy+=40) for(let dx=-160;dx<=160&&!found;dx+=40) {
        const p={x:origin.x+dx,y:origin.y+dy};
        if(p.x>100&&p.y>100&&p.x<map.width-100&&p.y<map.height-100&&clear(p))found=p;
      }
      if(!found)throw Error('No clear ruler test area');
      testScene.position=found; testScene.aim=-Math.PI/2; testScene.view.resetCamera();
      testScene.services.inventory.addLoot({instanceId:'ruler-vfx',itemId:'folding-ruler',
        origin:{kind:'raid-loot',obtainedInRaidId:testScene.services.controller.getView().raidId}});
      testScene.syncHotbar(); testScene.assignQuickSlot(0,'ruler-vfx');testScene.selectQuickSlot(0);
      globalThis.rulerClock=Date.now(); testScene.clock=()=>rulerClock;
      globalThis.rulerInput={move:{x:0,y:0},aim:-Math.PI/2,interact:false,attack:false,hug:false,flashlight:false,refill:false,flare:false};
      globalThis.rulerStrike=(aim=-Math.PI/2)=>{
        combat.attackCooldown=0; testScene.hitStopMs=0; rulerClock+=400;
        testScene.tick(0,{...rulerInput,aim,attack:true});rulerClock+=60;
      };
    })()`,
    );
    await until(
      page,
      'document.querySelectorAll("[data-hotbar-slot]")[0].dataset.instanceId === "ruler-vfx"',
    );
    await until(page, 'document.querySelector("#notice").hidden');
    await evaluate(page, 'rulerStrike(0)');
    await until(page, 'testScene.view.rulerEffect.slash.visible');
    assert.equal(
      await evaluate(page, 'testScene.view.rulerEffect.sparks.some(s=>s.visible)'),
      false,
    );
    const atlas = await evaluate(
      page,
      `(() => {
      const effect=testScene.view.rulerEffect;const image=effect.slash.material.map.image;
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
      const pixels=ctx.getImageData(0,0,c.width,c.height).data;
      let transparent=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]===0)transparent++;
      return {size:[image.width,image.height],transparent:transparent/(c.width*c.height),depthWrite:effect.slash.material.depthWrite,src:image.src};
    })()`,
    );
    assert.deepEqual(atlas.size, [1024, 512]);
    assert(atlas.transparent > 0.85);
    assert.equal(atlas.depthWrite, false);
    assert(atlas.src.includes('ruler-slash.png'));
    if (!mobile)
      assert(
        await evaluate(
          page,
          'document.documentElement.scrollWidth === document.documentElement.clientWidth && document.documentElement.scrollHeight === document.documentElement.clientHeight',
        ),
      );
    await screenshot(page, `ruler-${mobile ? 'mobile' : 'desktop'}-miss`);
    await evaluate(
      page,
      `(() => {
      rulerTarget.position={x:testScene.position.x+40,y:testScene.position.y};
      rulerTarget.health=70;rulerTarget.state='patrol';testScene.combat.enemies=[rulerTarget];
      rulerStrike(0);
    })()`,
    );
    await until(page, 'testScene.view.rulerEffect.sparks.some(s=>s.visible)');
    assert.equal(await evaluate(page, 'rulerTarget.health'), 50);
    assert.equal(await evaluate(page, 'testScene.frame().rulerEffect.hits.length'), 1);
    const locked = await evaluate(page, 'structuredClone(testScene.frame().rulerEffect)');
    await evaluate(page, 'testScene.tick(0,{...rulerInput,aim:Math.PI,attack:true})');
    assert.deepEqual(
      await evaluate(page, 'structuredClone(testScene.frame().rulerEffect)'),
      locked,
    );
    await screenshot(page, `ruler-${mobile ? 'mobile' : 'desktop'}-hit`);
    if (!mobile)
      for (const [width, height] of [
        [1440, 900],
        [1024, 576],
      ]) {
        await command(
          'Emulation.setDeviceMetricsOverride',
          { width, height, deviceScaleFactor: 1, mobile: false },
          page.id,
        );
        await delay(250);
        assert(
          await evaluate(
            page,
            'document.documentElement.scrollWidth === document.documentElement.clientWidth && document.documentElement.scrollHeight === document.documentElement.clientHeight',
          ),
        );
        await screenshot(page, `ruler-desktop-${width}x${height}`);
      }
    for (const aim of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      await evaluate(page, `(() => {testScene.combat.enemies=[];rulerStrike(${aim});})()`);
      await until(
        page,
        `(() => {
        const s=testScene.view.rulerEffect.slash;const o=testScene.position;
        const camera=testScene.view.overview?testScene.view.camera:testScene.view.followCamera;
        const up=camera.matrixWorld.elements;
        return s.visible && Math.abs(s.position.x-o.x/32-up[4]*1.8)<.001 &&
          Math.abs(s.position.y-.03-up[5]*1.8)<.001 &&
          Math.abs(s.position.z-o.y/32-up[6]*1.8)<.001;
      })()`,
      );
      const p = await evaluate(page, 'testScene.view.rulerEffect.slash.position.toArray()');
      const origin = await evaluate(page, 'testScene.position');
      const up = await evaluate(
        page,
        `(() => {
        const c=testScene.view.overview?testScene.view.camera:testScene.view.followCamera;
        return c.matrixWorld.elements.slice(4,7);
      })()`,
      );
      assert(Math.abs(p[0] - origin.x / 32 - up[0] * 1.8) < 0.001);
      assert(Math.abs(p[1] - 0.03 - up[1] * 1.8) < 0.001);
      assert(Math.abs(p[2] - origin.y / 32 - up[2] * 1.8) < 0.001);
      assert.equal(
        await evaluate(page, 'testScene.view.rulerEffect.slash.material.depthTest'),
        false,
      );
    }
    await evaluate(page, 'rulerClock+=200');
    await until(
      page,
      '!testScene.view.rulerEffect.slash.visible && !testScene.view.rulerEffect.sparks.some(s=>s.visible)',
    );
    // Real player input must also produce the effect, on keyboard and touch respectively.
    await evaluate(page, 'testScene.combat.attackCooldown=0;testScene.hitStopMs=0');
    if (mobile) await touchDrag(page, '[data-touch-action="SPACE"]', 0, 0);
    else await press(page, ' ', 'Space', 32);
    await until(page, 'testScene.view.rulerEffect.slash.visible');
    await evaluate(page, 'rulerClock+=60');
    await screenshot(page, `ruler-${mobile ? 'mobile' : 'desktop'}-input`);
    await click(page, '#open-raid-settings');
    await until(page, '!testScene.view.rulerEffect.slash.visible');
    await evaluate(page, 'rulerClock+=200');
    await click(page, '#resume-raid');
    await until(page, '!testScene.view.rulerEffect.slash.visible');
    await screenshot(page, `ruler-${mobile ? 'mobile' : 'desktop'}-finished`);
    pass(
      `${mobile ? 'Mobile' : 'Desktop'} ruler: transparent eight-frame sheets, real damage/miss, locked aim, four directions, expiry, pause, and player attack input`,
    );
    await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
  }
}

async function verifyQuickNoteFlow() {
  for (const mobile of [false, true]) {
    const page = await newPage(mobile ? 'notemob' : 'notepc', { mobile });
    await consent(page);
    await click(page, '#start');
    await until(page, 'document.querySelector("#app").dataset.phase === "active"');
    await until(
      page,
      '!document.querySelector(".explore-loader") || document.querySelector(".explore-loader").hidden',
    );
    await click(page, '#tutorial-skip');
    await attachScene(page);
    if (!mobile)
      await command(
        'Emulation.setDeviceMetricsOverride',
        { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false },
        page.id,
      );
    const points = await evaluate(
      page,
      `(() => {
      testScene.combat.enemies=[];testScene.combat.updateSpawns=()=>[];
      for(const id of ['note-a','note-b'])testScene.services.inventory.addLoot({instanceId:id,itemId:'quick-note-card',origin:{kind:'raid-loot',obtainedInRaidId:testScene.services.controller.getView().raidId}});
      return testScene.searchPoints.filter(p=>p.tier==='normal').slice(0,3);
    })()`,
    );
    assert.equal(await evaluate(page, 'testScene.view.quickNoteEffect.ready.visible'), false);
    await click(page, '#inventory [data-item-id="quick-note-card"] button');
    await evaluate(
      page,
      `(() => {if(!document.querySelector('#inventory-panel').hidden)document.querySelector('#toggle-inventory').click();})()`,
    );
    await until(
      page,
      'testScene.view.quickNoteEffect.activation.sprite.visible && testScene.view.quickNoteEffect.activation.sprite.material.opacity>0.2',
    );
    assert.equal(
      await evaluate(
        page,
        "testScene.services.inventory.getCarriedItems().filter(i=>i.itemId==='quick-note-card').length",
      ),
      1,
    );
    assert.equal(await evaluate(page, 'testScene.frame().quickNoteEffect.status'), 'ready');
    await screenshot(page, `quick-note-${mobile ? 'mobile' : 'desktop'}-activation`);
    await until(
      page,
      '!testScene.view.quickNoteEffect.activation.sprite.visible && testScene.view.quickNoteEffect.ready.visible',
    );
    await click(page, '#inventory [data-item-id="quick-note-card"] button');
    assert.equal(
      await evaluate(
        page,
        "testScene.services.inventory.getCarriedItems().filter(i=>i.itemId==='quick-note-card').length",
      ),
      1,
    );
    assert(await evaluate(page, 'testScene.frame().quickNoteEffect.elapsedMs>=1000'));
    await evaluate(
      page,
      `(() => {if(!document.querySelector('#inventory-panel').hidden)document.querySelector('#toggle-inventory').click();})()`,
    );
    if (!mobile) {
      await move(page, 120);
      await evaluate(page, 'testScene.view.orbitCamera(180,0)');
      await delay(250);
      assert(
        await evaluate(
          page,
          `(() => {
        const v=testScene.view,c=v.followCamera.matrixWorld.elements,p=testScene.position,b=v.quickNoteEffect.ready.position;
        return Math.abs(b.x-(p.x/32+c[0]*0.65))<0.001 && Math.abs(b.z-(p.y/32+c[2]*0.65))<0.001;
      })()`,
        ),
      );
    }
    await screenshot(page, `quick-note-${mobile ? 'mobile' : 'desktop'}-ready`);
    if (!mobile)
      for (const [width, height] of [
        [1440, 900],
        [1024, 576],
      ]) {
        await command(
          'Emulation.setDeviceMetricsOverride',
          { width, height, deviceScaleFactor: 1, mobile: false },
          page.id,
        );
        await delay(120);
        assert(
          await evaluate(
            page,
            'document.documentElement.scrollWidth===document.documentElement.clientWidth && document.documentElement.scrollHeight===document.documentElement.clientHeight',
          ),
        );
        await screenshot(page, `quick-note-desktop-${width}x${height}`);
      }
    await standAt(page, points[0]);
    await command(
      'Input.dispatchKeyEvent',
      { type: 'keyDown', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69 },
      page.id,
    );
    await until(page, 'testScene.frame().quickNoteEffect?.status === "searching"');
    await screenshot(page, `quick-note-${mobile ? 'mobile' : 'desktop'}-searching`);
    await until(page, `testScene.search.isOpened('${points[0].id}')`);
    await command(
      'Input.dispatchKeyEvent',
      { type: 'keyUp', key: 'e', code: 'KeyE', windowsVirtualKeyCode: 69 },
      page.id,
    );
    await until(
      page,
      '!testScene.frame().quickNoteEffect && !testScene.view.quickNoteEffect.ready.visible',
    );
    await screenshot(page, `quick-note-${mobile ? 'mobile' : 'desktop'}-finished`);
    // The following ordinary search does not retain the bonus.
    await standAt(page, points[1]);
    await interact(page, 1200);
    assert.equal(await evaluate(page, `testScene.search.isOpened('${points[1].id}')`), false);
    await interact(page, 2200);
    assert.equal(await evaluate(page, `testScene.search.isOpened('${points[1].id}')`), true);
    // A second successful card use can prepare another bonus; cancellation spends it as before.
    await click(page, '#inventory [data-item-id="quick-note-card"] button');
    await evaluate(
      page,
      `(() => {if(!document.querySelector('#inventory-panel').hidden)document.querySelector('#toggle-inventory').click();})()`,
    );
    await until(page, 'testScene.view.quickNoteEffect.ready.visible');
    await standAt(page, points[2]);
    await interact(page, 250);
    await until(
      page,
      '!testScene.frame().quickNoteEffect && !testScene.view.quickNoteEffect.ready.visible',
    );
    pass(
      `${mobile ? 'Mobile' : 'Desktop'} quick note: successful use, one-shot atlas, persistent ready badge, rejected duplicate, movement/camera follow, shortened search, completion cleanup, normal next search and interruption cleanup`,
    );
    await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
  }
}

async function verifySpawningFlow() {
  const page = await newPage('spawning');
  await consent(page);
  await click(page, '#start');
  await until(page, 'document.querySelector("#app").dataset.phase === "active"');
  await until(
    page,
    '!document.querySelector(".explore-loader") || document.querySelector(".explore-loader").hidden',
  );
  await click(page, '#tutorial-skip');
  await attachScene(page);
  const initial = await evaluate(
    page,
    `(() => {
    const combat=testScene.combat; const savedSpawn=combat.updateSpawns.bind(combat);
    combat.updateSpawns=()=>[];
    combat.update=()=>({damage:0,calmed:[],slowHit:false,tinnitusHit:false,soundWaveHit:false,amplifierWindups:[]});
    const amps=combat.enemies.filter(e=>e.kind==='amplifier');
    globalThis.initialEnemies=combat.enemies; globalThis.spawnMap=combat.map(); globalThis.spawnBatch=savedSpawn;
    const library=amps.find(e=>e.id==='library-amplifier');
    testScene.position={x:library.home.x,y:library.home.y+200}; testScene.aim=-Math.PI/2; testScene.lighting.enabled=true;testScene.view.resetCamera();
    return {count:combat.enemies.length,amps:amps.map(e=>({id:e.id,home:e.home})),reachable:spawnMap.canSpawn(library.home)};
  })()`,
  );
  assert.equal(initial.count, 12);
  assert.equal(initial.amps.length, 2);
  assert.equal(initial.reachable, true);
  assert.deepEqual(initial.amps.find((e) => e.id === 'library-amplifier').home, {
    x: 2700,
    y: 1070,
  });
  assert.deepEqual(initial.amps.find((e) => e.id === 'central-amplifier').home, {
    x: 1060,
    y: 1520,
  });
  for (const [width, height] of [
    [1280, 720],
    [1440, 900],
    [1024, 576],
  ]) {
    await command(
      'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile: false },
      page.id,
    );
    await delay(200);
    assert(
      await evaluate(
        page,
        'document.documentElement.scrollWidth===document.documentElement.clientWidth && document.documentElement.scrollHeight===document.documentElement.clientHeight',
      ),
    );
    await screenshot(page, 'library-amplifier-' + width + 'x' + height);
  }
  const batch = await evaluate(
    page,
    `(() => {
    const c=testScene.combat; c.enemies=[];c.spawnTimer=0;c.amplifierSpawnTimer=Infinity;c.hugSpawnTimer=80000;
    let cursor=0;const candidates=[];
    for(let y=100;y<spawnMap.height-100;y+=220)for(let x=100;x<spawnMap.width-100;x+=220){const p={x,y};if(spawnMap.canSpawn(p))candidates.push(p);}
    const find=()=>candidates[cursor++]??null;
    const ordinary=spawnBatch(0,find);c.spawnTimer=Infinity;
    const before=spawnBatch(79999,find); const hugs=spawnBatch(1,find); const repeated=spawnBatch(0,find);
    const result={ordinary:ordinary.map(e=>e.kind),before:before.length,hugs:hugs.map(e=>e.kind),repeated:repeated.length};
    c.enemies=initialEnemies;return result;
  })()`,
  );
  assert.deepEqual(batch.ordinary, Array(6).fill('patrol'));
  assert.equal(batch.before, 0);
  assert.deepEqual(batch.hugs, Array(3).fill('hug'));
  assert.equal(batch.repeated, 0);
  pass(
    'Initial library and central amplifiers; six ordinary spawns, three hugs at 80 seconds; three desktop viewports without scroll',
  );
}

async function verifyCatFlow() {
  for (const mobile of [false, true]) {
    const page = await newPage(mobile ? 'catmob' : 'catpc', { mobile });
    await consent(page);
    await click(page, '#start');
    await until(page, 'document.querySelector("#app").dataset.phase === "active"');
    await until(
      page,
      '!document.querySelector(".explore-loader") || document.querySelector(".explore-loader").hidden',
    );
    await click(page, '#tutorial-skip');
    await attachScene(page);
    await evaluate(
      page,
      `(() => {
      const combat = testScene.combat;
      const cat = combat.enemies.find(e => e.species === 'cat');
      if (!cat) throw Error('No cat generated');
      globalThis.catTest = cat;
      globalThis.catStep = combat.update.bind(combat);
      globalThis.catMap = combat.map();
      combat.updateSpawns = () => [];
      combat.enemies = [cat];
      combat.update = () => ({damage:0, calmed:[], slowHit:false, tinnitusHit:false, soundWaveHit:false, amplifierWindups:[]});
      const clear = p => !catMap.obstacles.some(r => p.x+20>r.x && p.x-20<r.x+r.width && p.y+20>r.y && p.y-20<r.y+r.height);
      const origin = testScene.position;
      let found;
      for(let dy=-200;dy<=200&&!found;dy+=40) for(let dx=-200;dx<=200&&!found;dx+=40) {
        const p={x:origin.x+dx,y:origin.y+dy};
        if(p.x<100||p.y<100||p.x>catMap.width-100||p.y>catMap.height-200) continue;
        if(Array.from({length:11},(_,i)=>({x:p.x,y:p.y+i*10})).every(clear)) found=p;
      }
      if(!found) throw Error('No open ambush test lane');
      cat.position={...found};cat.home={...found};cat.state='lurking';cat.cooldown=0;
      testScene.position={x:found.x,y:found.y+200};
      testScene.aim=-Math.PI/2;
      testScene.lighting.enabled=true;
      testScene.view.resetCamera();
      globalThis.stepCat = (ms) => {
        let damage=0;
        for(let t=0;t<ms;t+=20) damage+=catStep(Math.min(20,ms-t),testScene.position,true,false,true,catMap.obstacles,{x:0,y:0,width:catMap.width,height:catMap.height}).damage;
        return damage;
      };
      stepCat(1000);
    })()`,
    );
    assert.equal(await evaluate(page, 'catTest.state'), 'lurking');
    await until(
      page,
      'testScene.view.enemyView.visuals.get(catTest.id)?.body.material.opacity === 0.18',
    );
    assert.equal(
      await evaluate(page, 'testScene.view.enemyView.visuals.get(catTest.id).health.visible'),
      false,
    );
    assert.equal(
      await evaluate(page, 'testScene.view.enemyView.visuals.get(catTest.id).ring.visible'),
      false,
    );
    assert.equal(
      await evaluate(page, 'testScene.view.enemyView.visuals.get(catTest.id).billboard.scale.x'),
      0.65,
    );
    const sizes = mobile
      ? [[390, 844]]
      : [
          [1280, 720],
          [1440, 900],
          [1024, 576],
        ];
    for (const [width, height] of sizes) {
      await command(
        'Emulation.setDeviceMetricsOverride',
        { width, height, deviceScaleFactor: 1, mobile },
        page.id,
      );
      await delay(200);
      assert(
        await evaluate(
          page,
          'document.documentElement.scrollWidth===document.documentElement.clientWidth && document.documentElement.scrollHeight===document.documentElement.clientHeight',
        ),
      );
      await screenshot(page, 'cat-lurking-' + width + 'x' + height);
    }
    await evaluate(
      page,
      'testScene.position={x:catTest.position.x,y:catTest.position.y+100};testScene.view.resetCamera();stepCat(20)',
    );
    assert.equal(await evaluate(page, 'catTest.state'), 'windup');
    await until(page, 'testScene.view.enemyView.visuals.get(catTest.id).label.visible');
    await screenshot(page, mobile ? 'cat-mobile-warning' : 'cat-desktop-warning');
    await evaluate(page, 'stepCat(220)');
    assert.equal(await evaluate(page, 'catTest.state'), 'pouncing');
    assert.equal(await evaluate(page, 'stepCat(320)'), 14);
    assert.equal(await evaluate(page, 'catTest.state'), 'vanished');
    await until(page, '!testScene.view.enemyView.visuals.get(catTest.id).root.visible');
    await screenshot(page, mobile ? 'cat-mobile-vanished' : 'cat-desktop-vanished');
    await evaluate(page, 'stepCat(1200)');
    assert.equal(await evaluate(page, 'catTest.state'), 'lurking');
    await until(
      page,
      'testScene.view.enemyView.visuals.get(catTest.id).body.material.opacity===0.18',
    );
    pass(
      (mobile ? 'Mobile' : 'Desktop') +
        ' cat: proximity ambush, small silhouette, hidden markers, telegraph, fast pounce, single damage, invisibility and return; zero page scroll',
    );
    await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
  }
}

async function verifyDetectorFlow() {
  for (const mobile of [false, true]) {
    const page = await newPage(mobile ? 'detectmob' : 'detectpc', { mobile });
    await consent(page);
    await click(page, '#start');
    await until(page, 'document.querySelector("#app").dataset.phase === "active"');
    await until(
      page,
      '!document.querySelector(".explore-loader") || document.querySelector(".explore-loader").hidden',
    );
    await click(page, '#tutorial-skip');
    await attachScene(page);
    if (!mobile)
      await command(
        'Emulation.setDeviceMetricsOverride',
        {
          width: 1280,
          height: 720,
          deviceScaleFactor: 1,
          mobile: false,
        },
        page.id,
      );
    const nearest = await evaluate(
      page,
      `(() => {
      testScene.combat.enemies=[]; testScene.combat.updateSpawns=()=>[];
      const p=testScene.position;
      const target=[...testScene.searchPoints].filter(c=>!testScene.search.isOpened(c.id))
        .sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
      for (const id of ['detector-a','detector-b']) testScene.services.inventory.addLoot({
        instanceId:id,itemId:'simple-detector',origin:{kind:'raid-loot',obtainedInRaidId:testScene.services.controller.getView().raidId}});
      return {x:target.x,y:target.y};
    })()`,
    );
    assert.equal(await evaluate(page, 'testScene.view.detectorEffect.marker.visible'), false);
    await click(page, '#inventory [data-item-id="simple-detector"] button');
    await evaluate(
      page,
      `(() => {if(!document.querySelector('#inventory-panel').hidden) document.querySelector('#toggle-inventory').click();})()`,
    );
    await until(
      page,
      'testScene.view.detectorEffect.activation.sprite.visible && testScene.view.detectorEffect.marker.visible',
    );
    const used = await evaluate(
      page,
      `(() => {
      const v=testScene.view.detectorEffect, state=testScene.frame().detectorEffect;
      return {target:state.target,remaining:state.remainingMs,count:testScene.services.inventory.getCarriedItems().filter(i=>i.itemId==='simple-detector').length,
        sizes:[v.activation.sprite.material.map.image.naturalWidth,v.marker.material.map.image.naturalWidth],
        headClearance:v.activation.sprite.position.y-v.activation.sprite.scale.y/2};
    })()`,
    );
    assert.deepEqual(used.target, nearest);
    assert.equal(used.count, 1);
    assert(used.remaining > 6500 && used.remaining <= 8000);
    assert.deepEqual(used.sizes, [1024, 256]);
    assert(used.headClearance > 1.44);
    await screenshot(page, `detector-${mobile ? 'mobile' : 'desktop'}-activation`);
    await until(page, '!testScene.view.detectorEffect.activation.sprite.visible');
    await click(page, '#inventory [data-item-id="simple-detector"] button');
    assert.equal(
      await evaluate(
        page,
        "testScene.services.inventory.getCarriedItems().filter(i=>i.itemId==='simple-detector').length",
      ),
      1,
    );
    assert(await evaluate(page, 'testScene.frame().detectorEffect.elapsedMs>=1200'));
    await evaluate(
      page,
      `(() => {if(!document.querySelector('#inventory-panel').hidden) document.querySelector('#toggle-inventory').click();})()`,
    );
    if (!mobile) await move(page, 120);
    const before = await evaluate(page, 'testScene.view.detectorEffect.marker.material.rotation');
    await evaluate(page, 'testScene.view.orbitCamera(240,0)');
    await delay(300);
    const after = await evaluate(page, 'testScene.view.detectorEffect.marker.material.rotation');
    assert(Math.abs(after - before) > 0.2, 'pointer responds to camera orbit');
    assert(
      await evaluate(
        page,
        `(() => {
      const v=testScene.view, m=v.detectorEffect.marker, c=v.followCamera.matrixWorld.elements;
      const p=testScene.position,t=testScene.frame().detectorEffect.target;
      const x=(t.x-p.x)*c[0]+(t.y-p.y)*c[2], y=(t.x-p.x)*c[4]+(t.y-p.y)*c[6];
      return Math.abs(m.material.rotation-Math.atan2(-x,y))<0.001;
    })()`,
      ),
      'screen arrow points toward target after orbit and movement',
    );
    await screenshot(page, `detector-${mobile ? 'mobile' : 'desktop'}-direction`);
    if (!mobile) {
      for (const [width, height] of [
        [1440, 900],
        [1024, 576],
      ]) {
        await command(
          'Emulation.setDeviceMetricsOverride',
          { width, height, deviceScaleFactor: 1, mobile: false },
          page.id,
        );
        await delay(120);
        assert(
          await evaluate(
            page,
            'document.documentElement.scrollWidth===document.documentElement.clientWidth && document.documentElement.scrollHeight===document.documentElement.clientHeight',
          ),
        );
        await screenshot(page, `detector-desktop-${width}x${height}`);
      }
    }
    await until(
      page,
      '!testScene.view.detectorEffect.marker.visible && !testScene.frame().detectorEffect',
    );
    await screenshot(page, `detector-${mobile ? 'mobile' : 'desktop'}-expired`);
    // The second detector is now usable. Investigating its selected box removes the pointer.
    await click(page, '#inventory [data-item-id="simple-detector"] button');
    await until(page, '!!testScene.frame().detectorEffect');
    await evaluate(
      page,
      `(() => {
      const target=testScene.frame().detectorEffect.target;
      const box=testScene.searchPoints.find(p=>p.x===target.x && p.y===target.y);
      testScene.search.markOpened(box.id);
    })()`,
    );
    await until(
      page,
      '!testScene.view.detectorEffect.marker.visible && !testScene.frame().detectorEffect',
    );
    // No targets: failed use must leave the item untouched and show no activation.
    await evaluate(
      page,
      `(() => {
      for(const box of testScene.searchPoints)testScene.search.markOpened(box.id);
      testScene.services.inventory.addLoot({instanceId:'no-target',itemId:'simple-detector',origin:{kind:'raid-loot',obtainedInRaidId:testScene.services.controller.getView().raidId}});
      testScene.detectorUntilMs=0;
    })()`,
    );
    await click(page, '#inventory [data-item-id="simple-detector"] button');
    assert(
      await evaluate(
        page,
        "testScene.services.inventory.getCarriedItems().some(i=>i.instanceId==='no-target') && !testScene.frame().detectorEffect",
      ),
    );
    pass(
      `${mobile ? 'Mobile' : 'Desktop'} detector: activation, nearest chest, successful consumption, rejected repeat, camera-relative direction, eight-second expiry, investigated target and no-target rejection`,
    );
    await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
  }
}

async function verifyUtilityEffectsFlow(boostItem = 'yellow-bike') {
  const skates = boostItem === 'roller-skates';
  const visual = skates ? 'skates' : 'bike';
  const label = skates ? 'skates' : 'utility';
  for (const mobile of [false, true]) {
    const page = await newPage(`${skates ? 'skate' : 'util'}${mobile ? 'mob' : 'pc'}`, { mobile });
    await consent(page);
    await click(page, '#start');
    await until(page, 'document.querySelector("#app").dataset.phase === "active"');
    await click(page, '#tutorial-skip');
    await attachScene(page);
    await evaluate(
      page,
      `(() => {
      testScene.combat.enemies = [];
      testScene.combat.updateSpawns = () => [];
      for (const [instanceId,itemId] of [['bike-a','${boostItem}'],['bike-b','${boostItem}'],['jacket-a','thick-down-jacket']])
        testScene.services.inventory.addLoot({instanceId,itemId,
          origin:{kind:'raid-loot',obtainedInRaidId:testScene.services.controller.getView().raidId}});
    })()`,
    );
    await click(page, `#inventory [data-item-id="${boostItem}"] button`);
    assert.equal(
      await evaluate(page, 'testScene.services.controller.getMoveSpeedMultiplier()'),
      skates ? 1.15 : 1.3,
    );
    await click(page, `#inventory [data-item-id="${boostItem}"] button`);
    assert.equal(
      await evaluate(
        page,
        `testScene.services.inventory.getCarriedItems().filter(i => i.itemId === "${boostItem}").length`,
      ),
      1,
    );
    await click(page, '#inventory [data-item-id="thick-down-jacket"] button');
    await evaluate(
      page,
      `(() => {
      if (!document.querySelector('#inventory-panel').hidden) document.querySelector('#toggle-inventory').click();
    })()`,
    );
    await until(
      page,
      'testScene.frame().utilityEffects.length === 2 && testScene.frame().utilityEffects.every(e => e.phase === "loop")',
    );
    const active = await evaluate(
      page,
      `(() => {
      const v = testScene.view.utilityEffects;
      const image = v.shield.material.map.image;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0);
      return {bike:v.${visual}.visible, shield:v.shield.visible, badge:v.jacketBadge.visible,
        clearCenter:ctx.getImageData(128,384,1,1).data[3],
        image:[image.naturalWidth,image.naturalHeight],
        health:testScene.services.controller.getView().health,
        jacketConsumed:!testScene.services.inventory.getCarriedItems().some(i => i.itemId === 'thick-down-jacket')};
    })()`,
    );
    assert(active.bike && active.shield && !active.badge);
    assert(active.jacketConsumed);
    assert.equal(active.clearCenter, 0);
    assert.equal(active.health, 100);
    assert.deepEqual(active.image, [1024, 1024]);
    await screenshot(page, `${label}-${mobile ? 'mobile' : 'desktop'}-active`);
    if (!mobile) {
      await move(page, 150);
      const following = await evaluate(
        page,
        `(() => {
        const v=testScene.view.utilityEffects, p=testScene.position;
        return Math.abs(v.${visual}.position.x-p.x/32)<0.001 && Math.abs(v.shield.position.z-p.y/32)<0.001;
      })()`,
      );
      assert(following, 'both effects follow real movement');
    }
    await evaluate(page, 'testScene.services.controller.applyDamage(10)');
    assert.equal(
      await evaluate(
        page,
        'testScene.frame().utilityEffects.find(e => e.itemId === "thick-down-jacket").phase',
      ),
      'loop',
    );
    await evaluate(page, 'testScene.services.controller.applyDamage(20)');
    assert.equal(await evaluate(page, 'testScene.services.controller.getView().health'), 100);
    assert.equal(
      await evaluate(
        page,
        'testScene.frame().utilityEffects.find(e => e.itemId === "thick-down-jacket").phase',
      ),
      'end',
    );
    await screenshot(page, `${label}-${mobile ? 'mobile' : 'desktop'}-shield-break`);
    await until(page, '!testScene.view.utilityEffects.shield.visible');
    await until(
      page,
      `testScene.frame().utilityEffects.some(e => e.itemId === "${boostItem}" && e.phase === "end")`,
    );
    assert.equal(await evaluate(page, 'testScene.services.controller.getMoveSpeedMultiplier()'), 1);
    await until(
      page,
      `testScene.frame().utilityEffects.length === 0 && !testScene.view.utilityEffects.${visual}.visible`,
    );
    await screenshot(page, `${label}-${mobile ? 'mobile' : 'desktop'}-finished`);
    pass(
      `${mobile ? 'Mobile' : 'Desktop'} ${boostItem} effects: successful consumption, rejected repeat boost, simultaneous loops, clear shield center, depletion without health loss, and five-second expiry`,
    );
    await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
  }
}

async function verifyChestTiersFlow() {
  for (const mobile of [false, true]) {
    const page = await newPage(mobile ? 'chestmob' : 'chestpc', { mobile });
    await consent(page);
    await click(page, '#start');
    await until(page, 'document.querySelector("#app").dataset.phase === "active"');
    await click(page, '#tutorial-skip');
    await attachScene(page);
    const layout = await evaluate(
      page,
      `({
      threshold: testScene.services.controller.getView().threshold,
      progressMax: document.querySelector('#value-progress').max,
      points: testScene.searchPoints.filter(p => p.tier),
      textures: testScene.searchPoints.filter(p => p.tier).map(p => ({ tier:p.tier,
        src:testScene.view.chests.get(p.id).texture.image.src,
        size:[testScene.view.chests.get(p.id).texture.image.width,testScene.view.chests.get(p.id).texture.image.height],
        frame:testScene.view.chests.get(p.id).texture.offset.x }))
    })`,
    );
    assert.equal(layout.threshold, 200);
    assert.equal(layout.progressMax, 200);
    assert.deepEqual(
      ['normal', 'intermediate', 'advanced'].map(
        (t) => layout.points.filter((p) => p.tier === t).length,
      ),
      [6, 4, 1],
    );
    for (const texture of layout.textures) {
      assert(
        texture.src.includes(
          texture.tier === 'normal' ? 'treasure-chest.png' : `treasure-chest-${texture.tier}.png`,
        ),
      );
      assert.deepEqual(texture.size, [1536, 256]);
      assert.equal(texture.frame, 2 / 6);
    }
    for (const [tier, duration] of [
      ['normal', 2000],
      ['intermediate', 4000],
      ['advanced', 6000],
    ]) {
      const point = layout.points.find((p) => p.tier === tier);
      await standAt(page, point);
      await until(page, `testScene.frame().visibleChests.includes('${point.id}')`);
      assert((await evaluate(page, 'testScene.interaction')).includes(`${duration / 1000} 秒`));
      await screenshot(page, `chest-${tier}-${mobile ? 'mobile' : 'desktop'}-closed`);
      await interact(page, 2200);
      await delay(100);
      if (tier !== 'normal') {
        assert.equal(await evaluate(page, `testScene.search.isOpened('${point.id}')`), false);
        assert.equal(await evaluate(page, 'testScene.search.progress()'), 0);
        await interact(page, duration + 350);
      }
      await until(page, `testScene.search.isOpened('${point.id}')`);
      await delay(450);
      assert.equal(
        await evaluate(page, `testScene.view.chests.get('${point.id}').texture.offset.x`),
        5 / 6,
      );
      await screenshot(page, `chest-${tier}-${mobile ? 'mobile' : 'desktop'}-opened`);
      if (await evaluate(page, '!!document.querySelector("#story-dialog[open]")'))
        await click(page, '#story-skip');
      await evaluate(page, 'testScene.services.inventory.clear()');
    }
    const remaining = layout.points.find(
      (p) =>
        p.tier === 'intermediate' &&
        p.id !== layout.points.find((p) => p.tier === 'intermediate').id,
    );
    await standAt(page, remaining);
    await evaluate(
      page,
      `(() => {
      for(let i=0;i<6;i++) testScene.services.inventory.addLoot({instanceId:'full-'+i,itemId:'school-badge',origin:{kind:'raid-loot',obtainedInRaidId:testScene.services.controller.getView().raidId}});
    })()`,
    );
    await interact(page, 200);
    assert.equal(await evaluate(page, `testScene.search.isOpened('${remaining.id}')`), false);
    assert((await evaluate(page, 'testScene.interaction')).includes('背包已满'));
    await evaluate(page, 'testScene.services.inventory.clear(); testScene.lighting.enabled=false');
    await delay(150);
    assert.equal(
      await evaluate(page, `testScene.view.chests.get('${remaining.id}').mesh.visible`),
      false,
    );
    await standAt(page, geometry.spawn, 0);
    await evaluate(
      page,
      `(() => {
      const {inventory,controller}=testScene.services;
      for(let i=0;i<4;i++) inventory.addLoot({instanceId:'value-'+i,itemId:'school-badge',origin:{kind:'raid-loot',obtainedInRaidId:controller.getView().raidId}});
    })()`,
    );
    assert.equal(
      await evaluate(page, 'testScene.services.controller.startExtraction().error'),
      'VALUE_TOO_LOW',
    );
    await evaluate(
      page,
      `(() => {
      const {inventory,controller}=testScene.services;
      for(let i=0;i<2;i++) inventory.addLoot({instanceId:'epic-'+i,itemId:'gpa-charm',origin:{kind:'raid-loot',obtainedInRaidId:controller.getView().raidId}});
    })()`,
    );
    assert.equal(await evaluate(page, 'testScene.services.controller.getView().value'), 200);
    await interact(page, 200);
    await until(page, 'document.querySelector("#app").dataset.phase === "success"');
    assert.equal(await evaluate(page, 'testScene.services.controller.getView().result.value'), 200);
    await screenshot(page, `chests-${mobile ? 'mobile' : 'desktop'}-200-extraction`);
    const storyChest = await evaluate(
      page,
      `(() => {
      const point=testScene.searchPoints.find(p=>p.itemId==='torn-notebook');
      return {point,src:testScene.view.chests.get(point.id).texture.image.src};
    })()`,
    );
    assert.deepEqual(storyChest.point, { ...geometry.questChest, itemId: 'torn-notebook' });
    assert(storyChest.src.includes('treasure-chest.png'));
    await click(page, '#next');
    await consent(page);
    await click(page, '#start');
    await until(
      page,
      'document.querySelector("#app").dataset.phase === "active" && testScene.lastRaidId === testScene.services.controller.getView().raidId',
    );
    await delay(200);
    const nextRound = await evaluate(
      page,
      `testScene.searchPoints.filter(p=>p.tier).map(p=>({
      tier:p.tier,src:testScene.view.chests.get(p.id).texture.image.src,
      frame:testScene.view.chests.get(p.id).texture.offset.x,
      openedAt:testScene.view.chests.get(p.id).openedAt,
      delta:Math.hypot(testScene.view.chests.get(p.id).mesh.position.x*32-p.x,testScene.view.chests.get(p.id).mesh.position.z*32-p.y)
    }))`,
    );
    for (const chest of nextRound) {
      assert(
        chest.src.includes(
          chest.tier === 'normal' ? 'treasure-chest.png' : `treasure-chest-${chest.tier}.png`,
        ),
      );
      assert.equal(chest.frame, 2 / 6);
      assert.equal(chest.openedAt, null);
      assert(chest.delta < 0.001);
    }
    pass(
      `${mobile ? 'Mobile' : 'Desktop'} tiered chests: correct textures, 2/4/6 second searches, interruption, full bag, flashlight visibility, 200-value extraction, preserved story chest, and fresh-round texture reset`,
    );
    await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
  }
}

async function verifySteleFlow() {
  const page = await newPage('stele');
  await consent(page);
  await click(page, '#start');
  await until(page, 'document.querySelector("#app").dataset.phase === "active"');
  await click(page, '#tutorial-skip');
  await attachScene(page);
  await standAt(page, geometry.stone, 100);
  const before = await evaluate(
    page,
    `(() => {
    const stele = testScene.view.stele;
    const meshes = [];
    stele.traverse(o => { if(o.isMesh) meshes.push(o); });
    return {solid:!!stele.getObjectByName('Minghu_SolidStele'), position:stele.position.toArray(),rotation:stele.quaternion.toArray(),
      names:meshes.map(o => o.name), opaque:meshes.every(o =>
        (Array.isArray(o.material) ? o.material : [o.material]).every(m => !m.transparent && m.isMeshStandardMaterial)),
      textures:[...testScene.view.textures].some(t => /minghu-stele.png/.test(t.image?.currentSrc ?? ''))};
  })()`,
  );
  assert(before.solid);
  assert.equal(before.names.length, 6, 'two body materials plus four foot rocks');
  assert.equal(before.opaque, true, 'stone uses opaque PBR lighting rather than cutout shading');
  assert.equal(before.textures, false, 'legacy billboard image is not loaded');
  for (const [name, yaw, dx, dy] of [
    ['front', 0, 0, 140],
    ['side', Math.PI / 2, 140, 0],
    ['back', Math.PI, 0, -140],
  ]) {
    await evaluate(
      page,
      `(() => {
      testScene.clearInteractions();
      testScene.position = {x:${geometry.stone.x + dx},y:${geometry.stone.y + dy}};
      const rig = testScene.view.cameraRig;
      rig.yaw = rig.viewYaw = ${yaw};
      rig.pitch = rig.viewPitch = 0.30;
      rig.distance = 5;
    })()`,
    );
    await delay(600);
    await screenshot(page, `minghu-3d-${name}-night`);
    assert.deepEqual(
      await evaluate(page, 'testScene.view.stele.quaternion.toArray()'),
      before.rotation,
      'orbit never rotates the landmark to face the camera',
    );
    assert.deepEqual(
      await evaluate(page, 'testScene.view.stele.position.toArray()'),
      before.position,
    );
  }
  await click(page, '#camera-overview');
  assert.deepEqual(
    await evaluate(page, 'testScene.view.stele.quaternion.toArray()'),
    before.rotation,
  );
  await click(page, '#camera-overview');
  await standAt(page, geometry.stone, 65);
  await interact(page);
  await until(page, 'document.querySelector("#story-dialog").open');
  await screenshot(page, 'minghu-3d-investigation');
  assert.equal(
    await evaluate(page, 'testScene.services.controller.getView().steleInvestigated'),
    false,
    '3D replacement preserves the notebook prerequisite',
  );
  await click(page, '#story-skip');
  await searchEvidence(page, 'torn-notebook');
  await standAt(page, geometry.stone, 65);
  await interact(page);
  await until(page, 'testScene.services.controller.getView().steleInvestigated');
  await screenshot(page, 'minghu-3d-investigated');
  await command('Target.disposeBrowserContext', { browserContextId: page.browserContextId });
  pass(
    'Solid photo-referenced Minghu model, front/side/back fixed orientation, overview and original investigation',
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
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
      console.error(
        'BROWSER',
        page.name,
        message.params.args.map((arg) => arg.description ?? arg.value),
      );
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

  if (spawningOnly) {
    await verifySpawningFlow();
  } else if (rulerOnly) {
    await verifyRulerEffectFlow();
  } else if (catOnly) {
    await verifyCatFlow();
  } else if (quickNoteOnly) {
    await verifyQuickNoteFlow();
  } else if (detectorOnly) {
    await verifyDetectorFlow();
  } else if (chestsOnly) {
    await verifyChestTiersFlow();
  } else if (durabilityOnly) {
    await verifyWeaponDurabilityFlow();
  } else if (hotbarOnly) {
    await verifyHotbarFlow();
    await verifyHotbarRebindingFlow();
  } else if (utilityEffectsOnly) {
    await verifyUtilityEffectsFlow();
    await verifyUtilityEffectsFlow('roller-skates');
    await verifyHealingFlow();
    await verifyHealingFlow('morning-coffee');
  } else if (healingOnly) {
    await verifyHealingFlow();
  } else if (steleOnly) {
    await verifySteleFlow();
  } else if (immersiveOnly) {
    await verifyImmersiveFlow();
  } else {
    if (!roomsOnly) {
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
      await command('Target.disposeBrowserContext', {
        browserContextId: upgraded.browserContextId,
      });
      pass('Cached 128px sprites → new 176px release → solo launch without clearing browser data');
    }

    const host = await newPage('host');
    assert.equal(await evaluate(host, 'document.querySelector("#start").disabled'), true);
    assert.equal(await evaluate(host, '!!document.querySelector("#room-panel")'), false);
    await screenshot(host, '01-lobby');
    await consent(host);
    if (!roomsOnly) {
      await click(host, '#start');
      await until(
        host,
        'document.querySelector("#app").dataset.phase === "active" && document.querySelector("#timer").textContent !== "10:00"',
      );
      const before = await evaluate(host, marker);
      assert(before, 'minimap initialized with player');
      await attachScene(host);
      const initialPosition = await evaluate(host, '({...testScene.position})');
      await move(host);
      await delay(300);
      const after = await evaluate(host, marker);
      assert(after, 'player-centred minimap remains visible');
      assert(
        await evaluate(host, `testScene.position.x > ${initialPosition.x} + 8`),
        'keyboard moves the player in the 3D world',
      );
      await screenshot(host, '02-single-game');
      await press(host, 'Tab', 'Tab', 9);
      await until(host, '!document.querySelector("#inventory-panel").hidden');
      await screenshot(host, '14-tab-inventory');
      await press(host, 'Escape', 'Escape', 27);
      await until(
        host,
        'document.querySelector("#inventory-panel").hidden && !document.querySelector("#raid-settings").open',
      );
      await press(host, 'Escape', 'Escape', 27);
      await until(host, 'document.querySelector("#raid-settings").open');
      await screenshot(host, '15-esc-settings');
      const settingsTime = await evaluate(host, 'document.querySelector("#timer").textContent');
      await delay(1100);
      assert.equal(
        await evaluate(host, 'document.querySelector("#timer").textContent'),
        settingsTime,
        'Esc settings pause the clock',
      );
      await click(host, '#hud-rules');
      const pausedTime = await evaluate(host, 'document.querySelector("#timer").textContent');
      await delay(1100);
      assert.equal(
        await evaluate(host, 'document.querySelector("#timer").textContent'),
        pausedTime,
        'rules pause the raid',
      );
      await click(host, '#close-rules');
      await press(host, 'Escape', 'Escape', 27);
      await until(host, '!document.querySelector("#raid-settings").open');
      await press(host, 'Tab', 'Tab', 9);
      await until(host, '!document.querySelector("#inventory-panel").hidden');
      await press(host, 'Tab', 'Tab', 9);
      await until(host, 'document.querySelector("#inventory-panel").hidden');
      pass(
        'Tab backpack and Esc settings retain their original panels, close order and pause rules',
      );
      const typingPosition = await evaluate(
        host,
        `(() => {
    const input = document.createElement('input'); input.id='browser-typing-probe';
    document.body.append(input); input.focus(); return {...testScene.position};
  })()`,
      );
      for (const [key, code, vk] of [
        ['w', 'KeyW', 87],
        ['e', 'KeyE', 69],
        ['q', 'KeyQ', 81],
        [' ', 'Space', 32],
        ['l', 'KeyL', 76],
        ['r', 'KeyR', 82],
        ['g', 'KeyG', 71],
        ['Escape', 'Escape', 27],
        ['Tab', 'Tab', 9],
      ])
        await press(host, key, code, vk);
      assert.deepEqual(
        await evaluate(host, '({...testScene.position})'),
        typingPosition,
        'typing never moves the player',
      );
      assert.equal(
        await evaluate(
          host,
          'testScene.lighting.enabled && testScene.lighting.spareBatteries === 2 && testScene.lighting.flareCount === 2 && testScene.combat.attackCooldown === 0 && document.querySelector("#inventory-panel").hidden && !document.querySelector("#raid-settings").open',
        ),
        true,
        'typing suppresses all gameplay and panel shortcuts',
      );
      await evaluate(host, 'document.querySelector("#browser-typing-probe").remove()');
      await click(host, '#tutorial-skip');
      await screenshot(host, '23-formal-entry');
      await command('Page.bringToFront', {}, host.id);
      await click(host, '#game-canvas canvas');
      await until(host, 'document.pointerLockElement === testScene.view.renderer.domElement');
      await press(host, 'Escape', 'Escape', 27);
      await until(
        host,
        '!document.pointerLockElement && document.querySelector("#raid-settings").open',
      );
      await press(host, 'Escape', 'Escape', 27);
      await until(host, '!document.querySelector("#raid-settings").open');
      // Chromium enforces a short recapture cooldown after native Esc unlock.
      await delay(1500);
      await click(host, '#game-canvas canvas');
      await until(host, 'document.pointerLockElement === testScene.view.renderer.domElement');
      await press(host, 'Tab', 'Tab', 9);
      await until(
        host,
        '!document.pointerLockElement && !document.querySelector("#inventory-panel").hidden',
      );
      await press(host, 'Escape', 'Escape', 27);
      await until(
        host,
        'document.querySelector("#inventory-panel").hidden && !document.querySelector("#raid-settings").open',
      );
      pass(
        'Pointer lock: Esc opens one settings panel, Tab releases capture, closing bag preserves panel order, clicking map recaptures',
      );
      await click(host, '#camera-overview');
      assert.equal(await evaluate(host, 'testScene.view.canOrbit()'), false);
      await delay(400);
      assert.equal(
        await evaluate(host, 'testScene.view.scene.fog'),
        null,
        'overview remains visible beyond night fog distance',
      );
      await screenshot(host, '16-formal-overview');
      await click(host, '#camera-overview');
      const cameraBefore = await evaluate(host, 'testScene.view.cameraInfo()');
      await evaluate(host, 'testScene.view.orbitCamera(140, -30); testScene.view.zoomCamera(120)');
      await delay(350);
      assert.notEqual(await evaluate(host, 'testScene.view.cameraInfo()'), cameraBefore);
      await click(host, '#camera-reset');
      await delay(350);
      assert.equal(await evaluate(host, 'testScene.view.cameraInfo()'), cameraBefore);
      await evaluate(
        host,
        `(() => {
    globalThis.lostExtension = testScene.view.renderer.getContext().getExtension('WEBGL_lose_context');
    if (!lostExtension) throw Error('Context loss extension unavailable');
    lostExtension.loseContext();
  })()`,
      );
      await until(host, 'testScene.contextLost && document.querySelector("#raid-settings").open');
      await click(host, '#resume-raid');
      await delay(300);
      assert.equal(
        await evaluate(host, 'testScene.services.controller.isPaused()'),
        true,
        'lost context cannot resume through a closed panel',
      );
      await evaluate(host, 'lostExtension.restoreContext()');
      await until(host, '!testScene.contextLost && document.querySelector("#raid-settings").open');
      assert.equal(await evaluate(host, 'testScene.services.controller.isPaused()'), true);
      await screenshot(host, '17-context-restored');
      await click(host, '#resume-raid');
      await until(host, '!testScene.services.controller.isPaused()');
      pass('Formal camera overview/reset and real WebGL context loss require manual resume');
      await abandon(host);
      await screenshot(host, '03-result');
      await click(host, '#next');
      await until(host, 'document.querySelector("#app").dataset.phase === "preparing"');
      pass(
        'Single player: consent → start → running timer → movement → pause → settlement → lobby',
      );

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
      await click(host, '#start');
      await until(
        host,
        'testScene.lastRaidId === testScene.services.controller.getView().raidId && testScene.searchPoints.length > 0',
      );
      assert.equal(
        await evaluate(
          host,
          `testScene.searchPoints.every(p => {
    const chest = testScene.view.chests.get(p.id);
    return Math.abs(chest.mesh.position.x*32-p.x)<0.001 && Math.abs(chest.mesh.position.z*32-p.y)<0.001;
  })`,
        ),
        true,
        'reused scene moves every chest mesh to the current round layout',
      );
      await evaluate(
        host,
        `(() => {
    const s = testScene;
    s.controls.pointer = undefined;
    globalThis.battleEnemy = s.combat.enemies.find(e => e.kind === 'patrol');
    globalThis.calmEnemy = s.combat.enemies.find(e => e.kind === 'hug');
    battleEnemy.position = {x:s.position.x,y:s.position.y-48};
    battleEnemy.home = {...battleEnemy.position}; battleEnemy.route = [{...battleEnemy.position}];
    battleEnemy.state = 'windup'; battleEnemy.timer = 10000; battleEnemy.wanders = false;
    s.combat.enemies = [battleEnemy]; s.clearInteractions();
  })()`,
      );
      await press(host, ' ', 'Space', 32);
      await until(host, 'battleEnemy.health < 70');
      await screenshot(host, '20-formal-combat');
      await evaluate(host, 'battleEnemy.timer=1; testScene.combat.invulnerability=0');
      await until(host, 'testScene.services.controller.getView().health < 100');
      await evaluate(
        host,
        `(() => {
    calmEnemy.position = {x:testScene.position.x,y:testScene.position.y-40};
    calmEnemy.state='request'; calmEnemy.timer=10000; calmEnemy.hugProgress=0;
    testScene.combat.enemies=[calmEnemy]; testScene.clearInteractions();
  })()`,
      );
      await command(
        'Input.dispatchKeyEvent',
        { type: 'keyDown', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 },
        host.id,
      );
      await until(host, 'calmEnemy.state === "calmed"');
      await command(
        'Input.dispatchKeyEvent',
        { type: 'keyUp', key: 'q', code: 'KeyQ', windowsVirtualKeyCode: 81 },
        host.id,
      );
      await screenshot(host, '21-formal-calming');
      await evaluate(host, 'testScene.services.controller.applyDamage(1000)');
      await until(host, 'document.querySelector("#app").dataset.phase === "failed"');
      await screenshot(host, '22-formal-failure');
      await click(host, '#next');
      await click(host, '#start');
      await until(host, 'document.querySelector("#app").dataset.phase === "active"');
      await command('Page.reload', {}, host.id);
      await until(
        host,
        'typeof globalThis.testScene === "undefined" && document.querySelector("#game-load-status")?.dataset.state === "ready"',
      );
      await attachScene(host);
      assert.equal(
        await evaluate(host, 'testScene.services.controller.getView().phase'),
        'preparing',
      );
      pass(
        'Formal combat: Space damages enemies, enemy windup hurts player, Q calms, death settles and active reload recovers',
      );

      const storyPage = await newPage('story');
      await consent(storyPage);
      await click(storyPage, '#start');
      await until(storyPage, 'document.querySelector("#app").dataset.phase === "active"');
      await click(storyPage, '#tutorial-skip');
      await attachScene(storyPage);
      assert.equal(
        await evaluate(storyPage, 'testScene.view.treeView.mesh.count'),
        198,
        'pixel trees are loaded in the formal scene',
      );
      await standAt(storyPage, geometry.stone, 65);
      await screenshot(storyPage, '10-minghu-stele-world');
      await interact(storyPage);
      assert.equal(
        await evaluate(storyPage, 'testScene.services.controller.getView().steleInvestigated'),
        false,
        'stele still requires this raid notebook',
      );
      await searchEvidence(storyPage, 'torn-notebook', '09-notebook-search');
      await until(storyPage, 'document.querySelector("#quest-count").textContent === "1 / 2"');
      const notebook = await evaluate(
        storyPage,
        'testScene.services.inventory.getCarriedItems().find(i => i.itemId === "torn-notebook")',
      );
      await click(storyPage, '#inventory [data-item-id="torn-notebook"] button:last-child');
      await click(storyPage, '#confirm-ok');
      await until(storyPage, `testScene.ground.has(${JSON.stringify(notebook.instanceId)})`);
      await screenshot(storyPage, '19-dropped-quest-item');
      await press(storyPage, 'Tab', 'Tab', 9);
      await interact(storyPage);
      await until(
        storyPage,
        `testScene.services.inventory.getCarriedItems().some(i => i.instanceId === ${JSON.stringify(notebook.instanceId)})`,
      );
      assert.deepEqual(
        await evaluate(
          storyPage,
          'testScene.services.inventory.getCarriedItems().find(i => i.itemId === "torn-notebook")',
        ),
        notebook,
        'drop/pickup preserves quest instance and raid provenance',
      );
      await standAt(storyPage, geometry.stone, 0);
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
        await standAt(storyPage, geometry.spawn, 0);
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
        await until(
          storyPage,
          `!!document.querySelector('[data-chapter-story="${expectedChapter}"]')`,
        );
        await click(storyPage, '#next');
        await until(
          storyPage,
          `!!document.querySelector('#lobby-missions [data-chapter="${nextChapter}"]')`,
        );
      };
      await finishChapter('siyuan-code', 'siyuan-key');
      await click(storyPage, '[data-lobby-tab="warehouse"]');
      await click(storyPage, '.archive-story > summary');
      await click(storyPage, '[data-chapter-story="siyuan-code"]');
      await until(storyPage, 'document.querySelector("#story-dialog").open');
      await click(storyPage, '#story-skip');
      await click(storyPage, '[data-lobby-tab="prepare"]');
      await click(storyPage, '#start');
      await until(storyPage, 'document.querySelector("#app").dataset.phase === "active"');
      await searchEvidence(storyPage, 'marked-campus-map');
      await searchEvidence(storyPage, 'siyuan-key');
      await until(storyPage, 'document.querySelector("#quest-count").textContent === "2 / 2"');
      await finishChapter('siyuan-key', 'soothe-monster');
      await screenshot(storyPage, '11-chapter-three-unlocked');
      await click(storyPage, '#start');
      await until(storyPage, 'document.querySelector("#app").dataset.phase === "active"');
      await searchEvidence(storyPage, 'soothe-charm', '18-third-chapter-search');
      await searchEvidence(storyPage, 'complete-record');
      await until(storyPage, 'document.querySelector("#quest-count").textContent === "2 / 2"');
      await finishChapter('soothe-monster', 'soothe-monster');
      pass(
        'All three chapters: notebook/stele → map/key → charm/record → extraction → ending-gated cloud unlock and archive replay',
      );

      await click(storyPage, '[data-lobby-tab="shop"]');
      const initialBalance = await evaluate(
        storyPage,
        'Number(document.querySelector("#shop-balance").textContent)',
      );
      assert(initialBalance >= 170, 'duplicate collectibles funded the shop through settlement');
      for (const itemId of ['bandage', 'yellow-bike', 'thick-down-jacket']) {
        await click(storyPage, `[data-shop-buy="${itemId}"]`);
        await until(
          storyPage,
          'document.querySelector("#shop-status").dataset.state === "success"',
        );
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
      assert.equal(
        await evaluate(storyPage, 'document.querySelector("#story-dialog").open'),
        false,
        'completed third chapter does not reopen its ending on reload',
      );
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
        '已选 6 / 6 格（含初始武器）',
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
        1.3,
        'purchased bike applies speed',
      );
      await click(storyPage, '#inventory [data-item-id="thick-down-jacket"] button');
      await evaluate(storyPage, 'testScene.services.controller.applyDamage(20)');
      assert.equal(
        await evaluate(storyPage, 'testScene.services.controller.getView().health'),
        90,
        'purchased jacket shield absorbs damage',
      );
      await until(
        storyPage,
        '!document.querySelector("#inventory [data-item-id=yellow-bike]") && !document.querySelector("#inventory [data-item-id=thick-down-jacket]")',
      );
      await screenshot(storyPage, '13-purchased-items-used');
      await abandon(storyPage);
      pass(
        'Standalone shop: balance, all three purchases, insufficient funds, failed save rollback, duplicate click, cloud reload, carry-in, healing, speed and shield effects',
      );
    }

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
    await consent(host);
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
      await attachScene(page);
      await until(
        page,
        'testScene.lastRaidId === testScene.services.controller.getView().raidId && testScene.view.teammates.size === 1',
      );
    }
    const chestLayout = 'testScene.searchPoints.map(({id,x,y}) => ({id,x,y}))';
    assert.deepEqual(
      await evaluate(host, chestLayout),
      await evaluate(guest, chestLayout),
      'room members render the same seeded chest layout',
    );
    const roomBefore = guest.frames.findLast(
      (frame) => frame.type === 'room-state' && frame.started,
    );
    const hostX = roomBefore.players.find((player) => player.playerId === hostId).position.x;
    await move(host);
    await delay(500);
    const roomAfter = guest.frames.findLast(
      (frame) => frame.type === 'room-state' && frame.started,
    );
    assert(
      roomAfter.players.find((player) => player.playerId === hostId).position.x > hostX,
      'peer receives actual server movement',
    );
    await screenshot(host, '05-room-game');
    await abandon(host);
    await until(guest, 'testScene.teammates.size === 0 && testScene.view.teammates.size === 0');
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
    await click(mobile, '#tutorial-skip');
    await attachScene(mobile);
    const mobileCamera = await evaluate(mobile, 'testScene.view.cameraInfo()');
    const mobilePosition = await evaluate(mobile, '({...testScene.position})');
    await touchDrag(mobile, '.touch-stick', 24, 0);
    const mobileMoved = await evaluate(mobile, '({...testScene.position})');
    assert(
      Math.hypot(mobileMoved.x - mobilePosition.x, mobileMoved.y - mobilePosition.y) > 5,
      'mobile stick moves the player',
    );
    assert.equal(
      await evaluate(mobile, 'testScene.view.cameraInfo()'),
      mobileCamera,
      'left joystick does not rotate camera',
    );
    await touchDrag(mobile, '.touch-aim', 15, 5);
    await touchDrag(mobile, '[data-touch-action="SPACE"]', 0, 0);
    assert.equal(
      await evaluate(mobile, 'testScene.view.cameraInfo()'),
      mobileCamera,
      'aim stick and attack do not rotate camera',
    );
    await touchDrag(mobile, '#game-canvas', 20, 40);
    assert.notEqual(
      await evaluate(mobile, 'testScene.view.cameraInfo()'),
      mobileCamera,
      'empty map drag rotates camera',
    );
    await screenshot(mobile, '06-mobile-game');
    pass(
      'Portrait touch device: landscape layout, movement and aim sticks, attack isolation and map camera drag',
    );

    const failed = await newPage('missing', { failAsset: true });
    await consent(failed);
    assert.equal(await evaluate(failed, 'document.querySelector("#start").disabled'), true);
    assert.equal(await evaluate(failed, 'document.querySelector("#reload-game").hidden'), false);
    assert.equal(
      await evaluate(failed, 'document.querySelector("#app").dataset.phase'),
      'preparing',
    );
    await screenshot(failed, '07-load-error');
    pass('Missing sprite: visible recovery action and no raid started');
  }

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
