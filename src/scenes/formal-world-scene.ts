import { CampusView } from '../campus-3d/view';
import { DISTRICT_SCENE } from '../campus-3d/scene-config';
import { FormalWorld, type FormalWorldServices } from '../modules/world/formal-world';
import { FormalControls } from '../modules/world/formal-controls';
import type { TouchControls } from '../modules/world/touch-controls';
import {
  clearExploredMap,
  createExploredMap,
  drawCampusOverview,
  revealExploredArea,
} from '../modules/world/campus-overview';
import { activeMap } from '../config/play-map';
import formal from '../config/formal-campus.json';
import district from '../../assets-source/campus-3d/district/layout.json';
import '../formal-world.css';

interface SceneServices extends FormalWorldServices {
  touch: TouchControls;
  onReady?(): void;
  onLoadError?(message: string): void;
}

/** Production lifecycle, input and rendering; gameplay lives in FormalWorld. */
export class FormalWorldScene extends FormalWorld {
  view?: CampusView;
  private controls?: FormalControls;
  private readonly lifetime = new AbortController();
  private observer?: ResizeObserver;
  private animation = 0;
  private contextLost = false;
  private disposed = false;
  private explored = createExploredMap();
  private mapRaid: string | null = null;
  private overviewImage?: HTMLCanvasElement;
  private cameraControls?: HTMLElement;
  private objective?: HTMLElement;

