import { CHEST_TIERS, type ChestTier } from '../config/chest-config';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Point, Rect } from '../shared/types/game';
import { animationFrame, PLAYER_ANIMATIONS, type Facing, type PlayerAnimation } from './animation';
import { DEFAULT_SKIN_ID, SKIN_DEFINITIONS } from '../modules/save/persistent-save';
import { CampusEnemyView } from './enemy-view';
import { DISTRICT_SCENE, toMap, toWorld, type CampusSceneConfig } from './scene-config';
import type { WorldFrame as TrialFrame } from './world-frame';
import { PlayerCameraRig, screenFacing, screenToGround } from './camera-rig';
import { ChargingStationView } from './charging-station-view';
import { CampusNightView } from './night-view';
import { CampusTreeView } from './tree-view';
import { BandageHealingView } from './bandage-healing-view';
import {
  BANDAGE_HEALING_EFFECT,
  COFFEE_HEALING_EFFECT,
  DETECTOR_EFFECT,
  QUICK_NOTE_EFFECT,
  UTILITY_ITEM_EFFECTS,
} from '../config/item-effects';
import { RulerEffectView } from './ruler-effect-view';
import { RULER_EFFECT } from '../config/weapon-effects';
import { QuickNoteEffectView } from './quick-note-effect-view';
import { DetectorEffectView } from './detector-effect-view';
import { UtilityItemEffectsView } from './utility-item-effects-view';
import type { StoryTrigger } from '../modules/world/story-triggers';
import type { RoomCameraSnapshot } from '../modules/network/network-protocol';

declare const __GAME_ASSET_VERSION__: string;

export interface WorldView {
  init(): Promise<void>;
  render(frame: TrialFrame, elapsedMs: number, deltaMs: number): void;
  resize(): void;
  dispose(): void;
}

