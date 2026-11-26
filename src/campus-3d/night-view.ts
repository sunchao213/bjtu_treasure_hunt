import * as THREE from 'three';
import type { WorldFrame as TrialFrame } from './world-frame';
import { campusLamps } from './night';
import { toWorld } from './scene-config';
import type { TrialMap } from './map';
import type { LightSource } from '../modules/world/night-systems';

/** Fixed light pools keep shader/light count constant as flares expire. */
export class CampusNightView {
  private readonly flashlight = new THREE.SpotLight(0xffedbc, 65, 11, Math.PI / 5, 0.35, 1.2);
  private readonly personal = new THREE.PointLight(0xaac7ff, 1.5, 2.4, 1.5);
  private readonly lamps = Array.from(
    { length: 4 },
    () => new THREE.PointLight(0xffcc83, 15, 6, 1.5),
  );
  private readonly flares = Array.from({ length: 2 }, () => {
    const light = new THREE.SpotLight(0xffa756, 22, 10, Math.atan(175 / 32 / 3.5), 0.5, 1.2);
    light.castShadow = true;
    light.shadow.mapSize.set(512, 512);
    light.shadow.normalBias = 0.035;
    return {
      light,
      marker: new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.24, 6),
        new THREE.MeshStandardMaterial({
          color: 0xffb56d,
          emissive: 0xff642a,
          emissiveIntensity: 3,
        }),
      ),
    };
  });
  private readonly positions;

  constructor(scene: THREE.Scene, map: TrialMap, lamps?: readonly LightSource[]) {
    this.positions = (lamps ?? campusLamps(map)).map(toWorld);
    this.flashlight.castShadow = true;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.12;
    this.flashlight.shadow.normalBias = 0.025;
    scene.add(this.flashlight, this.flashlight.target, this.personal, ...this.lamps);
    for (const f of this.flares) {
      f.light.visible = f.marker.visible = false;
      scene.add(f.light, f.light.target, f.marker);
    }
    const poleGeometry = new THREE.CylinderGeometry(0.035, 0.055, 2.8, 6);
    const bulbGeometry = new THREE.SphereGeometry(0.15, 8, 6);
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x3e4b54, roughness: 0.7 });
    const bulbMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe3ad,
      emissive: 0xffbf6a,
      emissiveIntensity: 3,
    });
    for (const p of this.positions) {
      const pole = new THREE.Mesh(poleGeometry, poleMaterial);
      pole.position.set(p.x, 1.4, p.z);
      const bulb = new THREE.Mesh(bulbGeometry, bulbMaterial);
      bulb.position.set(p.x, 2.85, p.z);
      scene.add(pole, bulb);
    }
  }

  update(frame: TrialFrame): void {
    const p = toWorld(frame.position),
      n = frame.night;
    this.flashlight.visible = n.flashlight;
    this.flashlight.position.set(p.x, 1.25, p.z);
    this.flashlight.target.position.set(p.x + Math.cos(n.aim) * 8, 0.1, p.z + Math.sin(n.aim) * 8);
    this.flashlight.target.updateMatrixWorld();
    this.personal.position.set(p.x, 0.8, p.z);
    const nearest = [...this.positions].sort(
      (a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z),
    );
    this.lamps.forEach((light, i) => {
      const q = nearest[i];
      light.visible = !!q;
      if (q) light.position.set(q.x, 2.7, q.z);
    });
    this.flares.forEach(({ light, marker }, i) => {
      const flare = n.flares[i];
      light.visible = marker.visible = !!flare;
      if (!flare) return;
      const q = toWorld(flare);
      light.position.set(q.x, 3.5, q.z);
      light.target.position.set(q.x, 0, q.z);
      light.target.updateMatrixWorld();
      // Fade over the last two seconds instead of an abrupt disappearance.
      light.intensity = 22 * Math.min(1, flare.remainingMs / 2000);
      marker.position.set(q.x, 0.14, q.z);
    });
  }
}
