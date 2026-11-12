import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const geometry = JSON.parse(await readFile('src/config/campus-geometry.json', 'utf8'));

const directory = await mkdtemp(join(tmpdir(), 'bjtu-room-test-'));
const listener = net.createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const port = listener.address().port;
await new Promise((done) => listener.close(done));
const base = `http://127.0.0.1:${port}`;
let logs = '';
const server = spawn(
  'dotnet',
  [
    resolve('server/bin/Debug/net8.0/OnlineHost.dll'),
    '--contentRoot',
    resolve('server'),
    '--urls',
    base,
  ],
  {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, Auth__DataDirectory: directory, Logging__LogLevel__Default: 'Warning' },
  },
);
server.stdout.on('data', (chunk) => {
  logs += chunk;
});
server.stderr.on('data', (chunk) => {
  logs += chunk;
});
const peers = [];
async function waitFor(fn, description) {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (await fn()) return;
    await delay(20);
  }
  throw Error(`Timeout: ${description}\n${logs}`);
}
async function connect(index) {
  const displayName = `注册昵称${index}`;
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Game-Request': '1', Origin: base },
    body: JSON.stringify({
      username: `room_player_${index}`,
      password: 'room-test-password',
      displayName,
    }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith('bjtu_session=') && !value.startsWith('bjtu_session=;'))
    .split(';')[0];
  const socket = await new Promise((done, reject) => {
    const request = http.request(`${base}/ws`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        Cookie: cookie,
        Origin: base,
      },
    });
    request.on('upgrade', (_response, socket) => done(socket));
    request.on('response', (response) => reject(Error('WebSocket status ' + response.statusCode)));
    request.on('error', reject);
    request.end();
  });
  const peer = { socket, messages: [], id: '', displayName };
  peers.push(peer);
  socket.on('error', () => {});
  let buffer = Buffer.alloc(0);
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data]);
    while (buffer.length >= 2) {
      let length = buffer[1] & 127,
        header = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        header = 4;
      }
      if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        header = 10;
      }
      if (buffer.length < header + length) return;
      const opcode = buffer[0] & 15,
        payload = buffer.subarray(header, header + length);
      buffer = buffer.subarray(header + length);
      if (opcode === 1) peer.messages.push(JSON.parse(payload.toString()));
    }
  });
  const welcome = await request(
    peer,
    { type: 'hello', protocol: 1, sessionId: 'ignored', displayName: '伪造昵称' },
    (m) => m.type === 'welcome',
  );
  peer.id = welcome.playerId;
  return peer;
}
function send(peer, message) {
  const payload = Buffer.from(JSON.stringify(message)),
    mask = randomBytes(4);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0xfe, payload.length >> 8, payload.length & 255]);
  const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
  peer.socket.write(Buffer.concat([header, mask, masked]));
}
async function request(
  peer,
  message,
  predicate = (m) => m.type === 'room-state' || m.type === 'error',
) {
  const offset = peer.messages.length;
  send(peer, message);
  let found;
  await waitFor(
    () => (found = peer.messages.slice(offset).find(predicate)),
    JSON.stringify(message),
  );
  return found;
}
// Concurrent broadcasts can arrive out of order; clients apply the highest tick.
const lastState = (peer) =>
  peer.messages
    .filter((m) => m.type === 'room-state')
    .reduce((latest, current) => (!latest || current.tick > latest.tick ? current : latest), null);
