import type { ActionResult, ItemInstance } from '../../shared/types/game';

/** A's reference interaction: search progress is separate from B's inventory ownership. */
export class SearchInteraction {
  private target: string | null = null;
  private startedAtMs = 0;
  private activeDurationMs: number;
  private nextDurationMs: number | null = null;
  private activeUsesNextDuration = false;
  private readonly opened = new Set<string>();
  constructor(
    private readonly durationMs: number,
    private readonly clock: () => number = Date.now,
  ) {
    this.activeDurationMs = durationMs;
  }

  /** Apply a one-shot duration to the next search that starts. */
  setNextDuration(durationMs: number): boolean {
    if (
      this.target !== null ||
      this.nextDurationMs !== null ||
      !Number.isFinite(durationMs) ||
      durationMs <= 0
    ) {
      return false;
    }
    this.nextDurationMs = Math.min(this.durationMs, durationMs);
    return true;
  }

  begin(id: string, durationOrApplyNext: number | boolean = true): boolean {
    if (this.opened.has(id)) {
      return false;
    }
    if (this.target !== id) {
      const applyNextDuration = durationOrApplyNext !== false;
      const baseDurationMs =
        typeof durationOrApplyNext === 'number' ? durationOrApplyNext : this.durationMs;
      this.activeUsesNextDuration = applyNextDuration && this.nextDurationMs !== null;
      this.target = id;
      this.startedAtMs = this.clock();
      this.activeDurationMs =
        applyNextDuration && this.nextDurationMs !== null
          ? Math.min(baseDurationMs, this.nextDurationMs)
          : baseDurationMs;
      if (applyNextDuration) this.nextDurationMs = null;
    }
    return true;
  }
  /** Read-only presentation state; the existing start/cancel rules own consumption. */
  nextDurationState(): 'ready' | 'searching' | undefined {
    return this.nextDurationMs !== null
      ? 'ready'
      : this.activeUsesNextDuration
        ? 'searching'
        : undefined;
  }
  progress(): number {
    return this.target === null
      ? 0
      : Math.min(1, (this.clock() - this.startedAtMs) / this.activeDurationMs);
  }
  current(): string | null {
    return this.target;
  }
  isOpened(id: string): boolean {
    return this.opened.has(id);
  }
  markOpened(id: string): void {
    this.opened.add(id);
    if (this.target === id) this.cancel();
  }
  cancel(): void {
    this.target = null;
    this.activeUsesNextDuration = false;
    this.activeDurationMs = this.durationMs;
  }
  reset(): void {
    this.cancel();
    this.nextDurationMs = null;
    this.opened.clear();
  }

  finish(item: ItemInstance, insert: (item: ItemInstance) => ActionResult): ActionResult {
    if (this.target === null || this.progress() < 1) {
      return { ok: false, error: 'INVALID_STATE' };
    }
    // Pickup listeners may open a story dialog and synchronously cancel the search.
    const completedTarget = this.target;
    const result = insert(item);
    if (result.ok) {
      this.opened.add(completedTarget);
    }
    this.cancel();
    return result;
  }
}
