import type { ChestTier } from '../config/chest-config';
import type { ChargingStation } from '../modules/world/charging-stations';
import type { Point, ItemInstance } from '../shared/types/game';
import type { UtilityItemEffectFrame } from '../config/item-effects';
import type { Enemy, SoundWave } from '../modules/world/night-systems';
import type { Facing, PlayerAnimation } from './animation';
import type { NightFrame } from './night';
import type { StoryTrigger } from '../modules/world/story-triggers';

export interface GroundItem {
  item: ItemInstance;
  position: Point;
}
export interface WorldFrame {
  chargingStations?: readonly ChargingStation[];
  utilityEffects?: readonly UtilityItemEffectFrame[];
  /** Elapsed time of a successful local bandage use; absent outside its one-shot animation. */
  bandageHealingElapsedMs?: number;
  /** Successful local coffee healing; follows the same one-shot lifecycle as bandages. */
  coffeeHealingElapsedMs?: number;
  storyMarkers?: readonly StoryTrigger[];
  extraction?: { ready: boolean; active: boolean; progress: number };
  chests?: readonly (Point & { id: string; tier?: ChestTier })[];
  teammates?: readonly {
    id: string;
    name: string;
    position: Point;
    aim: number;
    moving: boolean;
  }[];
  position: Point;
  facing: Facing;
  action: PlayerAnimation;
  moving: boolean;
  opened: readonly string[];
  ground: readonly GroundItem[];
  prompt: string;
  searchProgress: number;
  target: string | null;
  night: NightFrame;
  visibleChests: readonly string[];
  combat: {
    enabled: boolean;
    enemies: readonly Enemy[];
    visibleEnemies: readonly string[];
    soundWaves?: readonly SoundWave[];
    swing: number;
    cooldown: number;
    invulnerable: boolean;
    hit: boolean;
    weapon: string;
    bagCount: number;
    uses: number | null;
  };
}
