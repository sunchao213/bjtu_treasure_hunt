import { describe, expect, it, vi } from 'vitest';
import { NetworkSession, type NetworkSocket } from '../../src/modules/network/network-session';
import { RoomLootSearch } from '../../src/modules/network/room-loot-search';
import { onlineUnlockProgress } from '../../src/modules/network/online-unlock';
import { QUEST_CHAPTERS } from '../../src/modules/quests/quest-service';

class Socket implements NetworkSocket {
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  sent: Record<string, unknown>[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  receive(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

const chest = {
  id: 'flag-lawn-0',
  x: 107,
  y: 1525,
  zoneId: 'flag-lawn',
  itemId: 'school-badge',
  claimedBy: null,
};
function setup(accept = true) {
  let now = 0;
  const socket = new Socket();
  const network = new NetworkSession({
    url: 'ws://test',
    sessionId: 'test',
    displayName: '玩家',
    socketFactory: () => socket,
  });
  network.connect();
  socket.onopen?.();
  network.createRoom();
  socket.receive({
    type: 'room-state',
    roomId: '123456',
    tick: 1,
    hostId: 'p1',
    maxPlayers: 2,
    started: true,
    roundId: 'round-1',
    players: [],
    chests: [chest],
  });
  const collect = vi.fn(() => accept);
  const notify = vi.fn();
  const search = new RoomLootSearch(network, collect, notify, () => now);
  const result = (requestId: unknown, extra = {}) => ({
    type: 'loot-result',
    roundId: 'round-1',
    requestId,
    chestId: chest.id,
    status: 'offered',
    itemId: chest.itemId,
    ...extra,
  });
  return {
    socket,
    network,
    collect,
    notify,
    search,
    result,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('online access', () => {
  it('is available regardless of chapter progress', () => {
    const ids = QUEST_CHAPTERS.map((chapter) => chapter.id);
    expect(onlineUnlockProgress([]).unlocked).toBe(true);
    expect(onlineUnlockProgress(ids.slice(0, 2)).unlocked).toBe(true);
    expect(onlineUnlockProgress([...ids].reverse()).unlocked).toBe(true);
  });
});

describe('room loot receipt boundary', () => {
  it('waits for server confirmation and inserts matching grants exactly once', () => {
    const t = setup();
    t.search.hold(chest);
    const requestId = t.socket.sent.at(-1)!.requestId;
    t.advance(2000);
    t.search.hold(chest);
    expect(t.socket.sent.at(-1)).toMatchObject({ type: 'loot-search', stage: 'claim' });
    expect(t.collect).not.toHaveBeenCalled();
    t.socket.receive(t.result(requestId));
    t.socket.receive(t.result(requestId));
    expect(t.collect).toHaveBeenCalledExactlyOnceWith(chest);
    expect(t.socket.sent.at(-1)).toMatchObject({ type: 'loot-ack', accepted: true });
    t.search.dispose();
  });

  it('declines full bags, mismatched items, cancelled searches and old-round offers', () => {
    for (const mode of ['full', 'wrong-item', 'cancel', 'old-round']) {
      const t = setup(mode !== 'full');
      t.search.hold(chest);
      const requestId = t.socket.sent.at(-1)!.requestId;
      if (mode === 'cancel') t.search.cancel();
      if (mode === 'old-round')
        t.socket.receive({
          type: 'room-state',
          roomId: '123456',
          tick: 2,
          hostId: 'p1',
          maxPlayers: 2,
          started: true,
          roundId: 'round-2',
          players: [],
          chests: [chest],
        });
      t.socket.receive(t.result(requestId, mode === 'wrong-item' ? { itemId: 'siyuan-key' } : {}));
      if (mode !== 'full') expect(t.collect).not.toHaveBeenCalled();
      if (mode !== 'old-round')
        expect(t.socket.sent.at(-1)).toMatchObject({ type: 'loot-ack', accepted: false });
      t.search.dispose();
    }
  });

  it('keeps waiting for server duration and cancels stale confirmations on timeout', () => {
    const t = setup();
    t.search.hold(chest);
    const requestId = t.socket.sent.at(-1)!.requestId;
    t.socket.receive(
      t.result(requestId, { status: 'rejected', reason: 'SEARCH_INCOMPLETE', itemId: null }),
    );
    expect(t.search.current()).toBe(chest.id);
    t.advance(8100);
    t.search.hold(chest);
    expect(t.search.current()).toBeNull();
    expect(t.notify).toHaveBeenCalled();
    t.socket.receive(t.result(requestId));
    expect(t.collect).not.toHaveBeenCalled();
    expect(t.socket.sent.at(-1)).toMatchObject({ type: 'loot-ack', accepted: false });
    t.search.dispose();
  });

  it('does not send or accept loot after leaving the room', () => {
    const t = setup();
    t.search.hold(chest);
    const requestId = t.socket.sent.at(-1)!.requestId;
    t.network.leave();
    t.socket.receive(t.result(requestId));
    expect(t.collect).not.toHaveBeenCalled();
    expect(t.network.sendLootSearch('round-1', 'extra', chest.id, 'hold')).toBe(false);
    t.search.dispose();
  });
});
