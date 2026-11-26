import * as THREE from 'three';
import { QUICK_NOTE_EFFECT, type QuickNoteEffectFrame } from '../config/item-effects';
import type { Point } from '../shared/types/game';
import { BandageHealingView } from './bandage-healing-view';
import { toWorld } from './scene-config';

/** One-shot writing feedback followed by a small, camera-facing prepared-search badge. */
export class QuickNoteEffectView {
  readonly activation: BandageHealingView;
  readonly ready: THREE.Sprite;
  private readonly right = new THREE.Vector3();

  constructor(scene: THREE.Scene, activation: THREE.Texture, ready: THREE.Texture) {
    this.activation = new BandageHealingView(scene, activation, QUICK_NOTE_EFFECT);
    this.ready = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: ready,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    this.ready.name = 'QuickNoteReady';
    this.ready.scale.set(0.32, 0.32, 1);
    this.ready.renderOrder = 20;
    this.ready.visible = false;
    scene.add(this.ready);
  }

  update(state: QuickNoteEffectFrame | undefined, position: Point, camera: THREE.Camera): void {
    this.activation.update(state?.elapsedMs, position);
    this.ready.visible =
      state !== undefined &&
      state.elapsedMs >= QUICK_NOTE_EFFECT.durationMs &&
      state.status !== undefined;
    if (!this.ready.visible || !state) return;
    const p = toWorld(position);
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.ready.position.set(p.x, 1.48, p.z).addScaledVector(this.right, 0.65);
    this.ready.material.opacity =
      state.status === 'searching' ? 0.82 + 0.12 * Math.sin(state.elapsedMs / 160) : 0.95;
  }
}
