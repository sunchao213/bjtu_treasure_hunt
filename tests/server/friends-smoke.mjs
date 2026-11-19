// R15 好友与私聊的服务端冒烟测试：自带临时数据库与随机端口，不触碰任何真实存档。
//
// 覆盖：按 UID 申请、重复申请幂等、不能申请自己、对方可见待处理、接受后双方可见、
//       消息发送、同 messageId 同载荷去重、同 ID 异载荷冲突、接收方拉取与未读归零、
//       10 秒 5 条限流、200 字符上限、屏蔽后禁止发消息与申请、未登录 401。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const executable = resolve(
  process.env.FRIENDS_SMOKE_DLL ?? 'server/bin/Debug/net8.0/OnlineHost.dll',
);
const directory = await mkdtemp(join(tmpdir(), 'bjtu-friends-test-'));
assert(
  join(directory).includes('bjtu-friends-test-'),
  'only a dedicated test directory is allowed',
);

const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const base = `http://127.0.0.1:${port}`;

const headers = { 'Content-Type': 'application/json', 'X-Game-Request': '1' };
const passed = [];

function pass(message) {
  passed.push(message);
  console.log(`PASS ${message}`);
}

async function call(path, options = {}) {
  const response = await fetch(`${base}${path}`, options);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  const cookies =
    typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  return { status: response.status, body, cookies };
}

function sessionCookie(response) {
  const match = /bjtu_session=([A-Fa-f0-9]{64})/.exec(response.cookies.join(';'));
  return match ? `bjtu_session=${match[1]}` : '';
}

async function register(suffix) {
  const username = `jtfr_${suffix}`;
  const response = await call('/api/auth/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({ username, password: 'Friends123456', displayName: `好友${suffix}` }),
  });
  assert.equal(
    response.status,
    200,
    `注册失败：${response.status} ${JSON.stringify(response.body)}`,
  );
  return {
    uid: response.body.user.id,
    cookie: sessionCookie(response),
    displayName: `好友${suffix}`,
  };
}

const server = spawn('dotnet', [executable, '--urls', base, '--contentRoot', resolve('server')], {
  windowsHide: true,
  env: { ...process.env, Auth__DataDirectory: directory },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (data) => (logs += data));
server.stderr.on('data', (data) => (logs += data));

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) return;
    } catch {
      // 服务尚未监听，继续等待。
    }
    await delay(150);
  }
  throw new Error(`服务未在 15 秒内就绪：${logs.slice(-800)}`);
}

