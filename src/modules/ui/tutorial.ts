import { RAID_RULES } from '../../config/game-config';
import type { RaidPhase } from '../../shared/types/game';

/**
 * R04 · 新手分步引导（10-21 助教整改项，D 主责）。
 *
 * 问题：第一次进局内只有左下角一句「正在加载校园地图…」，玩家不知道该先动、
 * 该用手电找箱子、长按 E 搜、价值够了才能撤。
 * 方案：进入局内后按「移动 → 手电发现 → 长按搜索 → 价值差额 → 南门撤离」五步
 * 依次给一张不挡操作的小卡片，做完对应动作自动进入下一步；支持跳过与在准备页重看。
 *
 * 边界：本模块只消费外部传入的状态快照并写自己的 DOM，不读存档、不改任何玩法数据，
 * 也不碰 world-scene（C）/ search-interaction（A）的实现。
 */

export type TutorialStepId = 'move' | 'light' | 'search' | 'value' | 'extract';

export interface TutorialStep {
  readonly id: TutorialStepId;
  readonly title: string;
  readonly body: string;
  readonly keys: string;
}

const threshold = RAID_RULES.threshold;
const extractSeconds = RAID_RULES.extractionDurationMs / 1000;

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'move',
    title: '先走出去',
    body: '用 W A S D 或方向键在校园里移动；鼠标指向决定手电照向哪边。手机用左摇杆移动、右摇杆瞄准。',
    keys: 'WASD / 方向键 · 鼠标指向',
  },
  {
    id: 'light',
    title: '用手电把箱子照出来',
    body: '物资箱只在开着且有电的手电直接照到时才显露，环境微光、灯站和照明棒都不算。',
    keys: 'L 开关手电 · R 换电池 · G 放照明棒',
  },
  {
    id: 'search',
    title: '靠近，长按 E 搜索',
    body: `照亮箱子后走近站稳，长按 E ${RAID_RULES.searchDurationMs / 1000} 秒直到读条走完；移动、松手或受伤都会中断。`,
    keys: '长按 E（手机：交互键）',
  },
  {
    id: 'value',
    title: `凑够 ${threshold} 价值`,
    body: `只有本局搜到并还带在身上的物资计入价值，从仓库带入的物品不算。差额看侧栏「本局物资价值」。`,
    keys: `目标 ${threshold} · 背包 ${RAID_RULES.bagCapacity} 格`,
  },
  {
    id: 'extract',
    title: '回南门撤离',
    body: `走到南门撤离区内按 E，停留 ${extractSeconds} 秒；中途受伤、离开区域或价值跌破 ${threshold} 都要重新申请。`,
    keys: 'E / 侧栏「开始撤离」',
  },
];

export interface TutorialTick {
  readonly phase: RaidPhase;
  readonly value: number;
  readonly threshold: number;
  readonly inExtractionZone: boolean;
  readonly bagCount: number;
  readonly interacted: string;
  readonly moved: boolean;
  readonly stepElapsedMs: number;
}

/** 玩家一直没做对应动作时的兜底停留时长，避免引导卡在某一步挡住后续提示。 */
const STEP_TIMEOUT_MS: Readonly<Record<TutorialStepId, number>> = {
  move: 8_000,
  light: 25_000,
  search: 30_000,
  value: 30_000,
  extract: 45_000,
};

/**
 * 每步最短停留：动作达成得再快也让玩家看一眼这张卡，
 * 否则「一件战利品同时满足两步」会连跳两屏，等于没提示。
 */
const MIN_DWELL_MS = 2_500;

/** 推进结果：下一步 id、「done」表示五步都看完、null 表示停在当前步。 */
export type TutorialAdvance = TutorialStepId | 'done' | null;

/**
 * 单步推进的纯函数：每一步只认「玩家真的做了这个动作」，
 * 动作信号一律来自已经存在于页面上的状态，不新增玩法埋点。
 */
export function advanceStep(step: TutorialStepId, tick: TutorialTick): TutorialAdvance {
  // 读条一起来就收卡，不必等最短停留。
  if (step === 'extract' && tick.phase === 'extracting') return 'done';
  if (tick.stepElapsedMs < MIN_DWELL_MS) return null;
  const timedOut = tick.stepElapsedMs >= STEP_TIMEOUT_MS[step];
  switch (step) {
    case 'move':
      // 位置变化（moved）或停留超时。
      return tick.moved || timedOut ? 'light' : null;
    case 'light': {
      // 手电照到搜证点后画面会出现「长按 E 搜索」提示，或有东西进了背包。
      const found = tick.interacted.includes('搜索') || tick.bagCount > 0;
      return found || timedOut ? 'search' : null;
    }
    case 'search':
      // 搜索成功：背包有东西，或画面切到「拾取」。
      return tick.bagCount > 0 || tick.interacted.includes('拾取') || timedOut ? 'value' : null;
    case 'value':
      // 价值达标，或已经跑到撤离点（准备撤离时也会看到差额提示）。
      return tick.value >= tick.threshold || tick.inExtractionZone || timedOut ? 'extract' : null;
    case 'extract':
      return timedOut ? 'done' : null;
  }
}

