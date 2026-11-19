import { MONSTER_FRAME_SIZE, MONSTER_SPRITE_SHEETS } from './monster-sprites';

export interface SpriteSheetAsset {
  readonly key: string;
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/** 局内会加载的静态图。路径相对 `public/`。 */
export const IMAGE_ASSETS = {
  'campus-base': 'assets/maps/campus-night/campus-base.png',
  'generated-campus': 'assets/maps/generated-campus/generated-campus.jpg',
  'minghu-stele': 'assets/environment/minghu-stele.png',
} as const;

const PLAYER_FRAME = { width: 128, height: 160 };
const PLAYER_ATTACK_FRAME = { width: 314, height: 167 };

const CHARACTER_SHEETS: readonly SpriteSheetAsset[] = [
  {
    key: 'treasure-chest',
    path: 'assets/props/treasure-chest.png',
    frameWidth: 256,
    frameHeight: 256,
  },
  ...(['idle', 'walk', 'hurt', 'death'] as const).map((state) => ({
    key: `player-${state}`,
    path: `assets/characters/player/player-${state}.png`,
    frameWidth: PLAYER_FRAME.width,
    frameHeight: PLAYER_FRAME.height,
  })),
  {
    key: 'player-attack',
    path: 'assets/characters/player/player-attack.png',
    frameWidth: PLAYER_ATTACK_FRAME.width,
    frameHeight: PLAYER_ATTACK_FRAME.height,
  },
  {
    key: 'tiny-town-sheet',
    path: 'assets/environment/kenney-tiny-town/Tilemap/tilemap_packed.png',
    frameWidth: 16,
    frameHeight: 16,
  },
];

export const SPRITE_SHEETS: readonly SpriteSheetAsset[] = [
  ...CHARACTER_SHEETS,
  ...MONSTER_SPRITE_SHEETS.map((key) => ({
    key,
    path: `assets/characters/processed/${key}.png`,
    frameWidth: MONSTER_FRAME_SIZE,
    frameHeight: MONSTER_FRAME_SIZE,
  })),
];

export function worldAssetPaths(): readonly string[] {
  return [...Object.values(IMAGE_ASSETS), ...SPRITE_SHEETS.map((sheet) => sheet.path)];
}
