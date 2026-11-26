import rules from '../../config/room-loot.json';
import type { NetworkSession } from './network-session';
import type { RoomChestSnapshot } from './network-protocol';

interface SearchRequest {
  readonly roundId: string;
  readonly requestId: string;
  readonly chest: RoomChestSnapshot;
  readonly startedAt: number;
  lastSentAt: number;
}

/** One pending pickup at a time. Only a matching server offer can insert loot. */
export class RoomLootSearch {
  private pending: SearchRequest | null = null;
  private blockedChest: string | null = null;
  private readonly handled = new Set<string>();
  private readonly offMessage: () => void;
  private readonly offStatus: () => void;

  constructor(
    private readonly network: NetworkSession,
    private readonly collect: (chest: RoomChestSnapshot) => boolean,
    private readonly notify: (message: string) => void,
    private readonly now: () => number = Date.now,
  ) {
    this.offStatus = network.onStatus((status) => {
      if (status !== 'connected') this.cancel();
    });
    this.offMessage = network.onMessage((message) => {
      if (message.type !== 'loot-result') return;
      if (this.handled.has(message.requestId)) return;
      const pending = this.pending;
      const matches =
        pending &&
        pending.roundId === message.roundId &&
        pending.requestId === message.requestId &&
        pending.chest.id === message.chestId &&
        network.getRoomState()?.roundId === message.roundId;
      if (message.status === 'offered') {
        this.handled.add(message.requestId);
        // Clearing before insertion is essential: ItemPicked may synchronously pause the scene.
        if (matches) this.pending = null;
        const accepted =
          !!matches && pending.chest.itemId === message.itemId && this.collect(pending.chest);
        network.acknowledgeLoot(message.roundId, message.requestId, accepted);
        return;
      }
      if (!matches || message.reason === 'SEARCH_INCOMPLETE') return;
      this.pending = null;
      this.blockedChest = message.chestId;
      this.notify(
        message.reason === 'CHEST_UNAVAILABLE'
          ? '这份物资已被队友领取，请寻找其他宝箱。'
          : '搜索已中断，请松开后重新搜索。',
      );
    });
  }

  hold(chest: RoomChestSnapshot): void {
    if (this.blockedChest === chest.id) return;
    const roundId = this.network.getRoomState()?.roundId;
    if (!roundId || !this.network.isInRoom()) {
      this.cancel();
      return;
    }
    if (this.pending && (this.pending.roundId !== roundId || this.pending.chest.id !== chest.id))
      this.cancel();
    if (!this.pending) {
      this.pending = {
        roundId,
        requestId: crypto.randomUUID(),
        chest,
        startedAt: this.now(),
        lastSentAt: -Infinity,
      };
    }
    const pending = this.pending;
    const now = this.now();
    if (now - pending.startedAt > 8000) {
      this.cancel();
      this.blockedChest = chest.id;
      this.notify('搜索确认超时，请检查网络后重试。');
      return;
    }
    if (now - pending.lastSentAt < 100) return;
    pending.lastSentAt = now;
    if (
      !this.network.sendLootSearch(
        roundId,
        pending.requestId,
        chest.id,
        now - pending.startedAt >= rules.searchDurationMs ? 'claim' : 'hold',
      )
    )
      this.cancel();
  }

  current(): string | null {
    return this.pending?.chest.id ?? null;
  }

  cancel(): void {
    this.blockedChest = null;
    const pending = this.pending;
    this.pending = null;
    if (pending)
      this.network.sendLootSearch(pending.roundId, pending.requestId, pending.chest.id, 'cancel');
  }

  reset(): void {
    this.cancel();
    this.handled.clear();
  }
  dispose(): void {
    this.cancel();
    this.offMessage();
    this.offStatus();
  }
}