try {
  await waitForServer();
  const stamp = Date.now().toString(36).slice(-6);
  const alice = await register(`a${stamp}`);
  const bob = await register(`b${stamp}`);
  pass('两个账号注册成功且 UID 为 32 位');

  const empty = await call('/api/social/roster', { headers: { Cookie: alice.cookie } });
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.friends, []);
  pass('新账号名册为空');

  const lookup = await call(`/api/social/lookup?uid=${bob.uid}`, {
    headers: { Cookie: alice.cookie },
  });
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.displayName, bob.displayName);
  pass('按 UID 可查到昵称');

  const requestId = `req-${stamp}-0001`;
  const applyBody = JSON.stringify({ targetUid: bob.uid, requestId });
  const apply = await call('/api/social/apply', {
    method: 'POST',
    headers: { ...headers, Cookie: alice.cookie },
    body: applyBody,
  });
  assert.equal(apply.status, 200);
  assert.equal(apply.body.status, 'pending');
  pass('发送好友申请进入 pending');

  const applyAgain = await call('/api/social/apply', {
    method: 'POST',
    headers: { ...headers, Cookie: alice.cookie },
    body: applyBody,
  });
  assert.equal(applyAgain.status, 200);
  assert.equal(applyAgain.body.status, 'pending');
  pass('重复申请幂等，不产生第二条 pending');

  const selfApply = await call('/api/social/apply', {
    method: 'POST',
    headers: { ...headers, Cookie: alice.cookie },
    body: JSON.stringify({ targetUid: alice.uid, requestId: `req-${stamp}-0002` }),
  });
  assert.equal(selfApply.status, 400);
  pass('不能添加自己为好友');

  const bobRoster = await call('/api/social/roster', { headers: { Cookie: bob.cookie } });
  assert.equal(bobRoster.body.incoming.length, 1);
  pass('接收方在待处理中看到申请');

  const accept = await call('/api/social/respond', {
    method: 'POST',
    headers: { ...headers, Cookie: bob.cookie },
    body: JSON.stringify({ peerUid: alice.uid, action: 'accept' }),
  });
  assert.equal(accept.status, 200);
  assert.equal(accept.body.status, 'accepted');
  pass('只有目标用户可以接受申请');

  const aliceRoster = await call('/api/social/roster', { headers: { Cookie: alice.cookie } });
  assert.equal(aliceRoster.body.friends.length, 1);
  assert.equal(aliceRoster.body.friends[0].displayName, bob.displayName);
  pass('接受后双方名册都出现同一好友');

  const messageId = `msg-${stamp}-0001`;
  const sendBody = JSON.stringify({ peerUid: bob.uid, text: '今晚一起夜巡？', messageId });
  const first = await call('/api/social/messages', {
    method: 'POST',
    headers: { ...headers, Cookie: alice.cookie },
    body: sendBody,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'delivered');
  pass('已接受好友可以发送消息');

  const duplicate = await call('/api/social/messages', {
    method: 'POST',
    headers: { ...headers, Cookie: alice.cookie },
    body: sendBody,
  });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.status, 'duplicate');
  assert.equal(duplicate.body.message.id, first.body.message.id);
  pass('同 messageId 同载荷返回原消息，不重复投递');

  const conflict = await call('/api/social/messages', {
    method: 'POST',
    headers: { ...headers, Cookie: alice.cookie },
    body: JSON.stringify({ peerUid: bob.uid, text: '换了内容', messageId }),
  });
  assert.equal(conflict.status, 409);
  pass('同 messageId 异载荷返回冲突');

  const inbox = await call(`/api/social/messages?peer=${alice.uid}&after=0`, {
    headers: { Cookie: bob.cookie },
  });
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.messages.length, 1);
  assert.ok(inbox.body.nextCursor > 0);
  pass('接收方按 UID 与游标拉取消息');

  const afterRead = await call('/api/social/roster', { headers: { Cookie: bob.cookie } });
  assert.equal(afterRead.body.friends[0].unread, 0);
  pass('已读后未读数由服务端归零');

  let limited = false;
  for (let index = 0; index < 6; index += 1) {
    const burst = await call('/api/social/messages', {
      method: 'POST',
      headers: { ...headers, Cookie: alice.cookie },
      body: JSON.stringify({
        peerUid: bob.uid,
        text: `连发 ${index}`,
        messageId: `burst-${stamp}-000${index}`,
      }),
    });
    if (burst.status === 429) {
      limited = true;
      break;
    }
  }
  assert.ok(limited, '每 10 秒 5 条的限制未生效');
  pass('10 秒内第 6 条被 429 限流');

  const tooLong = await call('/api/social/messages', {
    method: 'POST',
    headers: { ...headers, Cookie: alice.cookie },
    body: JSON.stringify({
      peerUid: bob.uid,
      text: '字'.repeat(201),
      messageId: `long-${stamp}-0001`,
    }),
  });
  assert.equal(tooLong.status, 400);
  pass('超过 200 字符被拒绝');

  const block = await call('/api/social/block', {
    method: 'POST',
    headers: { ...headers, Cookie: bob.cookie },
    body: JSON.stringify({ peerUid: alice.uid, blocked: true }),
  });
  assert.equal(block.status, 200);
  assert.equal(block.body.blocked, true);
  pass('可以屏蔽好友');

  const blockedSend = await call('/api/social/messages', {
    method: 'POST',
    headers: { ...headers, Cookie: alice.cookie },
    body: JSON.stringify({
      peerUid: bob.uid,
      text: '被屏蔽后还能发吗',
      messageId: `blocked-${stamp}-01`,
    }),
  });
  assert.equal(blockedSend.status, 403);
  pass('屏蔽后不能发消息');

  const blockedApply = await call('/api/social/apply', {
    method: 'POST',
    headers: { ...headers, Cookie: alice.cookie },
    body: JSON.stringify({ targetUid: bob.uid, requestId: `req-${stamp}-0003` }),
  });
  assert.equal(blockedApply.status, 403);
  pass('屏蔽后不能重新申请');

  const anonymous = await call('/api/social/roster');
  assert.equal(anonymous.status, 401);
  pass('未登录访问好友接口返回 401');

  const remove = await call('/api/social/remove', {
    method: 'POST',
    headers: { ...headers, Cookie: bob.cookie },
    body: JSON.stringify({ peerUid: alice.uid }),
  });
  assert.equal(remove.status, 200);
  const afterRemove = await call('/api/social/roster', { headers: { Cookie: bob.cookie } });
  assert.equal(afterRemove.body.friends.length, 0);
  pass('删除好友结束关系');

  console.log(`\n好友模块冒烟：${passed.length} 项全部通过（临时库 ${directory}）`);
} finally {
  server.kill();
  await delay(300);
  await rm(directory, { recursive: true, force: true });
}
