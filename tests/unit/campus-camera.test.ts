import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import {
  ORBIT_DEFAULTS,
  PlayerCameraRig,
  screenFacing,
  screenToGround,
} from '../../src/campus-3d/camera-rig';

describe('player orbit camera', () => {
  it('smooths a mouse step at the same rate across frame rates without a one-frame snap', () => {
    const run = (dt: number) => {
      const rig = new PlayerCameraRig(),
        camera = new PerspectiveCamera();
      rig.update(camera, new Vector3(), 0);
      rig.orbit(100, 30);
      for (let time = 0; time < 100 - 1e-5; time += dt) rig.update(camera, new Vector3(), dt);
      return rig;
    };
    expect(run(1000 / 30).viewYaw).toBeCloseTo(run(1000 / 60).viewYaw, 6);
    const rig = new PlayerCameraRig(),
      camera = new PerspectiveCamera();
    rig.orbit(100, 30);
    rig.update(camera, new Vector3(), 16);
    expect(Math.abs(rig.viewYaw)).toBeGreaterThan(0);
    expect(Math.abs(rig.viewYaw)).toBeLessThan(Math.abs(rig.yaw) / 2);
    rig.stopLook();
    const before = rig.viewYaw;
    rig.update(camera, new Vector3(), 100);
    expect(rig.viewYaw).toBeCloseTo(before);
  });

  it('crosses the yaw wrap along the short arc and resets both target and shown angles', () => {
    const rig = new PlayerCameraRig(),
      camera = new PerspectiveCamera();
    rig.viewYaw = Math.PI - 0.02;
    rig.yaw = -Math.PI + 0.02;
    rig.update(camera, new Vector3(), 16);
    expect(Math.abs(rig.viewYaw)).toBeGreaterThan(3);
    rig.reset();
    expect(rig.viewYaw).toBe(ORBIT_DEFAULTS.yaw);
    expect(rig.viewPitch).toBe(ORBIT_DEFAULTS.pitch);
  });

  it('rotates movement and sprite direction together without changing speed', () => {
    expect(screenToGround({ x: 0, y: -1 }, Math.PI / 2).x).toBeCloseTo(-1);
    expect(screenToGround({ x: 1, y: 0 }, Math.PI / 2).y).toBeCloseTo(-1);
    for (const yaw of [0, Math.PI / 2, Math.PI, -2.35]) {
      const movement = screenToGround({ x: 0.6, y: -0.8 }, yaw);
      expect(Math.hypot(movement.x, movement.y)).toBeCloseTo(1);
      const back = screenToGround(movement, -yaw);
      expect(back.x).toBeCloseTo(0.6);
      expect(back.y).toBeCloseTo(-0.8);
    }
    expect(screenFacing('left', Math.PI / 2)).toBe('up');
    expect(screenFacing('up', Math.PI)).toBe('down');
  });

  it('keeps the player centered at map edges and clamps pitch and zoom', () => {
    const rig = new PlayerCameraRig();
    const camera = new PerspectiveCamera(48, 1.6, 0.1, 400);
    const player = new Vector3(0.25, 0, 0.25);
    rig.orbit(120, -100000);
    rig.zoom(-100000);
    expect(rig.pitch).toBeCloseTo((12 * Math.PI) / 180);
    for (let i = 0; i < 30; i++) rig.zoom(-500);
    expect(rig.distance).toBe(5);
    rig.update(camera, player, 16);
    expect(new Vector3(0.25, 0.8, 0.25).project(camera).length()).toBeLessThan(1.01);
    const center = new Vector3(0.25, 0.8, 0.25).project(camera);
    expect(center.x).toBeCloseTo(0);
    expect(center.y).toBeCloseTo(0);
    rig.orbit(0, 100000);
    for (let i = 0; i < 30; i++) rig.zoom(500);
    expect(rig.pitch).toBeCloseTo((75 * Math.PI) / 180);
    expect(rig.distance).toBe(48);
    rig.reset();
    expect({ yaw: rig.yaw, pitch: rig.pitch, distance: rig.distance }).toEqual(ORBIT_DEFAULTS);
  });

  it('keeps the selected close camera distance through orbiting and movement', () => {
    const rig = new PlayerCameraRig();
    const camera = new PerspectiveCamera();
    const player = new Vector3(20, 0, 20),
      target = new Vector3(20, 0.8, 20);
    rig.update(camera, player, 16);
    expect(camera.position.distanceTo(target)).toBeCloseTo(5);
    rig.orbit(120, 50);
    rig.update(camera, player, 16);
    expect(camera.position.distanceTo(target)).toBeCloseTo(5);
    rig.zoom(200);
    rig.update(camera, player, 16);
    expect(camera.position.distanceTo(target)).toBeCloseTo(rig.distance);
    rig.update(camera, new Vector3(90, 0, 90), 16);
    expect(camera.position.distanceTo(new Vector3(90, 0.8, 90))).toBeCloseTo(rig.distance);
  });

  it('follows at the same rate at 30 and 60 FPS and snaps cleanly on respawn', () => {
    const follow = (dt: number) => {
      const rig = new PlayerCameraRig(),
        camera = new PerspectiveCamera();
      rig.update(camera, new Vector3(10, 0, 10), 0);
      for (let time = 0; time < 500 - 1e-5; time += dt)
        rig.update(camera, new Vector3(14, 0, 10), dt);
      return { rig, camera };
    };
    const slow = follow(1000 / 30),
      fast = follow(1000 / 60);
    expect(slow.camera.position.x).toBeCloseTo(fast.camera.position.x, 6);
    fast.rig.update(fast.camera, new Vector3(90, 0, 90), 16);
    const projected = new Vector3(90, 0.8, 90).project(fast.camera);
    expect(projected.x).toBeCloseTo(0);
    expect(projected.y).toBeCloseTo(0);
  });
});
