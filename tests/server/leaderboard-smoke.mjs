// R16 leaderboard smoke: real HTTP sessions, cloud-settlement ingestion, fixed snapshots,
// friend permissions, stable ordering, keyset pagination, and failure-score exclusion.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executable = resolve('server/bin/Debug/net8.0/OnlineHost.dll');
const directory = await mkdtemp(join(tmpdir(), 'bjtu-leaderboard-test-'));
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const base = `http://127.0.0.1:${port}`;
const headers = { 'Content-Type': 'application/json', 'X-Game-Request': '1' };
let logs = '';
const server = spawn('dotnet', [executable, '--urls', base, '--contentRoot', resolve('server')], {
  windowsHide: true,
  env: { ...process.env, Auth__DataDirectory: directory },
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', (data) => (logs += data));
server.stderr.on('data', (data) => (logs += data));

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return {
    status: response.status,
    body,
    cookie: response.headers.getSetCookie?.().join('; ') ?? '',
  };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // Start-up may take a moment.
    }
    await delay(100);
  }
  throw new Error(`服务未在 10 秒内就绪：${logs.slice(-800)}`);
}

async function register(name) {
  const result = await call('/api/auth/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      username: `rank_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
      password: 'Ranking123456',
      displayName: name,
    }),
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const cookie = /bjtu_session=([A-Fa-f0-9]{64})/.exec(result.cookie)?.[0] ?? '';
  assert(cookie, 'registration creates a session cookie');
  return { id: result.body.user.id, displayName: name, cookie };
}

const authedGet = (path, player) => call(path, { headers: { Cookie: player.cookie } });
const authedPost = (path, body, player) =>
  call(path, {
    method: 'POST',
    headers: { ...headers, Cookie: player.cookie },
    body: JSON.stringify(body),
  });

async function addScore(player, raidId, outcome, value) {
  let state = saveStates.get(player.id);
  if (!state) {
    const opened = await authedPost('/api/save/open', { clientId: crypto.randomUUID() }, player);
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    state = {
      leaseToken: opened.body.leaseToken,
      revision: opened.body.revision,
      data: opened.body.data ?? {
        schemaVersion: 3,
        warehouse: [],
        codexIds: [],
        unlockedChapterIds: [],
        activeRaid: null,
        settledRaidIds: [],
        lastResult: null,
      },
    };
    if (opened.body.data === null) {
      const initial = await authedPost(
        '/api/save',
        {
          leaseToken: state.leaseToken,
          revision: state.revision,
          data: state.data,
        },
        player,
      );
      assert.equal(initial.status, 200, JSON.stringify(initial.body));
      state.revision = initial.body.revision;
    }
    saveStates.set(player.id, state);
  }
  const data = {
    ...state.data,
    settledRaidIds: [...state.data.settledRaidIds, raidId],
    lastResult: {
      raidId,
      outcome,
      reason: outcome === 'success' ? null : 'abandoned',
      items: [],
      value,
    },
  };
  const settled = await authedPost(
    '/api/save',
    {
      leaseToken: state.leaseToken,
      revision: state.revision,
      data,
    },
    player,
  );
  assert.equal(settled.status, 200, JSON.stringify(settled.body));
  // A lost response/retry must not insert a second record or move the score timestamp.
  const replay = await authedPost(
    '/api/save',
    {
      leaseToken: state.leaseToken,
      revision: state.revision,
      data,
    },
    player,
  );
  assert.equal(replay.status, 200);
  state.revision = settled.body.revision;
  state.data = data;
  return data;
}

const saveStates = new Map();