export interface TutorialSnapshot {
  readonly visible: boolean;
  readonly step: TutorialStep | null;
  /** 1 起的步序，完成或未开始为 0。 */
  readonly index: number;
  readonly total: number;
}

/** 引导进度只记「看完没有」，与游戏存档分开，重置存档不影响引导。 */
export interface TutorialStore {
  load(): boolean;
  save(done: boolean): void;
}

export const TUTORIAL_STORAGE_KEY = 'bjtu-tutorial-v1';

export function tutorialStore(storage: Pick<Storage, 'getItem' | 'setItem'>): TutorialStore {
  return {
    load() {
      try {
        return storage.getItem(TUTORIAL_STORAGE_KEY) === 'done';
      } catch {
        // 隐私模式下 localStorage 可能不可用：当作没看过，不影响玩法。
        return false;
      }
    },
    save(done: boolean) {
      try {
        storage.setItem(TUTORIAL_STORAGE_KEY, done ? 'done' : '');
      } catch {
        /* 存不进去就只在本次会话里生效 */
      }
    },
  };
}

export interface TutorialRunner {
  /** 每次渲染时喂入当前局内状态（本步已用时长由引导自己算），返回最新的展示快照。 */
  sync(tick: Omit<TutorialTick, 'stepElapsedMs'> & { nowMs: number }): TutorialSnapshot;
  snapshot(phase: RaidPhase): TutorialSnapshot;
  skip(): void;
  restart(): void;
  isDone(): boolean;
  currentStep(): TutorialStepId | null;
}

interface TutorialOptions {
  readonly store: TutorialStore;
}

/** 只在本模块内部兜底用：索引越界时宁可少一步，也不抛错打断整局渲染。 */
const FALLBACK_STEP: TutorialStep = { id: 'extract', title: '回南门撤离', body: '', keys: '' };

function stepAt(index: number): TutorialStep {
  return TUTORIAL_STEPS[index] ?? FALLBACK_STEP;
}

export function createTutorial({ store }: TutorialOptions): TutorialRunner {
  let done = store.load();
  let index = 0;
  let stepStartedAt: number | null = null;

  const playing = (phase: RaidPhase): boolean => phase === 'active' || phase === 'extracting';

  const snapshot = (phase: RaidPhase): TutorialSnapshot => ({
    visible: !done && playing(phase),
    step: done ? null : stepAt(index),
    index: done ? 0 : index + 1,
    total: TUTORIAL_STEPS.length,
  });

  return {
    sync(tick) {
      if (done) return snapshot(tick.phase);
      // 只有局内推进；准备页、结算与结果页都保持现状，不消耗步骤。
      if (!playing(tick.phase)) return snapshot(tick.phase);
      if (stepStartedAt === null) stepStartedAt = tick.nowMs;
      const advanced = advanceStep(stepAt(index).id, {
        phase: tick.phase,
        value: tick.value,
        threshold: tick.threshold,
        inExtractionZone: tick.inExtractionZone,
        bagCount: tick.bagCount,
        interacted: tick.interacted,
        moved: tick.moved,
        stepElapsedMs: tick.nowMs - stepStartedAt,
      });
      if (advanced === null) return snapshot(tick.phase);
      if (advanced === 'done') {
        done = true;
        store.save(true);
        return snapshot(tick.phase);
      }
      index = TUTORIAL_STEPS.findIndex((step) => step.id === advanced);
      stepStartedAt = tick.nowMs;
      return snapshot(tick.phase);
    },
    snapshot,
    skip() {
      done = true;
      store.save(true);
    },
    restart() {
      done = false;
      index = 0;
      stepStartedAt = null;
      store.save(false);
    },
    isDone: () => done,
    currentStep: () => (done ? null : stepAt(index).id),
  };
}

/** 局内引导卡：贴在画面左上角，默认不拦鼠标；只有「跳过引导」可点。 */
export function tutorialMarkup(): string {
  return `<aside id="tutorial" class="tutorial-card" hidden aria-label="新手引导">
            <p class="tutorial-meta"><span id="tutorial-index">1 / 5</span><span>新手引导</span></p>
            <h3 id="tutorial-title"></h3>
            <p id="tutorial-body"></p>
            <p id="tutorial-keys" class="tutorial-keys"></p>
            <div class="tutorial-actions"><button id="tutorial-skip" class="text-button" type="button">跳过引导</button></div>
          </aside>`;
}

export function renderTutorial(snapshot: TutorialSnapshot, root: ParentNode = document): void {
  const card = root.querySelector<HTMLElement>('#tutorial');
  if (!card) return;
  card.hidden = !snapshot.visible;
  if (!snapshot.visible || snapshot.step === null) return;
  const index = root.querySelector<HTMLElement>('#tutorial-index');
  if (index) index.textContent = `${snapshot.index} / ${snapshot.total}`;
  const title = root.querySelector<HTMLElement>('#tutorial-title');
  if (title) title.textContent = snapshot.step.title;
  const body = root.querySelector<HTMLElement>('#tutorial-body');
  if (body) body.textContent = snapshot.step.body;
  const keys = root.querySelector<HTMLElement>('#tutorial-keys');
  if (keys) keys.textContent = snapshot.step.keys;
}
