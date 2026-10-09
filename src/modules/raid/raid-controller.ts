import { EventBus } from '../../shared/events/game-events';
import type {
  ActionResult,
  FailureReason,
  InventoryPort,
  ItemDefinition,
  RaidPhase,
  RaidResult,
  RaidRules,
  RaidView,
  SavePort,
} from '../../shared/types/game';
import { calculateExtractionValue } from '../inventory/extraction-value';

/** A owns all phase changes. This controller contains no Phaser or DOM dependencies. */
export class RaidController {
  private phase: RaidPhase = 'preparing';
  private raidId: string | null = null;
  private startedAtMs = 0;
  private endedAtMs: number | null = null;
  private extractionStartedAtMs: number | null = null;
  private inZone = false;
  private health = 0;
  private isBusy = false;
  private saveError = false;
  private result: RaidResult | null = null;
  private readonly unsubscribe: () => void;
  private readonly rules: RaidRules;
  private readonly definitions: Readonly<Record<string, ItemDefinition>>;

  constructor(
    private readonly inventory: InventoryPort,
    private readonly save: SavePort,
    private readonly bus: EventBus,
    rules: RaidRules,
    definitions: Readonly<Record<string, ItemDefinition>>,
    private readonly clock: () => number = Date.now,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {
    this.rules = structuredClone(rules);
    this.definitions = structuredClone(definitions);
    this.health = rules.maxHealth;
    this.unsubscribe = bus.on('InventoryChanged', ({ raidId }) => {
      if (
        raidId === this.raidId &&
        this.phase === 'extracting' &&
        this.value() < this.rules.threshold
      ) {
        this.cancelExtraction();
      }
    });
  }

  async start(loadoutIds: readonly string[] = []): Promise<ActionResult> {
    if (this.phase !== 'preparing' || this.isBusy) {
      return { ok: false, error: 'INVALID_STATE' };
    }
    this.isBusy = true;
    this.saveError = false;
    const raidId = this.newId();
    try {
      const loadout = await this.save.beginRaid(raidId, loadoutIds);
      this.inventory.begin(raidId, loadout);
      this.raidId = raidId;
      this.health = this.rules.maxHealth;
      this.startedAtMs = this.clock();
      this.endedAtMs = null;
      this.phase = 'active';
      return { ok: true, value: undefined };
    } catch {
      this.saveError = true;
      return { ok: false, error: 'SAVE_FAILED' };
    } finally {
      this.isBusy = false;
    }
  }

  getView(): RaidView {
    return {
      raidId: this.raidId,
      phase: this.phase,
      health: this.health,
      remainingMs: this.phase === 'preparing' ? this.rules.durationMs : this.remaining(),
      value: this.result?.value ?? this.value(),
      threshold: this.rules.threshold,
      inExtractionZone: this.inZone,
      extractionProgress:
        this.extractionStartedAtMs === null
          ? 0
          : Math.min(
              1,
              Math.max(
                0,
                (this.clock() - this.extractionStartedAtMs) / this.rules.extractionDurationMs,
              ),
            ),
      isBusy: this.isBusy,
      saveError: this.saveError,
      result: structuredClone(this.result),
    };
  }

  setExtractionPresence(isInside: boolean): void {
    this.inZone = isInside;
    if (!isInside) {
      this.cancelExtraction();
    }
  }

  startExtraction(): ActionResult {
    this.tick();
    if (this.phase !== 'active') {
      return { ok: false, error: 'INVALID_STATE' };
    }
    if (!this.inZone) {
      return { ok: false, error: 'NOT_IN_RANGE' };
    }
    if (this.value() < this.rules.threshold) {
      return { ok: false, error: 'VALUE_TOO_LOW' };
    }
    this.phase = 'extracting';
    this.extractionStartedAtMs = this.clock();
    if (this.raidId) {
      this.bus.emit('ExtractionStarted', { raidId: this.raidId });
    }
    return { ok: true, value: undefined };
  }

  cancelExtraction(): void {
    if (this.phase === 'extracting') {
      this.phase = 'active';
    }
    this.extractionStartedAtMs = null;
  }

  applyDamage(amount: number): void {
    if (!this.playable() || !Number.isFinite(amount) || amount <= 0) {
      return;
    }
    this.health = Math.max(0, this.health - amount);
    this.cancelExtraction();
    if (this.raidId) {
      this.bus.emit('DamageTaken', { raidId: this.raidId, amount, health: this.health });
    }
    this.tick();
  }

  heal(amount: number): boolean {
    if (!this.playable() || !Number.isFinite(amount) || amount <= 0) {
      return false;
    }
    if (this.health >= this.rules.maxHealth) {
      return false;
    }
    this.health = Math.min(this.rules.maxHealth, this.health + amount);
    return true;
  }

  tick(): void {
    if (!this.playable()) {
      return;
    }
    // Death and timeout are evaluated before extraction completion, including the exact boundary.
    if (this.health <= 0) {
      this.end('death');
      return;
    }
    if (this.remaining() <= 0) {
      this.end('timeout');
      return;
    }
    if (this.phase !== 'extracting') {
      return;
    }
    if (!this.inZone || this.value() < this.rules.threshold) {
      this.cancelExtraction();
      return;
    }
    if (
      this.extractionStartedAtMs !== null &&
      this.clock() - this.extractionStartedAtMs >= this.rules.extractionDurationMs
    ) {
      this.end(null);
    }
  }

  abandon(): void {
    if (this.playable()) {
      this.end('abandoned');
    }
  }

  async retrySettlement(): Promise<void> {
    if (this.phase !== 'settling' || !this.result || this.isBusy) {
      return;
    }
    this.isBusy = true;
    this.saveError = false;
    try {
      await this.save.finalizeRaid(structuredClone(this.result));
      this.phase = this.result.outcome;
      this.bus.emit('RaidEnded', structuredClone(this.result));
    } catch {
      this.saveError = true;
    } finally {
      this.isBusy = false;
    }
  }

  prepareNext(): boolean {
    if (this.phase !== 'success' && this.phase !== 'failed') {
      return false;
    }
    this.phase = 'preparing';
    this.raidId = null;
    this.result = null;
    this.inZone = false;
    this.extractionStartedAtMs = null;
    this.health = this.rules.maxHealth;
    this.inventory.clear();
    return true;
  }

  dispose(): void {
    this.unsubscribe();
  }
  private playable(): boolean {
    return this.phase === 'active' || this.phase === 'extracting';
  }
  private remaining(): number {
    return Math.max(
      0,
      this.rules.durationMs - ((this.endedAtMs ?? this.clock()) - this.startedAtMs),
    );
  }
  private value(): number {
    return this.raidId
      ? calculateExtractionValue(
          this.inventory.getCarriedItems(),
          this.raidId,
          this.definitions,
          this.rules.values,
        )
      : 0;
  }
  private end(reason: FailureReason | null): void {
    if (!this.playable() || !this.raidId) {
      return;
    }
    this.endedAtMs = this.clock();
    this.result = {
      raidId: this.raidId,
      outcome: reason ? 'failed' : 'success',
      reason,
      items: reason ? [] : this.inventory.getCarriedItems(),
      value: this.value(),
    };
    this.phase = 'settling';
    this.extractionStartedAtMs = null;
    void this.retrySettlement();
  }
}
