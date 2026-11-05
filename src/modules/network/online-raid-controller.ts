import type { EventBus } from '../../shared/events/game-events';
import type { GameSnapshot } from '../../shared/net/protocol';
import type {
  ActionResult,
  RaidControllerPort,
  RaidRules,
  RaidView,
} from '../../shared/types/game';
import type { GameSession } from './game-session';

export class OnlineRaidController implements RaidControllerPort {
  private paused = false;
  private snapshot: GameSnapshot | null = null;

  constructor(
    private readonly session: GameSession,
    private readonly bus: EventBus,
    private readonly rules: RaidRules,
  ) {}

  applySnapshot(snapshot: GameSnapshot): void {
    this.snapshot = structuredClone(snapshot);
    if (snapshot.self.result) {
      this.bus.emit('RaidEnded', structuredClone(snapshot.self.result));
    }
  }

  getView(): RaidView {
    const self = this.snapshot?.self;
    if (!self) {
      return {
        raidId: this.session.raidId,
        phase: 'preparing',
        health: this.rules.maxHealth,
        remainingMs: this.rules.durationMs,
        value: 0,
        threshold: this.rules.threshold,
        inExtractionZone: false,
        extractionProgress: 0,
        isBusy: false,
        saveError: false,
        result: null,
      };
    }
    return {
      raidId: this.snapshot?.raidId ?? null,
      phase: self.phase,
      health: self.health,
      remainingMs: self.remainingMs,
      value: self.value,
      threshold: self.threshold,
      inExtractionZone: self.inExtractionZone,
      extractionProgress: self.extractionProgress,
      isBusy: false,
      saveError: false,
      result: self.result ?? null,
    };
  }

  isPaused(): boolean {
    return this.paused;
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
  async start(): Promise<ActionResult> {
    return this.session.requestAction('start')
      ? { ok: true, value: undefined }
      : { ok: false, error: 'INVALID_STATE' };
  }
  startExtraction(): ActionResult {
    return this.session.requestAction('start-extraction')
      ? { ok: true, value: undefined }
      : { ok: false, error: 'INVALID_STATE' };
  }
  abandon(): void {
    this.session.requestAction('abandon');
  }
  prepareNext(): boolean {
    return this.session.requestAction('prepare-next');
  }
  async retrySettlement(): Promise<void> {
    this.session.requestAction('retry-settlement');
  }
  heal(amount: number): boolean {
    void amount;
    return false;
  }
  getMoveSpeedMultiplier(): number {
    return 1;
  }
  activateInvulnerability(durationMs: number): boolean {
    void durationMs;
    return false;
  }
  setSpeedMultiplier(multiplier: number): boolean {
    void multiplier;
    return false;
  }
  applyDamage(amount: number): void {
    void amount;
  }
  cancelExtraction(): void {}
  setExtractionPresence(isInside: boolean): void {
    void isInside;
  }
  setQuestComplete(complete: boolean): void {
    void complete;
  }
  tick(): void {}
  dispose(): void {}
}
