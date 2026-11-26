import * as THREE from 'three';
import { RULER_EFFECT, type RulerEffectFrame } from '../config/weapon-effects';
import type { Point } from '../shared/types/game';
import { toWorld } from './scene-config';

/** A reused slash billboard and a small reusable pool of actual impact billboards. */
export class RulerEffectView {
  readonly slash: THREE.Sprite;
  readonly sparks: THREE.Sprite[] = [];
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    slashTexture: THREE.Texture,
    private readonly sparksTexture: THREE.Texture,
  ) {
    this.slash = this.create('RulerSlash', slashTexture, RULER_EFFECT.slashSize);
    this.slash.material.opacity = 0.82;
    this.slash.material.depthTest = false;
    this.slash.renderOrder = 20;
  }

  private create(name: string, texture: THREE.Texture, size: number): THREE.Sprite {
    texture.repeat.set(1 / RULER_EFFECT.columns, 1 / RULER_EFFECT.rows);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    sprite.name = name;
    sprite.scale.set(size, size, 1);
    sprite.visible = false;
    this.scene.add(sprite);
    return sprite;
  }

  private animate(sprite: THREE.Sprite, elapsedMs: number, durationMs: number): void {
    sprite.visible = elapsedMs >= 0 && elapsedMs < durationMs;
    if (!sprite.visible) return;
    const frame = Math.min(7, Math.floor((elapsedMs / durationMs) * 8));
    sprite.material.map!.offset.set((frame % 4) / 4, 0.5 - Math.floor(frame / 4) / 2);
  }

  update(state: RulerEffectFrame | undefined, camera: THREE.Camera, position?: Point): void {
    this.slash.visible = false;
    for (const spark of this.sparks) spark.visible = false;
    if (!state) return;
    this.animate(this.slash, state.elapsedMs, RULER_EFFECT.slashMs);
    const origin = toWorld(position ?? state.origin);
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(camera.matrixWorld, 1);
    // The character is a billboard: camera-up keeps the slash above its head at every pitch.
    this.slash.position
      .set(origin.x, 0.03, origin.z)
      .addScaledVector(this.up, RULER_EFFECT.slashHeadOffset);
    // Preserve the locked attack direction while moving with the current player position.
    this.direction.set(Math.cos(state.aim), 0, Math.sin(state.aim));
    this.slash.material.rotation = Math.atan2(
      this.direction.dot(this.up),
      this.direction.dot(this.right),
    );
    if (state.elapsedMs < 0 || state.elapsedMs >= RULER_EFFECT.sparksMs) return;
    state.hits.forEach((position, index) => {
      const spark = (this.sparks[index] ??= this.create(
        'RulerHitSpark',
        this.sparksTexture.clone(),
        RULER_EFFECT.sparksSize,
      ));
      this.animate(spark, state.elapsedMs, RULER_EFFECT.sparksMs);
      const hit = toWorld(position);
      spark.position.set(hit.x, RULER_EFFECT.height, hit.z);
    });
  }
}
