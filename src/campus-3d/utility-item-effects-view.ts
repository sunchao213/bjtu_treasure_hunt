import * as THREE from 'three';
import { UTILITY_ITEM_EFFECTS, type UtilityItemEffectFrame } from '../config/item-effects';
import type { Point } from '../shared/types/game';
import { toWorld } from './scene-config';

function makeSprite(scene: THREE.Scene, texture: THREE.Texture, name: string): THREE.Sprite {
  texture.repeat.set(0.25, 0.25);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sprite.name = name;
  sprite.visible = false;
  scene.add(sprite);
  return sprite;
}

function setFrame(sprite: THREE.Sprite, frame: number, flip = false): void {
  const texture = sprite.material.map!;
  texture.repeat.set(flip ? -0.25 : 0.25, 0.25);
  texture.offset.set(((frame % 4) + (flip ? 1 : 0)) / 4, 0.75 - Math.floor(frame / 4) / 4);
}

export class UtilityItemEffectsView {
  readonly bike: THREE.Sprite;
  readonly skates: THREE.Sprite;
  readonly shield: THREE.Sprite;
  readonly jacketBadge: THREE.Sprite;

  constructor(
    scene: THREE.Scene,
    bike: THREE.Texture,
    shield: THREE.Texture,
    jacket: THREE.Texture,
    skates: THREE.Texture,
  ) {
    this.bike = makeSprite(scene, bike, 'YellowBikeBoost');
    this.bike.scale.set(2.2, 1.5, 1);
    this.skates = makeSprite(scene, skates, 'RollerSkatesBoost');
    this.skates.scale.set(2.0, 1.35, 1);
    this.shield = makeSprite(scene, shield, 'DownJacketShield');
    this.shield.scale.set(2.45, 2.65, 1);
    this.jacketBadge = makeSprite(scene, jacket, 'DownJacketActivation');
    this.jacketBadge.scale.set(1.05, 1.05, 1);
  }

  update(frames: readonly UtilityItemEffectFrame[], position: Point, facingLeft: boolean): void {
    this.bike.visible =
      this.skates.visible =
      this.shield.visible =
      this.jacketBadge.visible =
        false;
    const p = toWorld(position);
    for (const state of frames) {
      const config = UTILITY_ITEM_EFFECTS[state.itemId];
      const indices = config[`${state.phase}Frames`];
      const frameMs = config[`${state.phase}FrameMs`];
      const index = Math.floor(Math.max(0, state.elapsedMs) / frameMs);
      if (state.phase !== 'loop' && index >= indices.length) continue;
      const frame = indices[state.phase === 'loop' ? index % indices.length : index];
      if (frame === undefined) continue;
      const endMs = config.endFrames.length * config.endFrameMs;
      const opacity = state.phase === 'end' ? Math.min(1, (endMs - state.elapsedMs) / 160) : 1;
      if (state.itemId === 'yellow-bike') {
        this.bike.visible = true;
        setFrame(this.bike, frame, facingLeft);
        this.bike.material.opacity = 0.95 * opacity;
        this.bike.position.set(p.x, 0.28, p.z);
      } else if (state.itemId === 'roller-skates') {
        this.skates.visible = true;
        setFrame(this.skates, frame, facingLeft);
        this.skates.material.opacity = 0.95 * opacity;
        this.skates.position.set(p.x, 0.28, p.z);
      } else {
        this.shield.visible = true;
        setFrame(this.shield, frame);
        this.shield.material.opacity = 0.85 * opacity;
        this.shield.position.set(p.x, 0.83, p.z);
        if (state.phase === 'start') {
          this.jacketBadge.visible = true;
          setFrame(this.jacketBadge, frame);
          this.jacketBadge.material.opacity = Math.min(1, (400 - state.elapsedMs) / 120);
          this.jacketBadge.position.set(p.x, 1.95, p.z);
        }
      }
    }
  }
}
