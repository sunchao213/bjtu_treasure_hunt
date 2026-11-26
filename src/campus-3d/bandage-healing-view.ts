import * as THREE from 'three';
import { BANDAGE_HEALING_EFFECT, type HealingItemEffectConfig } from '../config/item-effects';
import type { Point } from '../shared/types/game';
import { toWorld } from './scene-config';

/** One reusable billboard, above the player rather than covering the character. */
export class BandageHealingView {
  readonly sprite: THREE.Sprite;

  constructor(
    scene: THREE.Scene,
    private readonly texture: THREE.Texture,
    private readonly effect: HealingItemEffectConfig = BANDAGE_HEALING_EFFECT,
  ) {
    texture.repeat.set(1 / effect.columns, 1 / effect.rows);
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.sprite = new THREE.Sprite(material);
    this.sprite.name = effect.name;
    this.sprite.scale.set(effect.size, effect.size, 1);
    this.sprite.visible = false;
    scene.add(this.sprite);
  }

  update(elapsedMs: number | undefined, position: Point): void {
    const effect = this.effect;
    this.sprite.visible =
      elapsedMs !== undefined && elapsedMs >= 0 && elapsedMs < effect.durationMs;
    if (!this.sprite.visible || elapsedMs === undefined) return;

    const frame = Math.min(
      effect.columns * effect.rows - 1,
      Math.floor((elapsedMs / effect.animationMs) * effect.columns * effect.rows),
    );
    // Texture UVs start at the bottom; the source sheet starts at the top left.
    this.texture.offset.set(
      (frame % effect.columns) / effect.columns,
      1 - (Math.floor(frame / effect.columns) + 1) / effect.rows,
    );
    this.sprite.material.opacity =
      0.9 *
      Math.min(1, elapsedMs / effect.fadeInMs) *
      Math.min(1, (effect.durationMs - elapsedMs) / effect.fadeOutMs);
    const p = toWorld(position);
    this.sprite.position.set(
      p.x,
      effect.height + 0.12 * Math.min(1, elapsedMs / effect.animationMs),
      p.z,
    );
  }
}
