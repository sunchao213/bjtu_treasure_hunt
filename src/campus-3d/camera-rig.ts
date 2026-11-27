import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import type { Point } from '../shared/types/game';
import { facingFromDirection, type Facing } from './animation';

export const ORBIT_DEFAULTS = { yaw: 0, pitch: MathUtils.degToRad(18), distance: 5 };

/** Screen axes projected onto the ground. Their length never changes move speed. */
export function screenToGround(move: Point, yaw: number): Point {
  return {
    x: move.x * Math.cos(yaw) + move.y * Math.sin(yaw),
    y: -move.x * Math.sin(yaw) + move.y * Math.cos(yaw),
  };
}

export function screenFacing(facing: Facing, yaw: number): Facing {
  const direction = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  }[facing];
  return facingFromDirection(screenToGround(direction, -yaw));
}

/** A close third-person orbit; geometry never overrides the selected distance. */
export class PlayerCameraRig {
  yaw = ORBIT_DEFAULTS.yaw;
  pitch = ORBIT_DEFAULTS.pitch;
  distance = ORBIT_DEFAULTS.distance;
  viewYaw = ORBIT_DEFAULTS.yaw;
  viewPitch = ORBIT_DEFAULTS.pitch;
  private readonly focus = new Vector3();
  private readonly desired = new Vector3();
  private readonly offset = new Vector3();
  private initialized = false;

  orbit(dx: number, dy: number): void {
    this.yaw = MathUtils.euclideanModulo(this.yaw - dx * 0.006 + Math.PI, Math.PI * 2) - Math.PI;
    this.pitch = MathUtils.clamp(
      this.pitch + dy * 0.004,
      MathUtils.degToRad(12),
      MathUtils.degToRad(75),
    );
  }

  zoom(delta: number): void {
    this.distance = MathUtils.clamp(
      this.distance * Math.exp(MathUtils.clamp(delta, -500, 500) * 0.001),
      5,
      48,
    );
  }

  reset(): void {
    Object.assign(this, ORBIT_DEFAULTS);
    this.viewYaw = this.yaw;
    this.viewPitch = this.pitch;
  }

  stopLook(): void {
    this.yaw = this.viewYaw;
    this.pitch = this.viewPitch;
  }

  setState(yaw: number, pitch: number, distance: number): void {
    this.yaw = yaw;
    this.pitch = MathUtils.clamp(pitch, MathUtils.degToRad(12), MathUtils.degToRad(75));
    this.distance = MathUtils.clamp(distance, 5, 48);
    this.viewYaw = this.yaw;
    this.viewPitch = this.pitch;
  }

  update(camera: PerspectiveCamera, position: Vector3, deltaMs: number): void {
    const lookT = 1 - Math.exp(-MathUtils.clamp(deltaMs, 0, 100) / 45);
    // Interpolate the shortest angular arc across ±PI, independent of event rate.
    const yawDelta = Math.atan2(
      Math.sin(this.yaw - this.viewYaw),
      Math.cos(this.yaw - this.viewYaw),
    );
    this.viewYaw =
      MathUtils.euclideanModulo(this.viewYaw + yawDelta * lookT + Math.PI, Math.PI * 2) - Math.PI;
    this.viewPitch = MathUtils.lerp(this.viewPitch, this.pitch, lookT);
    const t = 1 - Math.exp(-MathUtils.clamp(deltaMs, 0, 100) / 110);
    this.desired.copy(position).y += 0.8;
    if (!this.initialized || this.focus.distanceToSquared(this.desired) > 100) {
      this.focus.copy(this.desired);
      this.initialized = true;
    } else {
      this.focus.lerp(this.desired, t);
    }
    this.offset.set(
      Math.sin(this.viewYaw) * Math.cos(this.viewPitch),
      Math.sin(this.viewPitch),
      Math.cos(this.viewYaw) * Math.cos(this.viewPitch),
    );
    camera.position.copy(this.focus).addScaledVector(this.offset, this.distance);
    camera.lookAt(this.focus);
    camera.updateMatrixWorld();
  }
}
