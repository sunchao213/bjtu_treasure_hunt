import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, pbkdf2Sync } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const project = resolve('server');
const externalBase = process.env.AUTH_SMOKE_URL;
const directory = externalBase
  ? resolve(process.env.AUTH_SMOKE_DATA_DIR ?? 'invalid')
  : await mkdtemp(join(tmpdir(), 'bjtu-auth-test-'));
assert(
  basename(directory).startsWith('bjtu-auth-test-'),
  'only a dedicated test account directory is allowed',
);
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const base = externalBase ?? `http://127.0.0.1:${port}`;
assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'tests run on loopback only');
const origin = base;
let server;
let logs = '';
let socket;

async function start() {
  if (externalBase) {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    return;
  }
  server = spawn(
    'dotnet',
    [join(project, 'bin/Debug/net8.0/OnlineHost.dll'), '--contentRoot', project, '--urls', base],
    {
      windowsHide: true,
      env: {
        ...process.env,
        Auth__DataDirectory: directory,
        Logging__LogLevel__Default: 'Warning',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  server.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  server.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      /* not listening yet */
    }
    await delay(100);
  }
  throw new Error(`Server did not start: ${logs}`);
}

async function stop() {
  if (!server || server.exitCode !== null) return;
  const exited = once(server, 'exit');
  server.kill();
  await exited;
}

const credentials = {
  username: 'explorer',
  password: 'test-password-123',
  displayName: 'Night Explorer',
};
const post = (path, body, cookie = '', headers = {}) =>
  fetch(`${base}/api/auth/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Game-Request': '1',
      Origin: origin,
      Cookie: cookie,
      ...headers,
    },
    body: JSON.stringify(body),
  });
const me = (cookie = '') => fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } });
const cloudPost = (path, body, cookie = '') =>
  fetch(`${base}/api/save${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Game-Request': '1',
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(body),
  });
const cookieFrom = (response) =>
  response.headers
    .getSetCookie()
    .find((value) => value.startsWith('bjtu_session=') && !value.startsWith('bjtu_session=;'))
    ?.split(';')[0];

function upgrade(cookie = '', requestOrigin = origin) {
  return new Promise((done, reject) => {
    const request = http.request(`${base}/ws`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        Cookie: cookie,
        Origin: requestOrigin,
      },
    });
    request.on('upgrade', (_response, connected) => done({ status: 101, socket: connected }));
    request.on('response', (response) => {
      response.resume();
      done({ status: response.statusCode });
    });
    request.on('error', reject);
    request.end();
  });
}

function send(message) {
  const payload = Buffer.from(JSON.stringify(message));
  const mask = randomBytes(4);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 255]);
  const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
  socket.write(Buffer.concat([header, mask, masked]));
}