try {
  await waitFor(async () => {
    try {
      return (await fetch(`${base}/health`)).ok;
    } catch {
      return false;
    }
  }, 'server');
  for (let i = 0; i < 12; i++) await connect(i);
  const host = peers[0];
  const created = await request(host, { type: 'create-room' });
  assert.match(created.roomId, /^[1-9][0-9]{5}$/);
  assert.equal(created.hostId, host.id);
  assert.equal(created.maxPlayers, 10);
  assert.equal(
    created.players[0].displayName,
    host.displayName,
    'registered nickname overrides spoofed hello',
  );
  const roomId = created.roomId;
  for (const bad of ['named-room', '12345', '1234567', '１２３４５６'])
    assert.equal(
      (await request(peers[1], { type: 'join-room', roomId: bad })).code,
      'INVALID_ROOM',
    );
  assert.equal(
    (await request(peers[1], { type: 'join-room', roomId: '000000' })).code,
    'ROOM_NOT_FOUND',
  );
  const limited = await request(host, {
    type: 'room-settings',
    maxPlayers: 2,
    admissionOpen: true,
  });
  assert.equal(limited.maxPlayers, 2);
  await request(peers[1], { type: 'join-room', roomId });
  assert.equal((await request(peers[2], { type: 'join-room', roomId })).code, 'ROOM_FULL');
  assert.equal(
    (await request(peers[1], { type: 'room-settings', maxPlayers: 10, admissionOpen: true })).code,
    'HOST_ONLY',
  );
  assert.equal(
    (await request(host, { type: 'room-settings', maxPlayers: 'bad', admissionOpen: true })).code,
    'INVALID_MESSAGE',
  );
  assert.equal(
    (await request(host, { type: 'room-settings', maxPlayers: 1, admissionOpen: true })).code,
    'INVALID_CAPACITY',
  );
  await request(peers[1], { type: 'set-ready', ready: true });
  const locked = await request(host, {
    type: 'room-settings',
    maxPlayers: 10,
    admissionOpen: false,
  });
  assert(
    locked.players.every((player) => !player.ready),
    'settings changes invalidate readiness',
  );
  assert.equal((await request(peers[2], { type: 'join-room', roomId })).code, 'ROOM_LOCKED');
  assert.equal(
    (await request(peers[1], { type: 'transfer-host', playerId: host.id })).code,
    'HOST_ONLY',
  );
  const transferred = await request(host, { type: 'transfer-host', playerId: peers[1].id });
  assert.equal(transferred.hostId, peers[1].id);
  assert(transferred.players.every((player) => !player.ready));
  await request(peers[1], { type: 'transfer-host', playerId: host.id });
  await request(host, { type: 'room-settings', maxPlayers: 10, admissionOpen: true });
  send(peers[1], { type: 'leave-room' });
  await waitFor(() => lastState(host).players.length === 1, 'settings test guest leaves');
  const attempts = await Promise.all(
    peers.slice(1).map((peer) => request(peer, { type: 'join-room', roomId })),
  );
  assert.equal(
    attempts.filter((m) => m.type === 'room-state').length,
    9,
    'exactly nine additional members admitted concurrently',
  );
  assert.equal(
    attempts.filter((m) => m.code === 'ROOM_FULL').length,
    2,
    'eleventh and twelfth players rejected',
  );
  await waitFor(() => lastState(host).players.length === 10, 'ten members');
  const members = peers.filter((peer) =>
    lastState(host).players.some((player) => player.playerId === peer.id),
  );
  const outsiders = peers.filter((peer) => !members.includes(peer));
  assert.equal((await request(members[1], { type: 'start-game' })).code, 'HOST_ONLY');
  assert.equal((await request(host, { type: 'start-game' })).code, 'NOT_ALL_READY');
  for (const peer of members.slice(1))
    await request(
      peer,
      { type: 'set-ready', ready: true },
      (m) => m.type === 'room-state' && m.players.find((p) => p.playerId === peer.id)?.ready,
    );
  await request(
    members[1],
    { type: 'set-ready', ready: false },
    (m) => m.type === 'room-state' && !m.players.find((p) => p.playerId === members[1].id)?.ready,
  );
  assert.equal(
    (await request(host, { type: 'start-game' })).code,
    'NOT_ALL_READY',
    'cancel ready closes start gate',
  );
  await request(
    members[1],
    { type: 'set-ready', ready: true },
    (m) => m.type === 'room-state' && m.players.find((p) => p.playerId === members[1].id)?.ready,
  );
  const started = await request(
    host,
    { type: 'start-game' },
    (m) => m.type === 'room-state' && m.started,
  );
  assert.equal(
    (await request(host, { type: 'room-settings', maxPlayers: 10, admissionOpen: false })).code,
    'ROOM_STARTED',
  );
  assert.equal(
    (await request(host, { type: 'transfer-host', playerId: members[1].id })).code,
    'ROOM_STARTED',
  );
  await waitFor(
    () => members.every((peer) => lastState(peer).roundId === started.roundId),
    'same round delivered to all members',
  );
  const spawns = new Map(started.players.map((player) => [player.playerId, player.position]));
  assert.equal(
    new Set(started.players.map((player) => JSON.stringify(player.position))).size,
    10,
    'all ten members have separate spawn positions',
  );
  assert(
    started.players.every(
      (player) =>
        Math.hypot(player.position.x - geometry.spawn.x, player.position.y - geometry.spawn.y) <
        200,
    ),
    'everyone spawns at the shared south gate',
  );
  for (const peer of members) {
    const before = lastState(peer).players.find((player) => player.playerId === peer.id).position;
    await delay(45);
    const moved = await request(
      peer,
      {
        type: 'player-input',
        roundId: started.roundId,
        sequence: 1,
        movement: { x: 1, y: 0 },
        aim: -2.5,
        actions: [],
      },
      (message) =>
        message.type === 'room-state' &&
        message.players.find((player) => player.playerId === peer.id)?.position.x > before.x,
    );
    const own = moved.players.find((player) => player.playerId === peer.id);
    assert(
      own.position.x - before.x <= geometry.playerSpeed * 0.1 + 0.01,
      'server movement uses shared speed and capped timestep',
    );
    assert.equal(own.aim, -2.5, 'full aim angle survives synchronization');
    await waitFor(
      () =>
        members.every((member) =>
          lastState(member).players.some(
            (player) =>
              player.playerId === peer.id &&
              player.position.x === own.position.x &&
              player.position.y === own.position.y,
          ),
        ),
      'all ten clients see identical movement coordinates',
    );
  }
  const unchanged = lastState(host).players.find((player) => player.playerId === host.id).position;
  send(host, {
    type: 'player-input',
    roundId: 'old-round',
    sequence: 99,
    movement: { x: 1, y: 0 },
    aim: 0,
    actions: [],
  });
  send(host, {
    type: 'player-input',
    roundId: started.roundId,
    sequence: 1,
    movement: { x: 1, y: 0 },
    aim: 0,
    actions: [],
  });
  await delay(80);
  assert.deepEqual(
    lastState(host).players.find((player) => player.playerId === host.id).position,
    unchanged,
    'old-round and duplicate movement inputs are ignored',
  );
  const walkerId = started.players.find(
    (player) => player.position.x === geometry.spawn.x && player.position.y === geometry.spawn.y,
  ).playerId;
  const walker = members.find((peer) => peer.id === walkerId);
  const wall = geometry.obstacles
    .filter(
      (obstacle) =>
        geometry.spawn.x + geometry.playerRadius > obstacle.x &&
        geometry.spawn.x - geometry.playerRadius < obstacle.x + obstacle.width &&
        obstacle.y + obstacle.height < geometry.spawn.y,
    )
    .sort((a, b) => b.y + b.height - (a.y + a.height))[0];
  assert(wall, 'shared map has an obstacle north of the spawn');
  const travelMs = ((geometry.spawn.y - wall.y - wall.height) / geometry.playerSpeed) * 1000 + 800;
  for (let sequence = 2; sequence < Math.ceil(travelMs / 40) + 2; sequence++) {
    await delay(40);
    await request(walker, {
      type: 'player-input',
      roundId: started.roundId,
      sequence,
      movement: { x: 0, y: -1 },
      aim: -Math.PI / 2,
      actions: [],
    });
  }
  const stopped = lastState(walker).players.find(
    (player) => player.playerId === walker.id,
  ).position;
  assert(
    stopped.y >= wall.y + wall.height + geometry.playerRadius &&
      stopped.y < wall.y + wall.height + geometry.playerRadius + 40,
    'server blocks movement at the same campus wall as the client',
  );
  assert.equal((await request(host, { type: 'start-game' })).code, 'ROOM_STARTED');
  assert.equal((await request(outsiders[0], { type: 'join-room', roomId })).code, 'ROOM_STARTED');
  assert.equal(
    (await request(host, { type: 'finish-game', roundId: 'stale-round' })).code,
    'INVALID_ROUND',
  );
  for (const peer of members)
    await request(
      peer,
      { type: 'finish-game', roundId: started.roundId },
      (m) => m.type === 'room-state' && m.players.find((p) => p.playerId === peer.id)?.finished,
    );
  await waitFor(
    () => members.every((peer) => lastState(peer).started === false),
    'lobby restored after all players finish',
  );
  assert(lastState(host).players.every((player) => !player.ready));
  for (const peer of members.slice(1))
    await request(
      peer,
      { type: 'set-ready', ready: true },
      (message) =>
        message.type === 'room-state' &&
        message.players.find((player) => player.playerId === peer.id)?.ready,
    );
  const nextRound = await request(
    host,
    { type: 'start-game' },
    (message) => message.type === 'room-state' && message.started,
  );
  assert.notEqual(nextRound.roundId, started.roundId);
  for (const player of nextRound.players)
    assert.deepEqual(
      player.position,
      spawns.get(player.playerId),
      'next round resets every player to the shared spawn grid',
    );
  for (const peer of members)
    await request(
      peer,
      { type: 'finish-game', roundId: nextRound.roundId },
      (message) =>
        message.type === 'room-state' &&
        message.players.find((player) => player.playerId === peer.id)?.finished,
    );
  const originalHost = lastState(host).hostId;
  const nextHost = lastState(host).players.find((p) => p.playerId !== originalHost).playerId;
  send(host, { type: 'leave-room' });
  await waitFor(() => lastState(members[1]).hostId === nextHost, 'host transfers to next member');
  assert.equal(lastState(members[1]).players.find((p) => p.playerId === nextHost).ready, false);
  const secondRoom = await request(outsiders[0], { type: 'create-room' });
  assert.match(secondRoom.roomId, /^[1-9][0-9]{5}$/);
  assert.notEqual(secondRoom.roomId, roomId, 'live room numbers cannot collide');
  assert.equal(secondRoom.players.length, 1, 'separate room membership');
  for (const peer of members.slice(1)) send(peer, { type: 'leave-room' });
  await delay(100);
  assert.equal((await request(host, { type: 'join-room', roomId })).code, 'ROOM_NOT_FOUND');
  console.log(
    'Room smoke passed: random six-digit codes, concurrent ten-player capacity, registered nicknames, host-only start, ready/cancel, synchronized rounds, next round, host transfer, room isolation and empty-room cleanup.',
  );
} finally {
  for (const peer of peers) peer.socket.destroy();
  if (server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill();
    await exited;
  }
  assert(directory.startsWith(join(tmpdir(), 'bjtu-room-test-')));
  await rm(directory, { recursive: true, force: true });
}
