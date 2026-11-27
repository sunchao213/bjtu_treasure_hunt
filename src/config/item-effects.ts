import type { Point } from '../shared/types/game';
import { UTILITY_EFFECTS } from './game-config';

export interface HealingItemEffectConfig {
  readonly asset: string;
  readonly name: string;
  readonly size: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly animationMs: number;
  readonly fadeInMs: number;
  readonly fadeOutMs: number;
  readonly durationMs: number;
}

/** User-supplied 1024 × 1024 RGBA sheet; frames run left-to-right, top-to-bottom. */
export const BANDAGE_HEALING_EFFECT = {
  asset: 'effects/healing-bandage.png',
  name: 'BandageHealing',
  size: 0.8,
  height: 1.9,
  columns: 4,
  rows: 4,
  animationMs: 1_000,
  fadeInMs: 60,
  fadeOutMs: 200,
  durationMs: 1_200,
} as const;

export const COFFEE_HEALING_EFFECT = {
  asset: 'effects/healing-morning-coffee.png',
  name: 'MorningCoffeeHealing',
  size: 1.05,
  height: 2.02,
  columns: 4,
  rows: 4,
  animationMs: 1_200,
  fadeInMs: 60,
  fadeOutMs: 200,
  durationMs: 1_400,
} as const;

/** Explicit frame ranges: sustained effects must never loop their disappearance frames. */
export const UTILITY_ITEM_EFFECTS = {
  'yellow-bike': {
    asset: 'effects/boost-yellow-bike.png',
    durationMs: UTILITY_EFFECTS['yellow-bike']!.durationMs,
    startFrames: [0, 1, 2, 3],
    loopFrames: [4, 5, 6, 7, 8, 9, 10, 11],
    endFrames: [12, 13, 14, 15],
    startFrameMs: 100,
    loopFrameMs: 100,
    endFrameMs: 100,
  },
  'roller-skates': {
    asset: 'effects/boost-roller-skates.png',
    durationMs: UTILITY_EFFECTS['roller-skates']!.durationMs,
    startFrames: [0, 1, 2, 3],
    loopFrames: [4, 5, 6, 7, 8, 9, 10, 11],
    endFrames: [12, 13, 14, 15],
    startFrameMs: 100,
    loopFrameMs: 100,
    endFrameMs: 100,
  },
  'thick-down-jacket': {
    asset: 'effects/shield-down-jacket.png',
    auraAsset: 'effects/shield-down-jacket-aura.png',
    durationMs: UTILITY_EFFECTS['thick-down-jacket']!.durationMs,
    startFrames: [0, 1, 2, 3],
    loopFrames: [4, 5, 6, 7, 8, 9],
    endFrames: [10, 11, 12, 13, 14, 15],
    startFrameMs: 100,
    loopFrameMs: 100,
    endFrameMs: 80,
  },
} as const;

export type UtilityItemEffectId = keyof typeof UTILITY_ITEM_EFFECTS;
export interface UtilityItemEffectFrame {
  readonly itemId: UtilityItemEffectId;
  readonly phase: 'start' | 'loop' | 'end';
  readonly elapsedMs: number;
}

/** Detector gameplay owns the target and eight-second lifetime. */
export const DETECTOR_EFFECT = {
  asset: 'effects/detector-activation.png',
  markerAsset: 'effects/detector-direction.png',
  name: 'DetectorActivation',
  size: 0.95,
  height: 2.0,
  columns: 4,
  rows: 4,
  animationMs: 1_200,
  fadeInMs: 60,
  fadeOutMs: 150,
  durationMs: 1_200,
} as const;

export interface DetectorEffectFrame {
  readonly elapsedMs: number;
  readonly remainingMs: number;
  readonly target: Point;
}

export const QUICK_NOTE_EFFECT = {
  asset: 'effects/quick-note-use.png',
  readyAsset: 'effects/quick-note-ready.png',
  name: 'QuickNoteUse',
  size: 0.72,
  height: 1.95,
  columns: 4,
  rows: 4,
  animationMs: 1_000,
  fadeInMs: 60,
  fadeOutMs: 140,
  durationMs: 1_000,
} as const;

export interface QuickNoteEffectFrame {
  readonly elapsedMs: number;
  readonly status: 'ready' | 'searching' | undefined;
}
