import * as THREE from 'three';
import { DETECTOR_EFFECT, type DetectorEffectFrame } from '../config/item-effects';
import type { Point } from '../shared/types/game';
import { BandageHealingView } from './bandage-healing-view';
import { toWorld } from './scene-config';

/** A short activation above the head and a camera-relative, rotating loot pointer. */
export class DetectorEffectView {
  readonly activation: BandageHealingView;
  readonly marker: THREE.Sprite;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly direction = new THREE.Vector3();

  constructor(scene: THREE.Scene, activation: THREE.Texture, marker: THREE.Texture) {
    this.activation = new BandageHealingView(scene, activation, DETECTOR_EFFECT);
    this.marker = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: marker,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      }),
    );
    this.marker.name = 'DetectorLootDirection';
    this.marker.scale.set(0.58, 0.58, 1);
    this.marker.renderOrder = 20;
    this.marker.visible = false;
    scene.add(this.marker);
  }

  update(state: DetectorEffectFrame | undefined, position: Point, camera: THREE.Camera): void {
    const active = state !== undefined && state.elapsedMs >= 0 && state.remainingMs > 0;
    this.activation.update(active ? state.elapsedMs : undefined, position);
    this.marker.visible = false;
    if (!active) return;
    const p = toWorld(position);
    const target = toWorld(state.target);
    this.direction.set(target.x - p.x, 0, target.z - p.z);
    if (this.direction.lengthSq() < 0.0001) return;
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(camera.matrixWorld, 1);
    // Project a direction, not the remote target position: targets behind the
    // perspective camera must still point back rather than flip to the front.
    const x = this.direction.dot(this.right);
    const y = this.direction.dot(this.up);
    const length = Math.hypot(x, y);
    if (length < 0.0001) return;
    this.marker.visible = true;
    this.marker.position
      .set(p.x, 0.92, p.z)
      .addScaledVector(this.right, (x / length) * 1.05)
      .addScaledVector(this.up, (y / length) * 1.05);
    // Source arrow points up; SpriteMaterial rotation is counterclockwise.
    this.marker.material.rotation = Math.atan2(-x, y);
    this.marker.material.opacity =
      (0.82 + 0.14 * Math.sin(state.elapsedMs / 220)) *
      Math.min(1, state.elapsedMs / 80, state.remainingMs / 300);
  }
}
