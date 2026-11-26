import * as THREE from 'three';
import type { WorldFrame } from './world-frame';
import { toWorld } from './scene-config';
import { CHARGING_STATION_RANGE } from '../modules/world/charging-stations';

/** Three small, reusable visuals; simulation owns their placement and charge state. */
export class ChargingStationView {
  private readonly visuals: {
    group: THREE.Group;
    ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    bars: THREE.Mesh[];
    label: THREE.Sprite;
  }[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  update(frame: WorldFrame, elapsedMs: number): void {
    const stations = frame.chargingStations ?? [];
    stations.forEach((station, index) => {
      const visual = this.visuals[index] ?? this.create();
      const p = toWorld(station);
      visual.group.visible = true;
      visual.group.position.set(p.x, 0, p.z);
      visual.group.name = station.id;
      const near =
        Math.hypot(station.x - frame.position.x, station.y - frame.position.y) <
        CHARGING_STATION_RANGE;
      const charging = frame.target === `charge:${station.id}` && frame.searchProgress > 0;
      visual.ring.material.opacity = charging
        ? 0.55 + Math.sin(elapsedMs / 140) * 0.15
        : near
          ? 0.45
          : 0.2;
      visual.ring.scale.setScalar(charging ? 1 + frame.searchProgress * 0.15 : 1);
      visual.bars.forEach((bar, i) => {
        bar.visible = !charging || frame.searchProgress >= i / visual.bars.length;
      });
      visual.label.visible = near;
      visual.label.position.y = 2.2 + Math.sin(elapsedMs / 550) * 0.04;
    });
    for (let i = stations.length; i < this.visuals.length; i++)
      this.visuals[i]!.group.visible = false;
  }

  private create() {
    const group = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({
      color: 0xdce6e7,
      roughness: 0.45,
      metalness: 0.4,
    });
    const dark = new THREE.MeshStandardMaterial({ color: 0x162c36, roughness: 0.7 });
    const glow = new THREE.MeshStandardMaterial({
      color: 0x6ffff0,
      emissive: 0x25d9ba,
      emissiveIntensity: 2,
    });
    const box = (
      w: number,
      h: number,
      d: number,
      x: number,
      y: number,
      z: number,
      material: THREE.MeshStandardMaterial,
    ) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    box(0.95, 0.16, 0.72, 0, 0.08, 0, dark);
    box(0.64, 1.55, 0.46, 0, 0.93, 0, body);
    box(0.72, 0.12, 0.54, 0, 1.76, 0, glow);
    box(0.5, 0.67, 0.04, 0, 1.25, 0.25, dark);
    const bars = [0, 1, 2, 3].map((i) => box(0.07, 0.14, 0.03, -0.15 + i * 0.1, 1.43, 0.28, glow));
    const bolt = new THREE.Shape();
    bolt.moveTo(0.035, 0.18);
    bolt.lineTo(-0.12, -0.025);
    bolt.lineTo(-0.015, -0.025);
    bolt.lineTo(-0.055, -0.2);
    bolt.lineTo(0.13, 0.045);
    bolt.lineTo(0.02, 0.045);
    bolt.closePath();
    const lightning = new THREE.Mesh(new THREE.ShapeGeometry(bolt), glow);
    lightning.position.set(0, 1.1, 0.28);
    group.add(lightning);
    box(0.08, 1.18, 0.03, -0.25, 0.89, 0.25, glow);
    const cable = new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3([
          new THREE.Vector3(0.34, 1.4, 0),
          new THREE.Vector3(0.65, 1.1, 0.06),
          new THREE.Vector3(0.63, 0.5, 0.1),
          new THREE.Vector3(0.42, 0.55, 0.25),
          new THREE.Vector3(0.4, 1.15, 0.26),
        ]),
        16,
        0.028,
        5,
        false,
      ),
      dark,
    );
    group.add(cable);
    const handle = box(0.1, 0.24, 0.1, 0.4, 1.23, 0.26, dark);
    handle.rotation.z = -0.25;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.73, 0.84, 40),
      new THREE.MeshBasicMaterial({
        color: 0x5effde,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.025;
    group.add(ring);
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgba(9, 31, 39, 0.9)';
    context.fillRect(0, 0, 256, 64);
    context.strokeStyle = '#65ffe0';
    context.lineWidth = 3;
    context.strokeRect(2, 2, 252, 60);
    context.font = 'bold 32px "Microsoft YaHei", sans-serif';
    context.fillStyle = '#a0ffed';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('手电充电桩', 128, 33);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, depthTest: true, depthWrite: false }),
    );
    label.scale.set(1.6, 0.4, 1);
    label.position.y = 2.2;
    group.add(label);
    this.scene.add(group);
    const visual = { group, ring, bars, label };
    this.visuals.push(visual);
    return visual;
  }
}
