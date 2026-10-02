import type { ActionResult, ItemInstance } from '../../shared/types/game';

/** A's reference interaction: search progress is separate from B's inventory ownership. */
export class SearchInteraction {
  private target: string | null = null;
  private startedAtMs = 0;
  private readonly opened = new Set<string>();
  constructor(
    private readonly durationMs: number,
    private readonly clock: () => number = Date.now,
  ) {}

  begin(id: string): boolean {
    if (this.opened.has(id)) {
      return false;
    }
    if (this.target !== id) {
      this.target = id;
      this.startedAtMs = this.clock();
    }
    return true;
  }
  progress(): number {
    return this.target === null
      ? 0
      : Math.min(1, (this.clock() - this.startedAtMs) / this.durationMs);
  }
  current(): string | null {
    return this.target;
  }
  isOpened(id: string): boolean {
    return this.opened.has(id);
  }
  cancel(): void {
    this.target = null;
  }
  reset(): void {
    this.cancel();
    this.opened.clear();
  }

  finish(item: ItemInstance, insert: (item: ItemInstance) => ActionResult): ActionResult {
    if (this.target === null || this.progress() < 1) {
      return { ok: false, error: 'INVALID_STATE' };
    }
    const result = insert(item);
    if (result.ok) {
      this.opened.add(this.target);
    }
    this.cancel();
    return result;
  }
}