try {
  let legacyFixture;
  if (!externalBase) {
    const salt = randomBytes(16);
    legacyFixture = {
      Id: randomBytes(16).toString('hex'),
      Username: 'legacy_user',
      DisplayName: 'Legacy Explorer',
      Salt: salt.toString('base64'),
      PasswordHash: pbkdf2Sync('legacy-password-123', salt, 210_000, 32, 'sha256').toString(
        'base64',
      ),
    };
    await writeFile(join(directory, 'accounts.json'), JSON.stringify([legacyFixture]));
  } else {
    legacyFixture = JSON.parse(
      await readFile(join(directory, 'accounts.json'), 'utf8').catch(() => '[]'),
    ).find((user) => user.Username === 'legacy_user');
  }
  await start();
  if (legacyFixture) {
    const migrated = await post('login', {
      username: 'legacy_user',
      password: 'legacy-password-123',
    });
    assert.equal(migrated.status, 200, 'legacy account password still works after migration');
    assert.equal(
      (await migrated.json()).user.id,
      legacyFixture.Id,
      'migration preserves the account ID and browser save ownership',
    );
    assert.equal(
      JSON.parse(await readFile(join(directory, 'accounts.json'), 'utf8'))[0].Id,
      legacyFixture.Id,
      'legacy JSON backup is preserved',
    );
  }
  assert.equal((await me()).status, 401);
  assert.equal((await upgrade()).status, 401);
  assert.equal((await post('register', { ...credentials, password: 'short' })).status, 400);
  assert.equal((await post('register', credentials, '', { 'X-Game-Request': '' })).status, 403);
  assert.equal(
    (await post('register', credentials, '', { Origin: 'https://untrusted.example' })).status,
    403,
  );
  const registration = await post('register', credentials);
  assert.equal(registration.status, 200);
  const originalCookie = cookieFrom(registration);
  assert(originalCookie, 'registration creates a session');
  assert(
    registration.headers
      .getSetCookie()
      .some((value) => /httponly/i.test(value) && /samesite=strict/i.test(value)),
  );
  assert.equal(registration.headers.get('cache-control'), 'no-store');
  const registered = await registration.json();
  assert.equal(registered.user.displayName, credentials.displayName);
  assert.equal(registered.user.passwordHash, undefined);
  assert.equal((await me(originalCookie)).status, 200);
  assert.equal((await post('register', { ...credentials, username: 'EXPLORER' })).status, 409);
  assert.equal((await post('login', { ...credentials, password: 'wrong-password' })).status, 401);
  const login = await post('login', { ...credentials, username: 'EXPLORER' }, originalCookie);
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login);
  assert(cookie);
  assert.equal((await me(originalCookie)).status, 401, 'login rotates the current session');
  assert.equal((await upgrade(cookie, 'https://untrusted.example')).status, 403);
  const connection = await upgrade(cookie);
  assert.equal(connection.status, 101);
  socket = connection.socket;
  socket.on('error', () => {});
  let received = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    received = Buffer.concat([received, chunk]);
  });
  send({ type: 'hello', protocol: 1, sessionId: 'fake', displayName: 'Impersonated Name' });
  send({ type: 'join-room', roomId: 'auth-test' });
  for (let attempt = 0; attempt < 100 && !received.includes(Buffer.from('room-state')); attempt++)
    await delay(50);
  assert(received.includes(Buffer.from('room-state')), 'authenticated room join succeeds');
  assert(
    received.includes(Buffer.from(credentials.displayName)),
    'room identity comes from the account',
  );
  assert(
    !received.includes(Buffer.from('Impersonated Name')),
    'client cannot spoof the account nickname',
  );

  assert.equal(
    (await cloudPost('/open', { clientId: randomUUID() })).status,
    401,
    'cloud saves require a session',
  );
  const clientId = randomUUID();
  const opened = await cloudPost('/open', { clientId }, cookie);
  assert.equal(opened.status, 200);
  const initial = await opened.json();
  assert.equal(initial.data, null);
  assert.equal(initial.revision, 0);
  const cloudData = {
    schemaVersion: 3,
    warehouse: [],
    codexIds: ['school-badge'],
    unlockedChapterIds: [],
    activeRaid: null,
    settledRaidIds: Array.from({ length: 250 }, (_, i) => `settled-raid-for-body-limit-${i}`),
    lastResult: null,
  };
  const write = { leaseToken: initial.leaseToken, revision: 0, data: cloudData };
  assert.equal(
    (await cloudPost('', { ...write, data: { ...cloudData, schemaVersion: '3' } }, cookie)).status,
    400,
    'malformed schema types fail cleanly',
  );
  const saved = await cloudPost('', write, cookie);
  assert.equal(
    saved.status,
    200,
    'cloud snapshots larger than the auth request body limit are accepted',
  );
  assert.equal((await saved.json()).revision, 1);
  const replayed = await cloudPost('', write, cookie);
  assert.equal(replayed.status, 200, 'retrying a lost response does not repeat settlement');
  assert.equal((await replayed.json()).revision, 1);
  assert.equal(
    (await cloudPost('', { ...write, data: { ...cloudData, codexIds: [] } }, cookie)).status,
    409,
    'stale versions cannot overwrite newer data',
  );
  assert.equal(
    (await cloudPost('/heartbeat', { leaseToken: initial.leaseToken }, cookie)).status,
    200,
  );

  const otherLogin = await post('login', credentials);
  const otherCookie = cookieFrom(otherLogin);
  const otherClientId = randomUUID();
  assert.equal(
    (await cloudPost('/open', { clientId: otherClientId }, otherCookie)).status,
    409,
    'another device cannot recover or overwrite a live raid',
  );
  const bob = await post('register', { ...credentials, username: 'other_player' });
  assert.equal(bob.status, 200);
  const bobCookie = cookieFrom(bob);
  const bobSave = await cloudPost('/open', { clientId: randomUUID() }, bobCookie);
  assert.equal(bobSave.status, 200);
  assert.equal(
    (await bobSave.json()).data,
    null,
    'another account never receives this account progress',
  );
  assert.equal(
    (await cloudPost('', write, bobCookie)).status,
    409,
    'another account cannot use a stolen save lease token',
  );
  await post('logout', {}, bobCookie);

  assert.equal(
    (await cloudPost('/release', { leaseToken: initial.leaseToken }, cookie)).status,
    204,
  );
  const otherOpened = await cloudPost('/open', { clientId: otherClientId }, otherCookie);
  assert.equal(otherOpened.status, 200);
  const otherSave = await otherOpened.json();
  assert.deepEqual(otherSave.data, cloudData, 'a new device downloads the committed progress');
  assert.equal(
    (await cloudPost('', write, cookie)).status,
    409,
    'the previous device cannot write after releasing ownership',
  );
  await cloudPost('/release', { leaseToken: otherSave.leaseToken }, otherCookie);
  const reloaded = await cloudPost('/open', { clientId }, cookie);
  const reloadedSave = await reloaded.json();
  const rotated = await cloudPost('/open', { clientId }, cookie);
  const rotatedSave = await rotated.json();
  assert.notEqual(reloadedSave.leaseToken, rotatedSave.leaseToken);
  await cloudPost('/release', { leaseToken: reloadedSave.leaseToken }, cookie);
  assert.equal(
    (await cloudPost('/heartbeat', { leaseToken: rotatedSave.leaseToken }, cookie)).status,
    200,
    'a late unload cannot release the reloaded page lease',
  );
  const closed = new Promise((done) => socket.once('close', done));
  assert.equal((await post('logout', {}, cookie)).status, 204);
  await Promise.race([
    closed,
    delay(5000).then(() => {
      throw new Error('Logout did not disconnect the WebSocket');
    }),
  ]);
  assert.equal((await me(cookie)).status, 401);
  assert.equal((await upgrade(cookie)).status, 401);
  const afterLogout = await cloudPost('/open', { clientId: otherClientId }, otherCookie);
  assert.equal(afterLogout.status, 200, 'logout immediately releases the cloud save lease');
  const afterLogoutSave = await afterLogout.json();
  await cloudPost('/release', { leaseToken: afterLogoutSave.leaseToken }, otherCookie);

  const database = new DatabaseSync(join(directory, 'game.db'), { readOnly: true });
  try {
    const row = database
      .prepare('SELECT id, password_salt, password_hash FROM accounts WHERE username=?')
      .get(credentials.username);
    assert.equal(row.id, registered.user.id);
    assert.notEqual(row.password_hash, credentials.password);
    assert.equal(
      row.password_hash,
      pbkdf2Sync(
        credentials.password,
        Buffer.from(row.password_salt, 'base64'),
        210_000,
        32,
        'sha256',
      ).toString('base64'),
    );
    const progress = database
      .prepare('SELECT data, revision FROM player_saves WHERE user_id=?')
      .get(registered.user.id);
    assert.deepEqual(JSON.parse(progress.data), cloudData);
    assert.equal(progress.revision, 1);
    assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    database.close();
  }
  if (!externalBase) {
    const beforeRestart = await post('login', credentials);
    const staleCookie = cookieFrom(beforeRestart);
    await stop();
    await start();
    assert.equal((await me(staleCookie)).status, 401, 'server restart invalidates sessions');
    const afterRestart = await post('login', credentials);
    assert.equal(afterRestart.status, 200, 'accounts survive restart');
    assert.equal((await afterRestart.json()).user.id, registered.user.id);
    const restored = await cloudPost('/open', { clientId: randomUUID() }, cookieFrom(afterRestart));
    assert.equal(restored.status, 200);
    assert.deepEqual(
      (await restored.json()).data,
      cloudData,
      'SQLite progress survives a complete host restart',
    );
  }

  for (let attempt = 0; attempt < 21; attempt++)
    await post('login', { ...credentials, password: 'wrong-password' });
  assert.equal(
    (await post('login', credentials)).status,
    429,
    'credential attempts are rate limited',
  );
  console.log(
    `Database/auth smoke passed: migration, registration, login, CSRF, cookies, WebSocket revocation, SQL password hashes, cloud persistence, account isolation, device leases, revision conflicts, idempotent retries and rate limiting. ${externalBase ? 'External host: restart check must run separately.' : 'Restart persistence passed.'}`,
  );
} finally {
  socket?.destroy();
  await stop();
  // mkdtemp created exactly this dedicated test directory under the OS temp root.
  if (!externalBase) {
    assert(directory.startsWith(join(tmpdir(), 'bjtu-auth-test-')));
    await rm(directory, { recursive: true, force: true });
  }
}
