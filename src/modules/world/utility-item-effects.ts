import {
  UTILITY_ITEM_EFFECTS,
  type UtilityItemEffectFrame,
  type UtilityItemEffectId,
} from '../../config/item-effects';

/** Presentation state begins only on successful consumption; gameplay still owns buffs. */
export class UtilityItemEffects {
  private readonly active = new Map<
    UtilityItemEffectId,
    { startedAt: number; brokenAt?: number }
  >();

  consume(itemId: string, now: number): void {
    if (itemId !== 'yellow-bike' && itemId !== 'roller-skates' && itemId !== 'thick-down-jacket')
      return;
    // Gameplay replaces a weaker speed boost; retire that trail at the same time.
    if (itemId === 'yellow-bike' || itemId === 'roller-skates') {
      const previous = this.active.get(itemId === 'yellow-bike' ? 'roller-skates' : 'yellow-bike');
      if (previous && previous.brokenAt === undefined) previous.brokenAt = now;
    }
    this.active.set(itemId, { startedAt: now });
  }

  shieldAbsorbed(remaining: number, now: number): void {
    const shield = this.active.get('thick-down-jacket');
    if (remaining <= 0 && shield && shield.brokenAt === undefined) shield.brokenAt = now;
  }

  frames(now: number): UtilityItemEffectFrame[] {
    const frames: UtilityItemEffectFrame[] = [];
    for (const [itemId, state] of this.active) {
      const config = UTILITY_ITEM_EFFECTS[itemId];
      const endAt = Math.min(state.startedAt + config.durationMs, state.brokenAt ?? Infinity);
      const age = now - state.startedAt;
      const endAge = now - endAt;
      const startMs = config.startFrames.length * config.startFrameMs;
      if (endAge >= config.endFrames.length * config.endFrameMs) {
        this.active.delete(itemId);
      } else if (age >= 0) {
        frames.push({
          itemId,
          phase: endAge >= 0 ? 'end' : age < startMs ? 'start' : 'loop',
          elapsedMs: endAge >= 0 ? endAge : age < startMs ? age : age - startMs,
        });
      }
    }
    return frames;
  }

  clear(): void {
    this.active.clear();
  }
}
