import { describe, expect, it } from 'vitest';
import {
  advanceStep,
  createTutorial,
  TUTORIAL_STEPS,
  TUTORIAL_STORAGE_KEY,
  tutorialMarkup,
  tutorialStore,
  type TutorialTick,
} from '../../src/modules/ui/tutorial';
import { prepViewMarkup } from '../../src/modules/ui/reference-shell';
import { RAID_RULES } from '../../src/config/game-config';

const idle: TutorialTick = {
  phase: 'active',
  value: 0,
  threshold: RAID_RULES.threshold,
  inExtractionZone: false,
  bagCount: 0,
  interacted: '',
  moved: false,
  stepElapsedMs: 3_000,
};

function fakeStore(initial = false) {
  const saved: boolean[] = [];
  return {
    saved,
    store: {
      load: () => initial,
      save: (done: boolean) => {
        saved.push(done);
      },
    },
  };
}

describe('F04 新手引导 · 五步顺序与文案', () => {
  it('按「移动 → 手电发现 → 长按搜索 → 价值差额 → 南门撤离」排列', () => {
    expect(TUTORIAL_STEPS.map((step) => step.id)).toEqual([
      'move',
      'light',
      'search',
      'value',
      'extract',
    ]);
  });

  it('每一步都给出标题、说明和键位，且不会出现空文案', () => {
    for (const step of TUTORIAL_STEPS) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.body.length).toBeGreaterThan(0);
      expect(step.keys.length).toBeGreaterThan(0);
    }
  });

  it('价值与撤离步的文案取自实际规则常量，规则改了文案跟着变', () => {
    const value = TUTORIAL_STEPS.find((step) => step.id === 'value');
    const extract = TUTORIAL_STEPS.find((step) => step.id === 'extract');
    expect(value?.title).toContain(String(RAID_RULES.threshold));
    expect(extract?.body).toContain(String(RAID_RULES.extractionDurationMs / 1000));
  });
});

describe('F04 新手引导 · 单步推进条件', () => {
  it('没有动作也不超时，停在当前步', () => {
    expect(advanceStep('move', idle)).toBeNull();
    expect(advanceStep('light', idle)).toBeNull();
    expect(advanceStep('search', idle)).toBeNull();
    expect(advanceStep('value', idle)).toBeNull();
    expect(advanceStep('extract', idle)).toBeNull();
  });

  it('第一步：玩家位置动了才进第二步', () => {
    expect(advanceStep('move', { ...idle, moved: true })).toBe('light');
  });

  it('第二步：手电照到搜证点（画面出现搜索提示）或已有战利品才进第三步', () => {
    expect(advanceStep('light', { ...idle, interacted: '长按 E 搜索物资箱' })).toBe('search');
    expect(advanceStep('light', { ...idle, bagCount: 1 })).toBe('search');
  });

  it('第三步：搜到东西才进第四步，「拾取」也算', () => {
    expect(advanceStep('search', { ...idle, bagCount: 1 })).toBe('value');
    expect(advanceStep('search', { ...idle, interacted: '按 E 拾取掉落物' })).toBe('value');
  });

  it('第四步：价值达标或已经站在撤离区才进第五步', () => {
    expect(advanceStep('value', { ...idle, value: RAID_RULES.threshold })).toBe('extract');
    expect(advanceStep('value', { ...idle, inExtractionZone: true })).toBe('extract');
    expect(advanceStep('value', { ...idle, value: RAID_RULES.threshold - 1 })).toBeNull();
  });

  it('第五步：只有真的开始读条才算走完引导', () => {
    expect(advanceStep('extract', { ...idle, phase: 'extracting' })).toBe('done');
    expect(advanceStep('extract', { ...idle, phase: 'success' })).toBeNull();
  });

  it('每步至少停留 2.5 秒，动作再快也让玩家看清这张卡', () => {
    expect(advanceStep('move', { ...idle, moved: true, stepElapsedMs: 1_000 })).toBeNull();
    expect(advanceStep('move', { ...idle, moved: true, stepElapsedMs: 2_600 })).toBe('light');
    // 例外：读条已经开始就直接收卡。
    expect(advanceStep('extract', { ...idle, phase: 'extracting', stepElapsedMs: 200 })).toBe(
      'done',
    );
  });

  it('玩家一直不做动作时按步兜底超时，避免卡在某一步', () => {
    expect(advanceStep('move', { ...idle, stepElapsedMs: 8_000 })).toBe('light');
    expect(advanceStep('light', { ...idle, stepElapsedMs: 25_000 })).toBe('search');
    expect(advanceStep('search', { ...idle, stepElapsedMs: 30_000 })).toBe('value');
    expect(advanceStep('value', { ...idle, stepElapsedMs: 30_000 })).toBe('extract');
    expect(advanceStep('extract', { ...idle, stepElapsedMs: 45_000 })).toBe('done');
  });
});

