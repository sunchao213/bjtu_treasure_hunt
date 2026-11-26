import * as THREE from 'three';
import {
  MONSTER_ANIMATIONS,
  MONSTER_FRAME_SIZE,
  MONSTER_SPRITE_SHEETS,
  monsterAnimationFor,
  monsterConcealed,
  monsterOpacityFor,
} from '../config/monster-sprites';
import { COMBAT_RULES } from '../config/combat-config';
import { enemyMaxHealth } from '../modules/world/night-systems';
import { toWorld } from './scene-config';
import type { WorldFrame as TrialFrame } from './world-frame';
import { assetUrl } from '../app/asset-url';

interface EnemyVisual {
  root: THREE.Group;
  billboard: THREE.Group;
  body: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  healthBack: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  health: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  telegraph: THREE.Group;
  telegraphFill: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  telegraphCenter: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite;
  key: string;
  started: number;
  x: number;
  y: number;
  healthValue: number;
  hurtUntil: number;
}

interface SoundWaveVisual {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  texture: THREE.Texture;
  started: number;
}

/** Existing animal sheets become feet-anchored billboards in the real 3D scene. */
export class CampusEnemyView {
  private readonly sources = new Map<string, THREE.Texture>();
  private readonly labels = new Map<string, THREE.SpriteMaterial>();
  private readonly visuals = new Map<string, EnemyVisual>();
  private readonly waveVisuals = new Map<string, SoundWaveVisual>();
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
      ['cat-windup', '猫咪扑击 · 侧移躲避', '#ffb3a0'],
      ['request', '长按 Q 抱抱', '#a5efbe'],
      ['windup', '即将攻击 · 躲开', '#ffb3a0'],
      ['amplifier-windup', '声波蓄力 · 横向躲避', '#ff8e96'],
      ['amplifier-locked', '方向已锁定 · 即将发射', '#ff5464'],
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
    const ampRules = COMBAT_RULES.enemy.amplifier;
    const telegraphLength = ampRules.projectileMaxDistance / 32;
    const telegraphWidth = ampRules.projectileWidth / 32;
    const telegraph = new THREE.Group();
    telegraph.position.y = 0.05;
    telegraph.visible = false;
    const telegraphFill = new THREE.Mesh(
      new THREE.PlaneGeometry(telegraphLength, telegraphWidth).translate(telegraphLength / 2, 0, 0),
      new THREE.MeshBasicMaterial({
        color: 0xff4054,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    telegraphFill.rotation.x = -Math.PI / 2;
    const telegraphCenter = new THREE.Mesh(
      new THREE.PlaneGeometry(telegraphLength, 0.16).translate(telegraphLength / 2, 0, 0),
      new THREE.MeshBasicMaterial({
        color: 0xff8a94,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    telegraphCenter.rotation.x = -Math.PI / 2;
    telegraphCenter.position.y = 0.01;
    telegraph.add(telegraphFill, telegraphCenter);
    const label = new THREE.Sprite(this.labels.get('request')!);
    label.position.set(0, 2.17, 0);
    label.scale.set(1.6, 0.27, 1);
    label.visible = false;
    billboard.add(body, back, health);
    root.add(billboard, ring, telegraph, label);
    this.scene.add(root);
    const visual = {
      root,
      billboard,
      body,
      health,
      healthBack: back,
      ring,
      telegraph,
      telegraphFill,
      telegraphCenter,
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

  private createWave(id: string, now: number): SoundWaveVisual | null {
    const source = this.sources.get('amplifier-wave');
    if (!source) return null;
    const texture = source.clone();
    texture.repeat.set(MONSTER_FRAME_SIZE / source.image.width, 1);
    texture.needsUpdate = true;
    const width = COMBAT_RULES.enemy.amplifier.projectileWidth / 32;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, width),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        opacity: 0.94,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.name = `SoundWave_${id}`;
    mesh.rotation.x = -Math.PI / 2;
    this.scene.add(mesh);
    const visual: SoundWaveVisual = { mesh, texture, started: now };
    this.waveVisuals.set(id, visual);
    return visual;
  }

  private removeWave(visual: SoundWaveVisual): void {
    this.scene.remove(visual.mesh);
    visual.mesh.geometry.dispose();
    visual.mesh.material.dispose();
    visual.texture.dispose();
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
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      if (
        enemy.kind === 'amplifier' &&
        enemy.state === 'windup' &&
        enemy.attackAngle !== undefined
      ) {
        const ax = Math.cos(enemy.attackAngle);
        const ay = Math.sin(enemy.attackAngle);
        if (Math.abs(ax * right.x + ay * right.z) > 0.01) {
          v.body.scale.x = ax * right.x + ay * right.z < 0 ? -1 : 1;
        }
      } else if (moving) {
        const dx = enemy.position.x - v.x,
          dy = enemy.position.y - v.y;
        if (Math.abs(dx * right.x + dy * right.z) > 0.01)
          v.body.scale.x = dx * right.x + dy * right.z < 0 ? -1 : 1;
      }
      const warning = enemy.state === 'windup' || enemy.state === 'mutation-warning';
      const friendly = enemy.kind === 'hug' && !enemy.mutated;
      const isCat = enemy.kind === 'patrol' && enemy.species === 'cat';
      const concealed = monsterConcealed(enemy);
      const scaleFactor = isCat ? 1 : enemy.mutated ? 1.18 : enemy.kind === 'amplifier' ? 1.12 : 1;
      v.body.material.transparent = true;
      v.body.material.opacity = monsterOpacityFor(enemy);
      v.body.material.alphaTest = concealed ? 0.01 : 0.4;
      v.health.visible = v.healthBack.visible = v.ring.visible = !concealed;
      v.billboard.scale.setScalar(isCat ? COMBAT_RULES.enemy.cat.scale : 1);
      v.body.scale.y = scaleFactor;
      v.body.scale.x = Math.sign(v.body.scale.x || 1) * scaleFactor;
      const ampCharging = enemy.kind === 'amplifier' && enemy.state === 'windup';
      const chargeProgress = ampCharging
        ? Math.max(0, Math.min(1, 1 - enemy.timer / COMBAT_RULES.enemy.amplifier.windupMs))
        : 0;
      v.body.material.color.set(
        now < v.hurtUntil
          ? 0xff7777
          : enemy.state === 'mutation-warning'
            ? 0xffba66
            : ampCharging
              ? enemy.windupLocked
                ? 0xffb0b8
                : 0xe6c8d2
              : frame.night.enabled
                ? 0xc5d2e5
                : 0xffffff,
      );
      v.ring.material.color.set(warning ? 0xff4e62 : friendly ? 0x89dcb3 : 0xc57965);
      v.ring.scale.setScalar(warning ? 1.4 + Math.sin(now / 70) * 0.15 : 1);
      v.telegraph.visible = ampCharging && enemy.attackAngle !== undefined;
      if (v.telegraph.visible && enemy.attackAngle !== undefined) {
        v.telegraph.rotation.y = -enemy.attackAngle;
        const locked = Boolean(enemy.windupLocked);
        v.telegraphFill.material.color.setHex(locked ? 0xff2b43 : 0xff5a6a);
        v.telegraphFill.material.opacity = locked
          ? 0.34 + Math.sin(now / 45) * 0.08
          : 0.14 + chargeProgress * 0.14;
        v.telegraphCenter.material.color.setHex(locked ? 0xffd2d6 : 0xff8a94);
        v.telegraphCenter.material.opacity = locked ? 0.95 : 0.55 + chargeProgress * 0.3;
      }
      v.health.scale.x = Math.max(0, Math.min(1, enemy.health / enemyMaxHealth(enemy.kind)));
      const labelKey =
        isCat && enemy.state === 'windup'
          ? 'cat-windup'
          : enemy.kind === 'amplifier' && enemy.state === 'windup'
            ? enemy.windupLocked
              ? 'amplifier-locked'
              : 'amplifier-windup'
            : enemy.state;
      const label = this.labels.get(labelKey);
      v.label.visible = !!label && enemy.state !== 'dead';
      if (label) v.label.material = label;
      v.root.visible = enemy.state !== 'vanished' && frame.combat.visibleEnemies.includes(enemy.id);
      if (enemy.state === 'dead') v.root.visible = v.root.visible && now - v.started < 1400;
      v.x = enemy.position.x;
      v.y = enemy.position.y;
      v.healthValue = enemy.health;
    }
    const activeWaves = frame.combat.soundWaves ?? [];
    const waveIds = new Set(activeWaves.map((wave) => wave.id));
    for (const [id, visual] of this.waveVisuals) {
      if (!waveIds.has(id)) {
        this.removeWave(visual);
        this.waveVisuals.delete(id);
      }
    }
    const waveAnim = MONSTER_ANIMATIONS['amplifier-wave'];
    for (const wave of activeWaves) {
      const visual = this.waveVisuals.get(wave.id) ?? this.createWave(wave.id, now);
      if (!visual) continue;
      const count = Math.max(1, Math.round(visual.texture.image.width / MONSTER_FRAME_SIZE));
      const frameIndex = Math.floor(((now - visual.started) / 1000) * (waveAnim?.frameRate ?? 14));
      visual.texture.offset.x = (frameIndex % count) / count;
      const wp = toWorld(wave.position);
      visual.mesh.position.set(wp.x, 0.42, wp.z);
      visual.mesh.rotation.z = -wave.angle;
      const fade =
        1 -
        Math.max(
          0,
          (wave.travelled - COMBAT_RULES.enemy.amplifier.projectileMaxDistance * 0.82) /
            (COMBAT_RULES.enemy.amplifier.projectileMaxDistance * 0.18),
        );
      visual.mesh.material.opacity = Math.max(0.25, Math.min(0.96, fade));
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
    for (const wave of this.waveVisuals.values()) this.removeWave(wave);
    this.waveVisuals.clear();
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
