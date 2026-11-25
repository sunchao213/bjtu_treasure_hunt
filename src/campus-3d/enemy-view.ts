import * as THREE from 'three';
import {
  MONSTER_ANIMATIONS,
  MONSTER_FRAME_SIZE,
  MONSTER_SPRITE_SHEETS,
  monsterAnimationFor,
} from '../config/monster-sprites';
import { COMBAT_RULES } from '../config/combat-config';
import { toWorld } from './scene-config';
import type { WorldFrame as TrialFrame } from './world-frame';
import { assetUrl } from '../app/asset-url';

interface EnemyVisual {
  root: THREE.Group;
  billboard: THREE.Group;
  body: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  health: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
  key: string;
  started: number;
  x: number;
  y: number;
  healthValue: number;
  hurtUntil: number;
}

/** Existing animal sheets become feet-anchored billboards in the real 3D scene. */
export class CampusEnemyView {
  private readonly sources = new Map<string, THREE.Texture>();
  private readonly labels = new Map<string, THREE.SpriteMaterial>();
  private readonly visuals = new Map<string, EnemyVisual>();
  private readonly swing = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 2.55, 32, 1, -1.25, 2.5),
    new THREE.MeshBasicMaterial({
      color: 0xffe5a0,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {
    this.swing.rotation.x = -Math.PI / 2;
    this.swing.visible = false;
    scene.add(this.swing);
  }

  async init(): Promise<void> {
    const loader = new THREE.TextureLoader();
    await Promise.all(
      MONSTER_SPRITE_SHEETS.map(async (key) => {
        const texture = await loader.loadAsync(assetUrl(`assets/characters/processed/${key}.png`));
        if (this.disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.magFilter = texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        this.sources.set(key, texture);
      }),
    );
    if (this.disposed) return;
    for (const [key, text, color] of [
      ['request', '长按 Q 抱抱', '#a5efbe'],
      ['windup', '即将攻击 · 躲开', '#ffb3a0'],
      ['mutation-warning', '即将变异 · 远离', '#ffcc7c'],
      ['calmed', '已安抚', '#a5efbe'],
      ['stunned', '眩晕', '#b6d9ff'],
    ]) {
      const canvas = document.createElement('canvas');
      canvas.width = 384;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0b1625e8';
      ctx.fillRect(0, 0, 384, 64);
      ctx.fillStyle = color!;
      ctx.font = 'bold 26px Microsoft YaHei';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text!, 192, 32);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      this.labels.set(
        key!,
        new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false }),
      );
    }
  }

  private create(id: string, now: number): EnemyVisual {
    const root = new THREE.Group(),
      billboard = new THREE.Group();
    root.name = `Enemy_${id}`;
    const body = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.8).translate(0, 0.9, 0),
      new THREE.MeshBasicMaterial({ alphaTest: 0.4, side: THREE.DoubleSide }),
    );
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.07),
      new THREE.MeshBasicMaterial({ color: 0x172030 }),
    );
    back.position.set(0, 1.9, 0);
    const health = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.07).translate(0.55, 0, 0),
      new THREE.MeshBasicMaterial({ color: 0xe4977d }),
    );
    health.position.set(-0.55, 1.9, 0.005);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.43, 24),
      new THREE.MeshBasicMaterial({ color: 0xc57965, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    const label = new THREE.Sprite(this.labels.get('request')!);
    label.position.set(0, 2.17, 0);
    label.scale.set(1.6, 0.27, 1);
    label.visible = false;
    billboard.add(body, back, health);
    root.add(billboard, ring, label);
    this.scene.add(root);
    const visual = {
      root,
      billboard,
      body,
      health,
      ring,
      label,
      key: '',
      started: now,
      x: NaN,
      y: NaN,
      healthValue: Infinity,
      hurtUntil: 0,
    };
    this.visuals.set(id, visual);
    return visual;
  }

  update(frame: TrialFrame, camera: THREE.Camera, now: number): void {
    if (this.disposed) return;
    const present = new Set(frame.combat.enemies.map((e) => e.id));
    for (const [id, v] of this.visuals)
      if (!present.has(id)) {
        this.remove(v);
        this.visuals.delete(id);
      }
    for (const enemy of frame.combat.enemies) {
      const v = this.visuals.get(enemy.id) ?? this.create(enemy.id, now);
      const moving =
        Number.isFinite(v.x) && Math.hypot(enemy.position.x - v.x, enemy.position.y - v.y) > 0.02;
      if (enemy.health < v.healthValue && Number.isFinite(v.healthValue)) v.hurtUntil = now + 180;
      const key = monsterAnimationFor(enemy, moving);
      if (key !== v.key) {
        const source = this.sources.get(key);
        if (!source) continue;
        v.body.material.map?.dispose();
        const texture = source.clone();
        texture.repeat.set(MONSTER_FRAME_SIZE / source.image.width, 1);
        v.body.material.map = texture;
        v.body.material.needsUpdate = true;
        v.key = key;
        v.started = now;
      }
      const texture = v.body.material.map!;
      const count = Math.round(texture.image.width / MONSTER_FRAME_SIZE),
        anim = MONSTER_ANIMATIONS[key]!;
      const step = Math.floor(((now - v.started) / 1000) * anim.frameRate);
      texture.offset.x = (anim.repeat === -1 ? step % count : Math.min(step, count - 1)) / count;
      const p = toWorld(enemy.position);
      v.root.position.set(p.x, 0.04, p.z);
      v.billboard.quaternion.copy(camera.quaternion);
      if (moving) {
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const dx = enemy.position.x - v.x,
          dy = enemy.position.y - v.y;
        if (Math.abs(dx * right.x + dy * right.z) > 0.01)
          v.body.scale.x = dx * right.x + dy * right.z < 0 ? -1 : 1;
      }
      const warning = enemy.state === 'windup' || enemy.state === 'mutation-warning';
      const friendly = enemy.kind === 'hug' && !enemy.mutated;
      v.body.scale.y = enemy.mutated ? 1.18 : 1;
      v.body.scale.x = Math.sign(v.body.scale.x) * (enemy.mutated ? 1.18 : 1);
      v.body.material.color.set(
        now < v.hurtUntil
          ? 0xff7777
          : enemy.state === 'mutation-warning'
            ? 0xffba66
            : frame.night.enabled
              ? 0xc5d2e5
              : 0xffffff,
      );
      v.ring.material.color.set(warning ? 0xff765e : friendly ? 0x89dcb3 : 0xc57965);
      v.ring.scale.setScalar(warning ? 1.4 + Math.sin(now / 70) * 0.15 : 1);
      v.health.scale.x = Math.max(
        0,
        enemy.health /
          (enemy.kind === 'hug' ? COMBAT_RULES.hug.health : COMBAT_RULES.enemy.patrol.health),
      );
      const label = this.labels.get(enemy.state);
      v.label.visible = !!label && enemy.state !== 'dead';
      if (label) v.label.material = label;
      v.root.visible = frame.combat.visibleEnemies.includes(enemy.id);
      if (enemy.state === 'dead') v.root.visible = v.root.visible && now - v.started < 1400;
      v.x = enemy.position.x;
      v.y = enemy.position.y;
      v.healthValue = enemy.health;
    }
    const p = toWorld(frame.position);
    this.swing.visible = frame.combat.swing > 0;
    this.swing.position.set(p.x, 0.08, p.z);
    this.swing.rotation.z = -frame.night.aim;
    this.swing.material.color.set(frame.combat.hit ? 0xffa26d : 0xffe5a0);
    this.swing.material.opacity = (0.6 * frame.combat.swing) / COMBAT_RULES.player.attack.swingMs;
  }

  private remove(v: EnemyVisual): void {
    this.scene.remove(v.root);
    v.body.material.map?.dispose();
    v.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
      }
    });
  }
  dispose(): void {
    this.disposed = true;
    for (const v of this.visuals.values()) this.remove(v);
    this.visuals.clear();
    for (const t of this.sources.values()) t.dispose();
    this.sources.clear();
    for (const m of this.labels.values()) {
      m.map?.dispose();
      m.dispose();
    }
    this.labels.clear();
    this.scene.remove(this.swing);
    this.swing.geometry.dispose();
    this.swing.material.dispose();
  }
}