describe('F04 新手引导 · 状态机', () => {
  const tick = (patch: Partial<TutorialTick> = {}, nowMs = 0) => ({
    ...idle,
    ...patch,
    nowMs,
  });

  it('准备页不显示也不推进，避免还没出发就把五步走完', () => {
    const { store } = fakeStore();
    const tutorial = createTutorial({ store });
    const snapshot = tutorial.sync(tick({ phase: 'preparing' }, 1000));
    expect(snapshot.visible).toBe(false);
    expect(tutorial.currentStep()).toBe('move');
  });

  it('进入局内显示第一步，按动作顺序走完五步后自动收起', () => {
    const { store, saved } = fakeStore();
    const tutorial = createTutorial({ store });

    let snapshot = tutorial.sync(tick({}, 0));
    expect(snapshot.visible).toBe(true);
    expect(snapshot.index).toBe(1);
    expect(snapshot.step?.id).toBe('move');

    snapshot = tutorial.sync(tick({ moved: true }, 3_000));
    expect(snapshot.index).toBe(2);

    snapshot = tutorial.sync(tick({ interacted: '长按 E 搜索物资箱' }, 6_000));
    expect(snapshot.index).toBe(3);

    snapshot = tutorial.sync(tick({ bagCount: 1 }, 9_000));
    expect(snapshot.index).toBe(4);

    snapshot = tutorial.sync(tick({ value: RAID_RULES.threshold, bagCount: 1 }, 12_000));
    expect(snapshot.index).toBe(5);

    snapshot = tutorial.sync(tick({ phase: 'extracting', value: RAID_RULES.threshold }, 13_000));
    expect(snapshot.visible).toBe(false);
    expect(tutorial.isDone()).toBe(true);
    expect(saved).toEqual([true]);
  });

  it('动作达成得太快时也要等最短停留，不会连跳两屏', () => {
    const { store } = fakeStore();
    const tutorial = createTutorial({ store });
    tutorial.sync(tick({}, 0));
    // 1 秒内就有战利品：第一屏先留住
    expect(tutorial.sync(tick({ moved: true }, 1_000)).index).toBe(1);
    expect(tutorial.sync(tick({ moved: true }, 3_000)).index).toBe(2);
  });

  it('走完后再进下一局不再打扰', () => {
    const { store } = fakeStore(true);
    const tutorial = createTutorial({ store });
    expect(tutorial.sync(tick()).visible).toBe(false);
  });

  it('跳过写入存档，重开后不再出现', () => {
    const { store, saved } = fakeStore();
    const tutorial = createTutorial({ store });
    expect(tutorial.sync(tick()).visible).toBe(true);
    tutorial.skip();
    expect(saved).toEqual([true]);
    expect(tutorial.sync(tick({ phase: 'preparing' })).visible).toBe(false);
    expect(tutorial.sync(tick()).visible).toBe(false);
  });

  it('重看把进度清回第一步并允许再次出现', () => {
    const { store, saved } = fakeStore(true);
    const tutorial = createTutorial({ store });
    tutorial.restart();
    expect(saved).toEqual([false]);
    const snapshot = tutorial.sync(tick());
    expect(snapshot.visible).toBe(true);
    expect(snapshot.index).toBe(1);
  });

  it('结算与失败页不显示引导卡', () => {
    const { store } = fakeStore();
    const tutorial = createTutorial({ store });
    for (const phase of ['settling', 'success', 'failed'] as const) {
      expect(tutorial.sync(tick({ phase })).visible).toBe(false);
    }
  });
});

describe('F04 新手引导 · 存储降级', () => {
  it('localStorage 不可用时当作没看过，不抛出异常', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    const store = tutorialStore(broken as unknown as Storage);
    expect(store.load()).toBe(false);
    expect(() => store.save(true)).not.toThrow();
  });

  it('只记住「看完没有」，与游戏存档分开', () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    };
    const store = tutorialStore(storage as unknown as Storage);
    store.save(true);
    expect(memory.get(TUTORIAL_STORAGE_KEY)).toBe('done');
    expect(store.load()).toBe(true);
  });
});

describe('F04 新手引导 · 页面入口', () => {
  it('局内引导卡包含步序、标题、正文、键位与跳过按钮', () => {
    const markup = tutorialMarkup();
    for (const id of [
      'tutorial',
      'tutorial-index',
      'tutorial-title',
      'tutorial-body',
      'tutorial-keys',
      'tutorial-skip',
    ]) {
      expect(markup).toContain(`id="${id}"`);
    }
    expect(markup).toContain('跳过引导');
  });

  it('准备页保留重看入口', () => {
    const markup = prepViewMarkup();
    expect(markup).toContain('id="tutorial-restart"');
    expect(markup).toContain('重看新手引导');
  });
});
