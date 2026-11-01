import type { ItemInstance, RaidResult, SavePort } from '../../shared/types/game';
import {
  FORMAL_SAVE_KEY,
  PersistentSave,
  type FormalSaveData,
  type SaveImportResult,
} from './persistent-save';
import type { StoragePort } from './reference-save';
import { CloudSaveError, type CloudSaveApi, type CloudSnapshot } from './cloud-save-api';

const memorySave = (raw: string | null): PersistentSave => {
  let value = raw;
  return new PersistentSave({
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
  });
};

export interface CloudSaveOptions {
  readonly onLost: () => void;
  readonly onStatus?: (message: string) => void;
}

/** Commit remote data first. Local storage is a best-effort backup, never an offline authority. */
export class CloudSave implements SavePort {
  private pending: Promise<void> = Promise.resolve();
  private closed = false;
  private checking = false;
  private readonly heartbeatTimer: ReturnType<typeof setInterval>;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private leaseDeadline = 0;
  private revision: number;
  private readonly token: string;
  private current: PersistentSave;

  private constructor(
    private readonly cache: StoragePort,
    private readonly api: CloudSaveApi,
    snapshot: CloudSnapshot,
    current: PersistentSave,
    private readonly options: CloudSaveOptions,
  ) {
    this.current = current;
    this.revision = snapshot.revision;
    this.token = snapshot.leaseToken;
    this.extend(snapshot.leaseExpiresAt);
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), 20_000);
  }

  static async connect(
    cache: StoragePort,
    api: CloudSaveApi,
    options: CloudSaveOptions,
  ): Promise<CloudSave> {
    const snapshot = await api.open();
    let cloud: CloudSave | undefined;
    try {
      // A server snapshot always wins. Import this account's old browser data only on its first sync.
      const current = memorySave(
        snapshot.data === null ? cache.getItem(FORMAL_SAVE_KEY) : JSON.stringify(snapshot.data),
      );
      cloud = new CloudSave(cache, api, snapshot, current, options);
      if (snapshot.data === null) await cloud.update(() => undefined);
      else cloud.backup();
      return cloud;
    } catch (error) {
      if (cloud) cloud.close();
      else await api.release(snapshot.leaseToken).catch(() => undefined);
      throw error;
    }
  }

  view(): FormalSaveData {
    return this.current.view();
  }
  exportRaw(): string {
    return this.current.exportRaw();
  }
  importRaw(raw: string): Promise<SaveImportResult> {
    return this.update((next) => next.importRaw(raw));
  }
  recoverInterrupted(): Promise<boolean> {
    return this.update((next) => next.recoverInterrupted());
  }
  reset(): Promise<void> {
    return this.update((next) => next.reset());
  }
  beginRaid(raidId: string, ids: readonly string[]): Promise<readonly ItemInstance[]> {
    return this.update((next) => next.beginRaid(raidId, ids));
  }
  finalizeRaid(result: RaidResult): Promise<void> {
    return this.update((next) => next.finalizeRaid(result));
  }

  private update<T>(operation: (next: PersistentSave) => T | Promise<T>): Promise<T> {
    const commit = this.pending.then(async () => {
      if (this.closed) throw new Error('云存档连接已关闭，请刷新后重试。');
      const next = memorySave(this.current.exportRaw());
      const result = await operation(next);
      this.options.onStatus?.('正在保存进度…');
      try {
        const reply = await this.api.write(this.token, this.revision, next.view());
        this.revision = reply.revision;
        this.current = next;
        this.extend(reply.leaseExpiresAt);
        this.backup();
        return result;
      } catch (error) {
        this.failure(error);
        throw error;
      }
    });
    this.pending = commit.then(
      () => undefined,
      () => undefined,
    );
    return commit;
  }

  private backup(): void {
    try {
      this.cache.setItem(FORMAL_SAVE_KEY, this.current.exportRaw());
      this.options.onStatus?.('进度已保存到云端');
    } catch {
      this.options.onStatus?.('云端已保存，本地备份暂不可用');
    }
  }

  private extend(expiresAt: number): void {
    if (this.closed) return;
    this.leaseDeadline = Math.max(this.leaseDeadline, expiresAt);
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => this.lost(), Math.max(0, this.leaseDeadline - Date.now()));
  }

  private async heartbeat(): Promise<void> {
    if (this.closed || this.checking) return;
    this.checking = true;
    try {
      this.extend((await this.api.heartbeat(this.token)).leaseExpiresAt);
    } catch (error) {
      this.failure(error);
    } finally {
      this.checking = false;
    }
  }

  private failure(error: unknown): void {
    this.options.onStatus?.(error instanceof Error ? error.message : '云存档保存失败，请重试。');
    if (error instanceof CloudSaveError && (error.status === 401 || error.status === 409))
      this.lost();
  }

  private lost(): void {
    if (this.closed) return;
    this.close();
    this.options.onLost();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.heartbeatTimer);
    clearTimeout(this.expiryTimer);
    void this.api.release(this.token).catch(() => undefined);
  }
}