  constructor(private readonly sceneServices: SceneServices) {
    super(sceneServices);
  }
  async start(): Promise<void> {
    const parent = document.getElementById('game-canvas')!;
    try {
      const map = activeMap();
      this.view = new CampusView(parent, true, {
        ...DISTRICT_SCENE,
        map: {
          ...DISTRICT_SCENE.map,
          chests: [],
          spawn: map.spawn,
          extraction: map.extraction,
          obstacles: map.obstacles,
        },
        lamps: map.lamps,
        markers: [
          { ...formal.stone, kind: 'stele' },
          { ...formal.chapterTwoPoints.campusMap, kind: 'board' },
          { ...formal.chapterTwoPoints.siyuanKey, kind: 'door' },
          { ...formal.chapterThreePoints.record, kind: 'record' },
        ],
      });
      await this.view.init();
      if (this.disposed) return;
      this.controls = new FormalControls(
        this.view,
        this.sceneServices.touch,
        () => this.inputEnabled(),
        () => document.getElementById('open-raid-settings')?.click(),
      );
      const canvas = this.view.renderer.domElement;
      canvas.addEventListener(
        'webglcontextlost',
        (event) => {
          event.preventDefault();
          this.contextLost = true;
          this.services.controller.pause();
          this.clearInteractions();
          document.getElementById('open-raid-settings')?.click();
          this.services.notify('画面连接中断，正在恢复三维校园…');
        },
        { signal: this.lifetime.signal },
      );
      canvas.addEventListener(
        'webglcontextrestored',
        () => {
          this.contextLost = false;
          this.view?.restore();
          this.clearInteractions();
          this.services.notify('三维校园已恢复，请在设置中点击继续游戏。');
          document.getElementById('open-raid-settings')?.click();
        },
        { signal: this.lifetime.signal },
      );
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.hidden) {
            this.services.controller.pause();
            this.services.controller.cancelExtraction();
            this.clearInteractions();
            document.getElementById('open-raid-settings')?.click();
          } else if (['active', 'extracting'].includes(this.services.controller.getView().phase))
            document.getElementById('open-raid-settings')?.click();
        },
        { signal: this.lifetime.signal },
      );
      this.cameraControls = document.createElement('div');
      this.cameraControls.className = 'formal-camera-controls';
      this.cameraControls.innerHTML =
        '<button type="button" id="camera-overview">区域总览</button><button type="button" id="camera-reset">重置镜头</button>';
      parent.after(this.cameraControls);
      this.objective = document.createElement('div');
      this.objective.className = 'formal-story-objective';
      this.objective.innerHTML =
        '<span>思源记录册 · 当前线索</span><strong></strong><small></small>';
      document.querySelector('.raid-hud-left')!.append(this.objective);
      document.getElementById('camera-overview')!.onclick = () => {
        this.clearInteractions();
        const overview = this.view!.toggleOverview();
        document.getElementById('camera-overview')!.textContent = overview
          ? '返回人物'
          : '区域总览';
      };
      document.getElementById('camera-reset')!.onclick = () => {
        this.clearInteractions();
        this.view!.resetCamera();
      };
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(parent);
      this.overviewImage = this.makeOverview();
      let previous = performance.now(),
        mapAt = 0;
      const loop = (now: number) => {
        if (this.disposed) return;
        const delta = Math.max(0, Math.min(100, now - previous));
        previous = now;
        if (!this.contextLost) {
          const input = this.controls!.read(this.position, this.aim);
          this.tick(delta, input);
          this.view!.render(this.frame(), now, delta);
          this.sceneServices.touch.finishFrame();
          if (now - mapAt > 100) {
            this.drawMaps();
            mapAt = now;
          }
        }
        this.animation = requestAnimationFrame(loop);
      };
      this.animation = requestAnimationFrame(loop);
      this.sceneServices.onReady?.();
    } catch (error) {
      if (this.disposed) return;
      console.error('Campus initialization failed', error);
      this.view?.dispose();
      this.view = undefined;
      this.sceneServices.onLoadError?.('三维校园加载失败，请重新加载；装备和仓库尚未带入。');
    }
  }
  private inputEnabled(): boolean {
    const app = document.getElementById('app');
    return (
      this.canResume() &&
      !this.services.controller.isPaused() &&
      ['active', 'extracting'].includes(this.services.controller.getView().phase) &&
      !document.querySelector('dialog[open]') &&
      app?.dataset.bagOpen !== 'true' &&
      !document.getElementById('game-page')?.hidden
    );
  }
  canResume(): boolean {
    return !this.contextLost && !document.hidden;
  }
  resize(): void {
    this.view?.resize();
  }
  captureMouse(): void {
    this.controls?.captureMouse();
  }
  releaseMouse(): void {
    this.controls?.releaseMouse();
  }
  override clearInteractions(preserveMouse = false): void {
    super.clearInteractions();
    this.controls?.clear(preserveMouse);
  }
  private makeOverview(): HTMLCanvasElement {
    const image = document.createElement('canvas');
    image.width = 816;
    image.height = 832;
    const ctx = image.getContext('2d')!;
    ctx.scale(0.25, 0.25);
    ctx.fillStyle = '#29462e';
    ctx.fillRect(0, 0, formal.width, formal.height);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const road of [...district.roads, ...district.paths]) {
      ctx.strokeStyle = road.kind === 'road' ? '#4a5669' : '#867c66';
      ctx.lineWidth = road.width;
      ctx.beginPath();
      road.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.stroke();
    }
    ctx.fillStyle = '#1b4051';
    ctx.beginPath();
    district.lake.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#a3aaa0';
    for (const building of district.buildings)
      for (const b of building.blocks) ctx.fillRect(b.x, b.y, b.width, b.height);
    return image;
  }
  private drawMaps(): void {
    if (!this.overviewImage) return;
    const raidId = this.services.controller.getView().raidId;
    if (this.objective) {
      this.objective.hidden =
        !raidId || !['active', 'extracting'].includes(this.services.controller.getView().phase);
      const objective = this.storyObjective();
      this.objective.querySelector('strong')!.textContent = objective.title;
      this.objective.querySelector('small')!.textContent = objective.hint;
    }
    if (raidId !== this.mapRaid) {
      clearExploredMap(this.explored);
      this.mapRaid = raidId;
    }
    revealExploredArea(this.explored, this.position);
    const mask = raidId ? this.explored : new Uint8Array(this.explored.length).fill(1);
    const teammates = [...this.teammates.values()].map((p) => ({
      position: p.position,
      name: p.name,
    }));
    for (const id of ['campus-overview', 'campus-map-expanded']) {
      const canvas = document.getElementById(id) as HTMLCanvasElement | null;
      if (canvas)
        drawCampusOverview(canvas, this.position, this.overviewImage, mask, {
          followPlayer: id === 'campus-overview' && !!raidId,
          teammates,
          storyMarkers: this.storyMarkers(),
        });
    }
  }
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.lifetime.abort();
    this.observer?.disconnect();
    this.controls?.dispose();
    this.view?.dispose();
    this.cameraControls?.remove();
    this.objective?.remove();
    super.dispose();
  }
}