export class CampusView implements WorldView {
  readonly renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  private readonly scene = new THREE.Scene();
  private readonly chargingStationView = new ChargingStationView(this.scene);
  private readonly camera = new THREE.OrthographicCamera(-16, 16, 11, -11, 0.1, 120);
  private readonly followCamera = new THREE.PerspectiveCamera(48, 1, 0.1, 400);
  private readonly cameraRig = new PlayerCameraRig();
  private readonly spectatorRig = new PlayerCameraRig();
  private spectatorCamera?: RoomCameraSnapshot | null;
  private localOverview = false;
  private readonly target = new THREE.Vector3(16, 0, 12);
  private readonly raycaster = new THREE.Raycaster();
  private readonly portalRay = new THREE.Raycaster();
  private readonly occlusionGroups = new Map<
    string,
    { meshes: THREE.Mesh[]; materials: THREE.Material[] }
  >();
  private readonly replacedMaterials = new Set<THREE.Material>();
  private readonly viewDirection = new THREE.Vector3();
  private readonly portalProbe = new THREE.Vector3();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly pointer = new THREE.Vector2();
  private readonly hit = new THREE.Vector3();
  private readonly textures = new Set<THREE.Texture>();
  private readonly chestSources = new Map<ChestTier, THREE.Texture>();
  private stele?: THREE.Group;
  private readonly storyVisuals = new Map<
    string,
    {
      ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
      label: THREE.Sprite;
      status: StoryTrigger['status'];
    }
  >();
  private readonly teammates = new Map<
    string,
    {
      mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      label: THREE.Sprite;
      name: string;
      source: THREE.Texture;
    }
  >();
  private readonly players = new Map<PlayerAnimation, THREE.Texture>();
  private readonly costumes = new Map<string, Map<PlayerAnimation, THREE.Texture>>();
  private readonly loadingCostumes = new Set<string>();
  private loadTexture?: (path: string) => Promise<THREE.Texture>;
  private readonly chests = new Map<
    string,
    {
      mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
      texture: THREE.Texture;
      tier: ChestTier;
      openedAt: number | null;
      ring: THREE.Mesh;
    }
  >();
  private readonly drops = new Map<string, THREE.Mesh>();
  private readonly playerMaterial = new THREE.MeshBasicMaterial({
    alphaTest: 0.45,
    side: THREE.DoubleSide,
  });
  private readonly player = new THREE.Mesh(
    new THREE.PlaneGeometry(1.44, 1.8).translate(0, 0.9, 0),
    this.playerMaterial,
  );
  private readonly shadow: THREE.Mesh;
  private readonly extractionMaterial = new THREE.MeshBasicMaterial({
    color: 0xb8c796,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  private action: PlayerAnimation = 'idle';
  private actionStarted = 0;
  private disposed = false;
  private readonly observer: ResizeObserver;
  private get overview(): boolean {
    return this.spectatorCamera === undefined
      ? this.localOverview
      : (this.spectatorCamera?.overview ?? false);
  }

  private get renderCameraRig(): PlayerCameraRig {
    return this.spectatorCamera === undefined ? this.cameraRig : this.spectatorRig;
  }
  private readonly normalFog: THREE.Fog | null;
  private readonly nightView?: CampusNightView;
  private readonly enemyView?: CampusEnemyView;
  private treeView?: CampusTreeView;
  private bandageHealing?: BandageHealingView;
  private coffeeHealing?: BandageHealingView;
  private detectorEffect?: DetectorEffectView;
  private quickNoteEffect?: QuickNoteEffectView;
  private rulerEffect?: RulerEffectView;
  private utilityEffects?: UtilityItemEffectsView;
  private readonly treePlayerProbe = new THREE.Vector3();
  private readonly treeLandmarkProbes: THREE.Vector3[];

  private get isDistrict() {
    return this.config.area === 'district';
  }
  private get isSiyuan() {
    return this.config.area === 'siyuan';
  }
  private get detailedCampus() {
    return this.config.area !== 'south-gate';
  }

  canOrbit(): boolean {
    return !this.overview && this.spectatorCamera === undefined;
  }
  orbitCamera(dx: number, dy: number): void {
    this.cameraRig.orbit(dx, dy);
  }
  zoomCamera(delta: number): void {
    this.cameraRig.zoom(delta);
  }
  resetCamera(): void {
    this.cameraRig.reset();
  }
  stopCameraLook(): void {
    this.cameraRig.stopLook();
  }
  movementDirection(point: Point): Point {
    return screenToGround(point, this.overview ? 0 : this.cameraRig.viewYaw);
  }
  cameraAim(): Point {
    const direction = screenToGround({ x: 0, y: -1 }, this.cameraRig.viewYaw);
    return {
      x: this.player.position.x * 32 + direction.x * 250,
      y: this.player.position.z * 32 + direction.y * 250,
    };
  }
  cameraInfo(): string {
    if (this.overview) return '镜头：区域总览';
    const rig = this.renderCameraRig;
    return `镜头：人物环绕 · 方位 ${Math.round(THREE.MathUtils.radToDeg(rig.viewYaw))}° · 俯角 ${Math.round(THREE.MathUtils.radToDeg(rig.viewPitch))}° · 缩放 ${rig.distance.toFixed(1)}`;
  }

  cameraSnapshot(flashlight: boolean): RoomCameraSnapshot {
    return {
      yaw: this.cameraRig.viewYaw,
      pitch: this.cameraRig.viewPitch,
      distance: this.cameraRig.distance,
      overview: this.localOverview,
      flashlight,
    };
  }

  toggleOverview(): boolean {
    this.localOverview = !this.localOverview;
    this.scene.fog = this.overview ? null : this.normalFog;
    this.resize();
    return this.overview;
  }

  constructor(
    private readonly parent: HTMLElement,
    night = false,
    private readonly config: CampusSceneConfig = DISTRICT_SCENE,
  ) {
    this.treeLandmarkProbes = (config.markers ?? []).map((marker) => {
      const p = toWorld(marker);
      return new THREE.Vector3(p.x, 1.1, p.z);
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Only static architecture casts shadows; reuse its map during player movement.
    this.renderer.shadowMap.autoUpdate = night;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0xdde6d5);
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      'aria-label',
      `三维${this.config.name}校园，使用 WASD 移动，E 搜索或撤离`,
    );
    parent.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(night ? 0x080f21 : 0xdde6d5);
    this.normalFog = night ? new THREE.Fog(0x080f21, 45, 140) : null;
    this.scene.fog = this.normalFog;
    this.scene.add(
      new THREE.HemisphereLight(
        night ? 0x8ba7df : 0xfff7db,
        night ? 0x17213a : 0x5e775c,
        night ? 0.32 : 2.4,
      ),
    );
    const sun = new THREE.DirectionalLight(night ? 0x8faee8 : 0xffedcc, night ? 0.48 : 3);
    sun.position.set(-8, 28, 10);
    sun.target.position.set(16, 0, 12);
    if (this.isSiyuan) {
      sun.position.set(0, 55, 28);
      sun.target.position.set(33, 0, 24);
      this.target.set(33, 0, 24);
      this.camera.far = 220;
      this.camera.top = 20;
      this.camera.bottom = -20;
    }
    if (this.isDistrict) {
      sun.position.set(-20, 105, 50);
      sun.target.position.set(51, 0, 52);
      this.target.set(51, 0, 52);
      this.camera.far = 400;
    }
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: this.isDistrict ? -90 : this.isSiyuan ? -48 : -27,
      right: this.isDistrict ? 90 : this.isSiyuan ? 48 : 27,
      top: this.isDistrict ? 90 : this.isSiyuan ? 48 : 27,
      bottom: this.isDistrict ? -90 : this.isSiyuan ? -48 : -27,
      near: 1,
      far: this.isDistrict ? 230 : this.isSiyuan ? 130 : 80,
    });
    sun.shadow.normalBias = 0.035;
    sun.shadow.autoUpdate = false;
    sun.shadow.needsUpdate = true;
    this.scene.add(sun, sun.target);
    this.buildCampus();
    if (night) this.nightView = new CampusNightView(this.scene, this.config.map, this.config.lamps);
    if (night) this.enemyView = new CampusEnemyView(this.scene);
    this.player.scale.setScalar(0.8);
    this.scene.add(this.player);
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.36, 24),
      new THREE.MeshBasicMaterial({
        color: 0x263e30,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.shadow);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(parent);
    this.resize();
  }