try {
  await waitForServer();
  const alice = await register('探索者甲');
  const bob = await register('探索者乙');
  const failedOnly = await register('尚未撤离');
  await addScore(alice, 'alice-raid-1', 'success', 100);
  await addScore(alice, 'alice-raid-2', 'success', 50);
  await addScore(bob, 'bob-raid-1', 'success', 150);
  await addScore(failedOnly, 'failed-raid-1', 'failed', 999);

  const apply = await authedPost(
    '/api/social/apply',
    {
      targetUid: bob.id,
      requestId: `rank-${crypto.randomUUID()}`,
    },
    alice,
  );
  assert.equal(apply.status, 200);
  const accepted = await authedPost(
    '/api/social/respond',
    { peerUid: alice.id, action: 'accept' },
    bob,
  );
  assert.equal(accepted.status, 200);

  const global = await authedGet('/api/leaderboard?scope=global', alice);
  assert.equal(global.status, 200, JSON.stringify(global.body));
  assert.equal(global.body.windowEndMs - global.body.windowStartMs, 7 * 24 * 60 * 60 * 1000);
  assert.equal(global.body.entries.length, 2, 'failed-only accounts are excluded');
  assert.deepEqual(
    global.body.entries.map((entry) => entry.totalValue),
    [150, 150],
  );
  assert.equal(
    global.body.entries[0].displayName,
    bob.displayName,
    'best single extraction breaks total ties',
  );
  assert.deepEqual(
    global.body.entries.map((entry) => entry.rank),
    [1, 2],
  );
  assert.equal(global.body.entries[0].uid, undefined, 'public rows do not expose account IDs');

  const friends = await authedGet('/api/leaderboard?scope=friends', alice);
  assert.equal(friends.status, 200);
  assert.deepEqual(
    friends.body.entries.map((entry) => entry.displayName),
    [bob.displayName],
  );
  assert.equal(friends.body.entries[0].rank, 1, 'ranks are scoped to eligible friends');

  const blocked = await authedPost('/api/social/block', { peerUid: bob.id, blocked: true }, alice);
  assert.equal(blocked.status, 200);
  const hiddenFriend = await authedGet('/api/leaderboard?scope=friends', alice);
  assert.equal(hiddenFriend.status, 200);
  assert.deepEqual(
    hiddenFriend.body.entries,
    [],
    'blocking hides an accepted friend from the friends board',
  );

  // Seed enough valid accounts to exercise snapshot keyset pagination through the actual API.
  const db = new DatabaseSync(join(directory, 'game.db'));
  try {
    const now = Date.now();
    const insertAccount = db.prepare(
      'INSERT INTO accounts(id, username, display_name, password_salt, password_hash, created_at) VALUES(?,?,?,?,?,?)',
    );
    const insertResult = db.prepare(
      'INSERT INTO raid_results(user_id, raid_id, settled_at_ms, outcome, value) VALUES(?,?,?,?,?)',
    );
    for (let index = 0; index < 22; index += 1) {
      const id = index.toString(16).padStart(32, '0');
      insertAccount.run(
        id,
        `rank_seed_${index}`,
        `快照玩家${String(index).padStart(2, '0')}`,
        'salt',
        'hash',
        new Date(now).toISOString(),
      );
      insertResult.run(id, `seed-${index}`, now, 'success', 500);
    }
  } finally {
    db.close();
  }
  const pageOne = await authedGet('/api/leaderboard?scope=global', alice);
  assert.equal(pageOne.status, 200);
  assert.equal(pageOne.body.entries.length, 20);
  assert.equal(pageOne.body.hasMore, true);
  assert.match(pageOne.body.nextCursor, /^[a-f0-9]{32}$/);
  assert.deepEqual(
    pageOne.body.entries.slice(0, 2).map((entry) => entry.displayName),
    ['快照玩家00', '快照玩家01'],
    'internal account ID provides a deterministic final tie-break without being exposed',
  );
  const tieRows = pageOne.body.entries.filter((entry) => entry.totalValue === 500);
  assert(
    tieRows.every((entry) => entry.rank === 1),
    'equal totals and best scores share a rank',
  );
  const dbDuringPaging = new DatabaseSync(join(directory, 'game.db'));
  try {
    dbDuringPaging
      .prepare(
        'INSERT INTO accounts(id, username, display_name, password_salt, password_hash, created_at) VALUES(?,?,?,?,?,?)',
      )
      .run(
        'f'.repeat(32),
        'rank_during_page',
        '翻页时新结算玩家',
        'salt',
        'hash',
        new Date().toISOString(),
      );
    dbDuringPaging
      .prepare(
        'INSERT INTO raid_results(user_id, raid_id, settled_at_ms, outcome, value) VALUES(?,?,?,?,?)',
      )
      .run('f'.repeat(32), 'during-pagination', Date.now(), 'success', 100_000);
  } finally {
    dbDuringPaging.close();
  }
  const pageTwo = await authedGet(
    `/api/leaderboard?scope=global&cursor=${encodeURIComponent(pageOne.body.nextCursor)}`,
    alice,
  );
  assert.equal(pageTwo.status, 200, JSON.stringify(pageTwo.body));
  assert.equal(pageTwo.body.entries.length, 4);
  assert.equal(pageTwo.body.hasMore, false);
  assert.equal(
    pageTwo.body.windowStartMs,
    pageOne.body.windowStartMs,
    'cursor continues the original fixed snapshot',
  );
  assert.equal(pageTwo.body.windowEndMs, pageOne.body.windowEndMs);
  const pageNames = [...pageOne.body.entries, ...pageTwo.body.entries].map(
    (entry) => entry.displayName,
  );
  assert.equal(new Set(pageNames).size, 24, 'keyset pages do not repeat entries');
  assert(!pageNames.includes('翻页时新结算玩家'), 'new scores do not move an existing snapshot');

  const invalidCursor = await authedGet('/api/leaderboard?scope=global&cursor=not-a-cursor', alice);
  assert.equal(invalidCursor.status, 400);
  const unauthorized = await call('/api/leaderboard?scope=global');
  assert.equal(unauthorized.status, 401);
  console.log(
    '排行榜冒烟：成功撤离聚合、稳定排序、好友/屏蔽权限、失败成绩排除、快照游标分页全部通过',
  );
} finally {
  if (server.exitCode === null) {
    if (process.platform === 'win32') {
      // Windows may leave the apphost child alive if only the dotnet parent is killed.
      const killer = spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      await once(killer, 'exit');
    } else {
      const exited = once(server, 'exit');
      server.kill();
      await exited;
    }
  }
  assert(join(directory).includes('bjtu-leaderboard-test-'));
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
}
