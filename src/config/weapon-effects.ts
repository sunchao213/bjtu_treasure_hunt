import type { Point } from '../shared/types/game';

/** Presentation only: the actual range, cooldown and damage stay in COMBAT_RULES. */
export const RULER_EFFECT = {
  slashAsset: 'effects/ruler-slash.png',
  sparksAsset: 'effects/ruler-sparks.png',
  columns: 4,
  rows: 2,
  slashMs: 160,
  sparksMs: 140,
  slashSize: 2.0,
  sparksSize: 1.1,
  slashHeadOffset: 1.8,
  height: 0.75,
} as const;

export interface RulerEffectFrame {
  readonly elapsedMs: number;
  readonly origin: Point;
  readonly aim: number;
  readonly hits: readonly Point[];
}