  async init(): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(
      `${import.meta.env.BASE_URL}${this.config.modelUrl}?v=${__GAME_ASSET_VERSION__}`,
    );
    const model = gltf.scene;
    model.name = `BJTU_${this.config.name}_ReferenceReconstruction`;
    const portalCopies = new Map<string, Map<THREE.Material, THREE.Material>>();
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        if (
          object.name.startsWith('SouthGate_') ||
          object.name.startsWith('Siyuan_') ||
          (object.name.startsWith('District_') &&
            !/^District_(Ground|Water|Landscape|Sports|Trees|Forecourt)_/.test(object.name))
        ) {
          const key = this.isDistrict
            ? object.name.split('_').slice(0, 2).join('_')
            : 'architecture';
          let copies = portalCopies.get(key);
          if (!copies) {
            copies = new Map();
            portalCopies.set(key, copies);
          }
          let group = this.occlusionGroups.get(key);
          if (!group) {
            group = { meshes: [], materials: [] };
            this.occlusionGroups.set(key, group);
          }
          const copyMaterial = (material: THREE.Material) => {
            let copy = copies!.get(material);
            if (!copy) {
              this.replacedMaterials.add(material);
              copy = material.clone();
              copy.transparent = true;
              copy.depthWrite = false;
              copies!.set(material, copy);
              group!.materials.push(copy);
            }
            return copy;
          };
          object.material = Array.isArray(object.material)
            ? object.material.map(copyMaterial)
            : copyMaterial(object.material);
          group.meshes.push(object);
        }
        object.castShadow =
          !object.name.startsWith('Gate_') &&
          !/^District_(Ground|Water|Landscape|Sports|Forecourt)_/.test(object.name);
        object.receiveShadow = true;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture) {
              this.textures.add(value);
            }
          }
        }
      }
    });
    // Register even late arrivals so a navigation during loading cannot leak GPU resources.
    this.scene.add(model);
    model.updateMatrixWorld(true);
    await this.applyGroundTexture(
      'campus-grass/grass-albedo.png',
      ['district_grass', 'district_lawn', 'forecourt_lawn'],
      'Campus_Grass',
      8,
    );
    await this.applyGroundTexture(
      'campus-asphalt/asphalt-albedo.png',
      ['district_asphalt'],
      'Campus_Asphalt',
      6,
    );
    if (this.disposed) {
      this.disposeScene();
      throw new Error('场景已关闭');
    }
    this.renderer.shadowMap.needsUpdate = true;
    const loader = new THREE.TextureLoader();
    const load = async (path: string) => {
      const texture = await loader.loadAsync(
        `${import.meta.env.BASE_URL}assets/${path}?v=${__GAME_ASSET_VERSION__}`,
      );
      if (this.disposed) {
        texture.dispose();
        throw new Error('场景已关闭');
      }
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.generateMipmaps = false;
      this.textures.add(texture);
      return texture;
    };
    const treeTexture = await load('environment/campus-trees/tree.png');
    this.loadTexture = load;
    treeTexture.generateMipmaps = true;
    treeTexture.minFilter = THREE.LinearMipmapLinearFilter;
    treeTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.treeView = new CampusTreeView(
      this.scene,
      treeTexture,
      this.config.trees.map((tree) => ({ ...toWorld(tree), variant: tree.variant })),
    );
    // Retain the fixed 3D crowns only as shadow proxies; never render their colour
    // or depth over the new cards. Other bark meshes include benches and stay intact.
    const treeProxyMaterial = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
    });
    treeProxyMaterial.name = 'Campus_TreeShadowProxy';
    this.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        (object.name.startsWith('District_Trees_') || object.name === 'Campus_LegacyTree')
      ) {
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => this.replacedMaterials.add(material));
        object.material = treeProxyMaterial;
      }
    });
    await Promise.all(
      (['idle', 'walk', 'hurt', 'death', 'attack'] as const).map(async (action) => {
        const texture = await load(`characters/player/player-${action}.png`);
        texture.repeat.set(1 / (PLAYER_ANIMATIONS[action].frames * 4), 1);
        this.players.set(action, texture);
      }),
    );
    this.bandageHealing = new BandageHealingView(
      this.scene,
      await load(BANDAGE_HEALING_EFFECT.asset),
    );
    this.coffeeHealing = new BandageHealingView(
      this.scene,
      await load(COFFEE_HEALING_EFFECT.asset),
      COFFEE_HEALING_EFFECT,
    );
    const [bike, shieldAura, jacket, skates] = await Promise.all([
      load(UTILITY_ITEM_EFFECTS['yellow-bike'].asset),
      load(UTILITY_ITEM_EFFECTS['thick-down-jacket'].auraAsset),
      load(UTILITY_ITEM_EFFECTS['thick-down-jacket'].asset),
      load(UTILITY_ITEM_EFFECTS['roller-skates'].asset),
    ]);
    this.utilityEffects = new UtilityItemEffectsView(this.scene, bike, shieldAura, jacket, skates);
    const [detectorActivation, detectorMarker] = await Promise.all([
      load(DETECTOR_EFFECT.asset),
      load(DETECTOR_EFFECT.markerAsset),
    ]);
    this.detectorEffect = new DetectorEffectView(this.scene, detectorActivation, detectorMarker);
    const [quickNoteUse, quickNoteReady] = await Promise.all([
      load(QUICK_NOTE_EFFECT.asset),
      load(QUICK_NOTE_EFFECT.readyAsset),
    ]);
    this.quickNoteEffect = new QuickNoteEffectView(this.scene, quickNoteUse, quickNoteReady);
    const [rulerSlash, rulerSparks] = await Promise.all([
      load(RULER_EFFECT.slashAsset),
      load(RULER_EFFECT.sparksAsset),
    ]);
    this.rulerEffect = new RulerEffectView(this.scene, rulerSlash, rulerSparks);
    await this.enemyView?.init();
    await Promise.all(
      (Object.keys(CHEST_TIERS) as ChestTier[]).map(async (tier) => {
        this.chestSources.set(tier, await load(`props/${CHEST_TIERS[tier].texture}.png`));
      }),
    );
    this.syncChests(this.config.map.chests);
    this.playerMaterial.map = this.players.get('idle')!;
    this.playerMaterial.needsUpdate = true;
    if (this.config.markers?.some((m) => m.kind === 'stele')) {
      const gltf = await new GLTFLoader().loadAsync(
        `${import.meta.env.BASE_URL}assets/models/minghu-stele/minghu-stele.glb?v=${__GAME_ASSET_VERSION__}`,
      );
      this.stele = gltf.scene;
      this.stele.name = 'Minghu_PhotoReferencedStele';
      this.stele.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = object.receiveShadow = true;
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          for (const value of Object.values(material)) {
            if (!(value instanceof THREE.Texture)) continue;
            value.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
            this.textures.add(value);
          }
        }
      });
      // Register late loads before checking disposal, just like campus geometry.
      this.scene.add(this.stele);
      if (this.disposed) {
        this.disposeScene();
        throw new Error('场景已关闭');
      }
    }
    this.buildStoryMarkers();
  }

  private syncChests(points: readonly (Point & { id: string; tier?: ChestTier })[]): void {
    const ids = new Set(points.map((point) => point.id));
    for (const [id, chest] of this.chests) {
      if (ids.has(id)) continue;
      this.scene.remove(chest.mesh, chest.ring);
      chest.mesh.geometry.dispose();
      chest.mesh.material.dispose();
      chest.ring.geometry.dispose();
      (chest.ring.material as THREE.Material).dispose();
      chest.texture.dispose();
      this.textures.delete(chest.texture);
      this.chests.delete(id);
    }
    for (const chest of points) {
      const tier = chest.tier ?? 'normal';
      const existing = this.chests.get(chest.id);
      if (existing) {
        if (existing.tier !== tier) {
          existing.texture.image = this.chestSources.get(tier)!.image;
          existing.texture.needsUpdate = true;
          (existing.ring.material as THREE.MeshBasicMaterial).color.setHex(CHEST_TIERS[tier].color);
          existing.tier = tier;
        }
        const p = toWorld(chest);
        existing.mesh.position.set(p.x, 0.025, p.z);
        existing.ring.position.set(p.x, 0.025, p.z);
        continue;
      }
      const texture = this.chestSources.get(tier)!.clone();
      texture.repeat.set(1 / 6, 1);
      texture.offset.x = 2 / 6;
      this.textures.add(texture);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.35, 1.35).translate(0, 0.675, 0),
        new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.4, side: THREE.DoubleSide }),
      );
      const p = toWorld(chest);
      mesh.position.set(p.x, 0.025, p.z);
      this.scene.add(mesh);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.53, 0.6, 24),
        new THREE.MeshBasicMaterial({ color: CHEST_TIERS[tier].color, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, 0.025, p.z);
      this.scene.add(ring);
      this.chests.set(chest.id, { mesh, texture, tier, openedAt: null, ring });
    }
  }

  resize(): void {
    const width = this.parent.clientWidth;
    const height = this.parent.clientHeight;
    if (!width || !height || this.disposed) {
      return;
    }
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    if (this.isDistrict) {
      const halfHeight = this.overview ? Math.max(59, 59 / aspect) : 20;
      this.camera.top = halfHeight;
      this.camera.bottom = -halfHeight;
    }
    this.camera.left = -this.camera.top * aspect;
    this.camera.right = this.camera.top * aspect;
    this.camera.updateProjectionMatrix();
    this.followCamera.aspect = aspect;
    this.followCamera.updateProjectionMatrix();
  }

  restore(): void {
    this.resize();
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.traverse((object) => {
      if (object instanceof THREE.DirectionalLight) object.shadow.needsUpdate = true;
    });
  }

  groundPoint(clientX: number, clientY: number): Point | undefined {
    const box = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((clientX - box.left) / box.width) * 2 - 1,
      -((clientY - box.top) / box.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.overview ? this.camera : this.followCamera);
    return this.raycaster.ray.intersectPlane(this.groundPlane, this.hit)
      ? toMap(this.hit.x, this.hit.z)
      : undefined;
  }

  render(frame: TrialFrame, elapsedMs: number, deltaMs: number): void {
    if (this.disposed) {
      return;
    }
    this.syncChests(frame.chests ?? this.config.map.chests);
    const p = toWorld(frame.position);
    const focus = toWorld(frame.cameraTarget ?? frame.position);
    this.nightView?.update(frame.cameraTarget ? { ...frame, position: frame.cameraTarget } : frame);
    this.player.visible = this.shadow.visible = !frame.hidePlayer;
    const previousOverview = this.overview;
    this.spectatorCamera = frame.cameraTarget ? (frame.camera ?? null) : undefined;
    if (this.spectatorCamera) {
      const { yaw, pitch, distance } = this.spectatorCamera;
      this.spectatorRig.setState(yaw, pitch, distance);
    } else if (this.spectatorCamera === null) {
      this.spectatorRig.reset();
    }
    if (previousOverview !== this.overview) {
      this.scene.fog = this.overview ? null : this.normalFog;
      this.resize();
    }
    this.chargingStationView.update(frame, elapsedMs);
    this.playerMaterial.color.set(frame.night.enabled ? 0xa6b7d1 : 0xffffff);
    const destination = this.isDistrict
      ? this.overview
        ? new THREE.Vector3(51, 0, 52)
        : new THREE.Vector3(
            THREE.MathUtils.clamp(focus.x, 17, this.config.map.width / 32 - 17),
            0,
            THREE.MathUtils.clamp(focus.z, 13, this.config.map.height / 32 - 13),
          )
      : new THREE.Vector3(
          THREE.MathUtils.clamp(focus.x, this.isSiyuan ? 20 : 12, this.isSiyuan ? 46 : 20),
          0,
          THREE.MathUtils.clamp(focus.z, this.isSiyuan ? 16 : 10, this.isSiyuan ? 30 : 14),
        );
    this.target.lerp(destination, 1 - Math.exp(-Math.min(deltaMs, 100) / 170));
    const angle = THREE.MathUtils.degToRad(55);
    if (this.overview)
      this.camera.position
        .copy(this.target)
        .add(
          new THREE.Vector3(
            0,
            Math.sin(angle) * (this.isDistrict ? 155 : this.isSiyuan ? 70 : 36),
            Math.cos(angle) * (this.isDistrict ? 155 : this.isSiyuan ? 70 : 36),
          ),
        );
    if (this.overview) {
      this.camera.lookAt(this.target);
      this.camera.updateMatrixWorld();
    } else {
      this.renderCameraRig.update(
        this.followCamera,
        new THREE.Vector3(focus.x, 0, focus.z),
        deltaMs,
      );
    }
    const camera = this.overview ? this.camera : this.followCamera;
    this.syncStoryMarkers(frame.storyMarkers ?? [], frame.position, elapsedMs);
    this.syncTeammates(frame, camera, elapsedMs);
    if (frame.extraction) {
      this.extractionMaterial.color.set(frame.extraction.ready ? 0x77d4a8 : 0x667a77);
      this.extractionMaterial.opacity = frame.extraction.active
        ? 0.3 + frame.extraction.progress * 0.3
        : 0.24;
    }
    this.treePlayerProbe.set(focus.x, 0.8, focus.z);
    const markerCount = this.config.markers?.length ?? 0;
    const chargingStations = frame.chargingStations ?? [];
    this.treeLandmarkProbes.length = markerCount + chargingStations.length;
    chargingStations.forEach((station, index) => {
      const probe = (this.treeLandmarkProbes[markerCount + index] ??= new THREE.Vector3());
      const point = toWorld(station);
      probe.set(point.x, 1.1, point.z);
    });
    this.treeView?.update(camera, this.treePlayerProbe, deltaMs, this.treeLandmarkProbes);
    this.enemyView?.update(frame, camera, elapsedMs);
    this.player.position.set(p.x, 0.03, p.z);
    this.bandageHealing?.update(frame.bandageHealingElapsedMs, frame.position);
    this.coffeeHealing?.update(frame.coffeeHealingElapsedMs, frame.position);
    this.detectorEffect?.update(frame.detectorEffect, frame.position, camera);
    this.quickNoteEffect?.update(frame.quickNoteEffect, frame.position, camera);
    this.rulerEffect?.update(frame.rulerEffect, camera, frame.position);
    this.utilityEffects?.update(
      frame.utilityEffects ?? [],
      frame.position,
      screenFacing(frame.facing, this.overview ? 0 : this.renderCameraRig.viewYaw) === 'left',
    );
    this.player.scale.set(
      (0.8 * PLAYER_ANIMATIONS[frame.action].width) / 128,
      (0.8 * PLAYER_ANIMATIONS[frame.action].height) / 160,
      0.8,
    );
    this.playerMaterial.opacity =
      frame.combat.invulnerable && Math.floor(elapsedMs / 90) % 2 ? 0.55 : 1;
    this.playerMaterial.transparent = frame.combat.invulnerable;
    this.player.quaternion.copy(camera.quaternion);
    this.player.updateMatrixWorld(true);
    camera.getWorldDirection(this.viewDirection);
    // A high portal can hide the sprite at a fixed camera angle. Fade only the
    // obstructing architecture; its depth and collision remain physically meaningful.
    for (const group of this.occlusionGroups.values()) {
      const blocked = [0.6, 1.25, 1.7].some((height) => {
        this.portalProbe.set(0, height, 0);
        this.player.localToWorld(this.portalProbe);
        this.portalProbe.addScaledVector(this.viewDirection, this.detailedCampus ? -160 : -40);
        this.portalRay.set(this.portalProbe, this.viewDirection);
        this.portalRay.far = this.detailedCampus ? 159.9 : 39.9;
        return this.portalRay.intersectObjects(group.meshes, false).length > 0;
      });
      for (const material of group.materials) {
        material.opacity = THREE.MathUtils.lerp(
          material.opacity,
          blocked ? 0.24 : 1,
          1 - Math.exp(-Math.min(deltaMs, 100) / 100),
        );
        // Fully opaque architecture must write depth. Leaving all glass/roof/wall
        // batches in the transparent queue lets roof slabs paint over their spires.
        const transparent = material.opacity < 0.995;
        if (material.transparent !== transparent) {
          material.transparent = transparent;
          material.depthWrite = !transparent;
          material.needsUpdate = true;
        }
      }
    }
    this.shadow.position.set(p.x, 0.018, p.z);
    this.shadow.scale.set(1, 0.65, 1);
    if (this.action !== frame.action) {
      this.action = frame.action;
      this.actionStarted = elapsedMs;
    }
    const costume = this.costumeTexture(frame.skinId, frame.action);
    const playerTexture = costume ?? this.players.get(frame.action);
    if (playerTexture) {
      if (this.playerMaterial.map !== playerTexture) {
        this.playerMaterial.map = playerTexture;
        this.playerMaterial.needsUpdate = true;
      }
      this.setPlayerFrame(
        playerTexture,
        frame.action,
        frame.facing,
        elapsedMs - this.actionStarted,
        costume ? frame.aim : undefined,
      );
    }
    for (const [id, chest] of this.chests) {
      chest.mesh.visible = chest.ring.visible = frame.visibleChests.includes(id);
      chest.mesh.quaternion.copy(camera.quaternion);
      const opened = frame.opened.includes(id);
      if (opened && chest.openedAt === null) {
        chest.openedAt = elapsedMs;
      }
      if (!opened) {
        chest.openedAt = null;
      }
      chest.texture.offset.x =
        (opened ? Math.min(5, 2 + Math.floor((elapsedMs - chest.openedAt!) / 120)) : 2) / 6;
      chest.mesh.material.color.set(opened ? 0x829181 : frame.target === id ? 0xfff0b2 : 0xffffff);
      chest.ring.scale.setScalar(frame.target === id ? 1 + frame.searchProgress * 0.3 : 1);
    }
    const activeDrops = new Set(frame.ground.map((drop) => drop.item.instanceId));
    for (const [id, mesh] of this.drops) {
      if (!activeDrops.has(id)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.drops.delete(id);
      }
    }
    for (const drop of frame.ground) {
      let mesh = this.drops.get(drop.item.instanceId);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.22),
          new THREE.MeshStandardMaterial({ color: 0xffd06a, emissive: 0x60451b }),
        );
        this.scene.add(mesh);
        this.drops.set(drop.item.instanceId, mesh);
      }
      const position = toWorld(drop.position);
      mesh.position.set(position.x, 0.35, position.z);
      mesh.rotation.y = elapsedMs / 600;
    }
    this.renderer.render(this.scene, camera);
  }

  private textTexture(text: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#152429ee';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#f2e6b9';
    ctx.font = '36px Microsoft YaHei, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.slice(0, 18), 256, 48);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.add(texture);
    return texture;
  }

  private costumeTexture(
    skinId: string | undefined,
    action: PlayerAnimation,
  ): THREE.Texture | undefined {
    if (
      !skinId ||
      skinId === DEFAULT_SKIN_ID ||
      !SKIN_DEFINITIONS.some((skin) => skin.id === skinId)
    )
      return undefined;
    const key = `${skinId}:${action}`;
    const load = this.loadTexture;
    if (load && !this.loadingCostumes.has(key)) {
      this.loadingCostumes.add(key);
      void load(`characters/skins/${skinId}-${action}.png`)
        .then((texture) => {
          texture.repeat.set(1 / PLAYER_ANIMATIONS[action].frames, 1 / 8);
          const textures = this.costumes.get(skinId) ?? new Map<PlayerAnimation, THREE.Texture>();
          textures.set(action, texture);
          this.costumes.set(skinId, textures);
        })
        .catch(() => undefined);
    }
    return this.costumes.get(skinId)?.get(action);
  }

  private setPlayerFrame(
    texture: THREE.Texture,
    action: PlayerAnimation,
    direction: Facing,
    elapsedMs: number,
    costumeAim?: number,
  ): void {
    const facing = screenFacing(direction, this.overview ? 0 : this.renderCameraRig.viewYaw);
    const frames = PLAYER_ANIMATIONS[action].frames;
    const index = animationFrame(action, facing, elapsedMs);
    if (costumeAim !== undefined) {
      const yaw = this.overview ? 0 : this.renderCameraRig.viewYaw;
      const row = THREE.MathUtils.euclideanModulo(
        Math.round((Math.PI / 2 - costumeAim + yaw) / (Math.PI / 4)),
        8,
      );
      texture.offset.set((index % frames) / frames, (7 - row) / 8);
    } else texture.offset.x = index / (frames * 4);
  }

  private syncTeammates(frame: TrialFrame, camera: THREE.Camera, elapsedMs: number): void {
    const ids = new Set((frame.teammates ?? []).map((p) => p.id));
    for (const [id, visual] of this.teammates) {
      if (ids.has(id)) continue;
      this.scene.remove(visual.mesh, visual.label);
      visual.mesh.geometry.dispose();
      visual.mesh.material.map?.dispose();
      visual.mesh.material.dispose();
      if (visual.label.material.map) this.textures.delete(visual.label.material.map);
      visual.label.material.map?.dispose();
      visual.label.material.dispose();
      this.teammates.delete(id);
    }
    for (const player of frame.teammates ?? []) {
      const action = player.moving ? 'walk' : 'idle';
      const costume = this.costumeTexture(player.skinId, action);
      const source = costume ?? this.players.get(action)!;
      let visual = this.teammates.get(player.id);
      if (!visual) {
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1.44, 1.8).translate(0, 0.9, 0),
          new THREE.MeshBasicMaterial({ map: source.clone(), alphaTest: 0.45 }),
        );
        mesh.scale.setScalar(0.8);
        const label = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: this.textTexture(player.name), depthTest: true }),
        );
        label.scale.set(2.3, 0.43, 1);
        visual = { mesh, label, name: player.name, source };
        this.teammates.set(player.id, visual);
        this.scene.add(mesh, label);
      }
      if (visual.source !== source) {
        visual.mesh.material.map?.dispose();
        visual.mesh.material.map = source.clone();
        visual.source = source;
      }
      if (visual.name !== player.name) {
        if (visual.label.material.map) this.textures.delete(visual.label.material.map);
        visual.label.material.map?.dispose();
        visual.label.material.map = this.textTexture(player.name);
        visual.name = player.name;
      }
      const p = toWorld(player.position);
      visual.mesh.position.set(p.x, 0.03, p.z);
      visual.mesh.quaternion.copy(camera.quaternion);
      visual.mesh.material.color.set(frame.night.enabled ? 0xa6b7d1 : 0xffffff);
      visual.label.position.set(p.x, 2.1, p.z);
      const direction =
        Math.abs(Math.cos(player.aim)) > Math.abs(Math.sin(player.aim))
          ? Math.cos(player.aim) < 0
            ? 'left'
            : 'right'
          : Math.sin(player.aim) < 0
            ? 'up'
            : 'down';
      this.setPlayerFrame(
        visual.mesh.material.map!,
        action,
        direction,
        elapsedMs,
        costume ? player.aim : undefined,
      );
    }
  }

  private syncStoryMarkers(
    markers: readonly StoryTrigger[],
    player: Point,
    elapsedMs: number,
  ): void {
    const ids = new Set(markers.map((m) => m.id));
    for (const [id, visual] of this.storyVisuals) {
      if (!ids.has(id)) {
        visual.ring.visible = visual.label.visible = false;
      }
    }
    for (const marker of markers) {
      let visual = this.storyVisuals.get(marker.id);
      if (!visual) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.55, 0.64, 40),
          new THREE.MeshBasicMaterial({
            color: 0xeac575,
            transparent: true,
            opacity: 0.7,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        const label = new THREE.Sprite(
          new THREE.SpriteMaterial({ depthTest: true, depthWrite: false }),
        );
        label.scale.set(1.7, 0.32, 1);
        visual = { ring, label, status: 'inactive' };
        this.storyVisuals.set(marker.id, visual);
        this.scene.add(ring, label);
      }
      const p = toWorld(marker);
      const nearby = Math.hypot(marker.x - player.x, marker.y - player.y) < 300;
      visual.ring.visible = marker.status !== 'inactive';
      visual.label.visible =
        marker.status !== 'inactive' &&
        (marker.kind !== 'exit' || marker.status === 'active') &&
        (nearby || this.overview);
      visual.label.scale.set(this.overview ? 8 : 1.7, this.overview ? 1.5 : 0.32, 1);
      visual.ring.position.set(p.x, 0.09, p.z);
      visual.label.position.set(p.x, marker.kind === 'stele' ? 3.65 : 2.1, p.z);
      if (!visual.label.material.map || marker.status !== visual.status) {
        const old = visual.label.material.map;
        if (old) {
          this.textures.delete(old);
          old.dispose();
        }
        const prefix = marker.status === 'active' ? '◆ ' : marker.status === 'done' ? '✓ ' : '◇ ';
        visual.label.material.map = this.textTexture(prefix + marker.title);
        visual.label.material.needsUpdate = true;
        visual.status = marker.status;
      }
      const color =
        marker.status === 'done' ? 0x83bc9f : marker.status === 'locked' ? 0x899baf : 0xf5ce77;
      visual.ring.material.color.setHex(color);
      visual.label.material.color.setHex(marker.status === 'locked' ? 0xa8b6c9 : 0xffffff);
      visual.ring.material.opacity =
        marker.status === 'active' ? 0.55 + Math.sin(elapsedMs / 450) * 0.2 : 0.3;
    }
  }

  private buildStoryMarkers(): void {
    for (const marker of this.config.markers ?? []) {
      const p = toWorld(marker);
      const stele = marker.kind === 'stele';
      if (stele && this.stele) {
        // The solid keeps its inscription facing south (+Z), including in overview.
        this.stele.position.set(p.x, 0.04, p.z);
        continue;
      }
      if (marker.kind === 'door') {
        this.box(p.x, 0.95, p.z, 1.35, 1.9, 0.18, 0x364455);
        this.box(p.x, 1.15, p.z + 0.11, 0.6, 0.3, 0.04, 0x9a8760);
      } else if (marker.kind === 'record') {
        this.box(p.x, 0.45, p.z, 1.4, 0.9, 0.8, 0x59666b);
        this.box(p.x, 0.94, p.z, 1.5, 0.08, 0.9, 0xb0bba8);
      } else {
        this.box(
          p.x,
          stele ? 0.8 : 1.15,
          p.z,
          stele ? 0.9 : 1.5,
          stele ? 1.6 : 0.8,
          0.22,
          stele ? 0x59636d : 0x61513f,
        );
        if (!stele) {
          for (const side of [-1, 1])
            this.box(p.x + side * 0.56, 0.55, p.z, 0.07, 1.1, 0.07, 0x5c5444);
        }
      }
      const texture = this.textTexture(
        stele
          ? '明湖'
          : marker.kind === 'door'
            ? '记录节点 02'
            : marker.kind === 'record'
              ? '思源 · 记录台'
              : '校园公告栏',
      );
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(stele ? 0.75 : 1.3, 0.3),
        new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
      );
      plate.position.set(p.x, stele ? 1.1 : 1.2, p.z + 0.12);
      this.scene.add(plate);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.observer.disconnect();
    this.enemyView?.dispose();
    this.disposeScene();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private disposeScene(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Sprite) {
        materials.add(object.material);
      }
      if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach((material) => materials.add(material));
      }
      if (object instanceof THREE.InstancedMesh) object.dispose();
      if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight) {
        object.shadow.dispose();
      }
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) this.textures.add(value);
      }
      material.dispose();
    });
    this.replacedMaterials.forEach((material) => {
      if (!materials.has(material)) {
        material.dispose();
      }
    });
    this.textures.forEach((texture) => texture.dispose());
  }

  private box(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: number,
  ) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      new THREE.MeshStandardMaterial({ color, roughness: 0.9 }),
    );
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private groundRect(rect: Rect, color: number, elevation = 0.01) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(rect.width / 32, rect.height / 32),
      new THREE.MeshStandardMaterial({ color, roughness: 1 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((rect.x + rect.width / 2) / 32, elevation, (rect.y + rect.height / 2) / 32);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  private async applyGroundTexture(
    path: string,
    materialNames: readonly string[],
    meshName: string,
    tileSize: number,
  ): Promise<void> {
    const texture = await new THREE.TextureLoader().loadAsync(
      `${import.meta.env.BASE_URL}assets/environment/${path}?v=${__GAME_ASSET_VERSION__}`,
    );
    if (this.disposed) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    // Mipmaps and anisotropy keep ground details stable at grazing angles.
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.textures.add(texture);
    const names = new Set(materialNames);
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        if (!names.has(material.name) && object.name !== meshName) continue;
        material.map = texture;
        material.color.set(0xffffff);
        material.roughness = 1;
        material.metalness = 0;
        // World projection gives separate ground pieces the same texel scale and phase,
        // including GLB ground meshes with no UVs and differently transformed origins.
        material.onBeforeCompile = (shader) => {
          shader.vertexShader = shader.vertexShader.replace(
            '#include <uv_vertex>',
            `#include <uv_vertex>\n#ifdef USE_MAP\n vMapUv = (modelMatrix * vec4(position, 1.0)).xz / ${tileSize.toFixed(1)};\n#endif`,
          );
        };
        material.customProgramCacheKey = () => `campus-ground-world-${tileSize}-v1`;
        material.needsUpdate = true;
      }
    });
  }

  private buildCampus(): void {
    if (!this.isDistrict) {
      const terrain = this.groundRect(
        { x: -1600, y: -1600, width: 4224, height: 3968 },
        0x8caa75,
        -0.025,
      );
      terrain.name = 'Campus_Grass';
      // The map card and runtime use the same road centerlines, not hand-copied paths.
      for (const road of this.config.roads) {
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1]!;
          const b = road.points[i]!;
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          for (const [extra, color, elevation] of [
            [20, this.isSiyuan ? 0xbca48b : 0xbcc19c, 0.003],
            [0, this.isSiyuan ? 0x747c79 : 0xdfd4ad, 0.009],
          ]) {
            const mesh = this.groundRect(
              {
                x: -length / 2,
                y: -(road.width + extra!) / 2,
                width: length,
                height: road.width + extra!,
              },
              color!,
              elevation!,
            );
            mesh.position.x = (a.x + b.x) / 64;
            mesh.position.z = (a.y + b.y) / 64;
            mesh.rotation.z = -Math.atan2(b.y - a.y, b.x - a.x);
            if (extra === 0) mesh.name = 'Campus_Asphalt';
          }
          if (this.isSiyuan && road.name !== '楼前入口') {
            for (let distance = 24; distance < length - 20; distance += 70) {
              const t = distance / length;
              const dash = this.groundRect({ x: 0, y: 0, width: 22, height: 3 }, 0xdde0cc, 0.012);
              dash.position.x = (a.x + (b.x - a.x) * t) / 32;
              dash.position.z = (a.y + (b.y - a.y) * t) / 32;
              dash.rotation.z = -Math.atan2(b.y - a.y, b.x - a.x);
            }
          }
        }
      }
      if (this.isSiyuan) {
        for (const road of this.config.roads.filter((road) => road.name !== '楼前入口')) {
          const a = road.points[0]!;
          const b = road.points[1]!;
          const label = document.createElement('canvas');
          label.width = 512;
          label.height = 96;
          const pen = label.getContext('2d')!;
          pen.font = '48px Microsoft YaHei, sans-serif';
          pen.textAlign = 'center';
          pen.textBaseline = 'middle';
          pen.fillStyle = '#f0f0dd';
          pen.fillText(road.name, 256, 48);
          const map = new THREE.CanvasTexture(label);
          map.colorSpace = THREE.SRGBColorSpace;
          this.textures.add(map);
          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(5.4, 1.01),
            new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false }),
          );
          mesh.rotation.set(-Math.PI / 2, 0, -Math.atan2(b.y - a.y, b.x - a.x));
          mesh.position.set(
            (a.x + (b.x - a.x) * 0.2) / 32,
            0.017,
            (a.y + (b.y - a.y) * 0.2 + 25) / 32,
          );
          this.scene.add(mesh);
        }
      }
      if (!this.isSiyuan) this.groundRect({ x: 104, y: 80, width: 304, height: 200 }, 0xbdbba5);
      for (const tree of this.config.trees) {
        const p = toWorld(tree);
        const trunk = new THREE.Mesh(
          new THREE.CylinderGeometry(0.2, 0.3, 1.9, 6),
          new THREE.MeshStandardMaterial({ color: 0x79634b }),
        );
        trunk.position.set(p.x, 0.95, p.z);
        trunk.name = 'Campus_LegacyTree';
        trunk.castShadow = true;
        this.scene.add(trunk);
        const crown = new THREE.Mesh(
          tree.variant
            ? new THREE.ConeGeometry(1.25, 3, 7)
            : new THREE.IcosahedronGeometry(1.45, 1),
          new THREE.MeshStandardMaterial({
            color: tree.variant ? 0x4d795a : 0x668849,
            flatShading: true,
          }),
        );
        crown.position.set(p.x, tree.variant ? 2.8 : 2.65, p.z);
        crown.name = 'Campus_LegacyTree';
        crown.castShadow = true;
        crown.receiveShadow = true;
        this.scene.add(crown);
      }
    }
    const zone = this.config.map.extraction;
    const extraction = new THREE.Mesh(
      new THREE.PlaneGeometry(zone.width / 32, zone.height / 32),
      this.extractionMaterial,
    );
    extraction.rotation.x = -Math.PI / 2;
    extraction.position.set((zone.x + zone.width / 2) / 32, 0.025, (zone.y + zone.height / 2) / 32);
    this.scene.add(extraction);
    const outline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(zone.x / 32, 0.035, zone.y / 32),
        new THREE.Vector3((zone.x + zone.width) / 32, 0.035, zone.y / 32),
        new THREE.Vector3((zone.x + zone.width) / 32, 0.035, (zone.y + zone.height) / 32),
        new THREE.Vector3(zone.x / 32, 0.035, (zone.y + zone.height) / 32),
      ]),
      new THREE.LineBasicMaterial({ color: 0xeff4cb }),
    );
    this.scene.add(outline);
    // Benches are decoration outside the playable paths; no invisible blockers.
    for (const benchX of this.isDistrict ? [] : this.isSiyuan ? [17, 42] : [10.5, 21.5]) {
      this.box(benchX, 0.45, 15.6, 1.4, 0.16, 0.45, 0x8c7252);
      this.box(benchX, 0.75, 15.8, 1.4, 0.45, 0.1, 0x8c7252);
    }
  }
}
