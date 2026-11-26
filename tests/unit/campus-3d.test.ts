import { describe, expect, it, vi, afterEach } from 'vitest';
import { animationFrame, PLAYER_ANIMATIONS } from '../../src/campus-3d/animation';
import {
  BUILDING,
  TREES,
  TRIAL_MAP,
  TRIAL_NAMESPACE,
  toMap,
  toWorld,
  TRIAL_LOCK,
} from '../../src/campus-3d/map';
import { EMPTY_INPUT, TrialSession, unobstructed } from '../../src/campus-3d/session';
import { trialStorage } from '../../src/campus-3d/storage';
import { FORMAL_SAVE_KEY, PersistentSave } from '../../src/modules/save/persistent-save';
import { SAVE_KEY } from '../../src/modules/save/reference-save';
import { acquireSaveLock } from '../../src/modules/save/single-writer';
import { movePlayer, contains } from '../../src/modules/world/movement';
import type { Point } from '../../src/shared/types/game';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  let now = 0;
  let raid = 0;
  let fail = false;
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fail) {
        throw new Error('quota');
      }
      data.set(key, value);
    },
  };
  const session = new TrialSession(
    storage,
    () => now,
    () => `trial-${++raid}`,
  );
  const advance = (ms: number, move: Point = { x: 0, y: 0 }, interact = false) => {
    const steps = Math.max(1, Math.ceil(ms / 20));
    for (let i = 0; i < steps; i++) {
      now += ms / steps;
      session.update(ms / steps, { move, interact });
    }
  };
  const walk = (point: Point) => {
    for (let i = 0; i < 1000; i++) {
      const position = session.frame().position;
      const dx = point.x - position.x;
      const dy = point.y - position.y;
      if (Math.hypot(dx, dy) < 3) {
        advance(20);
        return;
      }
      advance(20, { x: dx, y: dy });
    }
    throw new Error(
      `Unreachable target ${JSON.stringify(point)}, from ${JSON.stringify(session.frame().position)}`,
    );
  };
  const search = () => {
    advance(2020, { x: 0, y: 0 }, true);
    advance(20);
  };
  // Ordered path stays on open lanes and approaches each of the eight configured chests.
  const visit = (index: number) => {
    const point = TRIAL_MAP.chests[index]!;
    if (index === 2) {
      walk({ x: 512, y: 600 });
    }
    if (index === 3) {
      walk({ x: 512, y: 600 });
      walk({ x: 640, y: 400 });
    }
    if (index === 6) {
      walk({ x: 512, y: 320 });
    }
    walk(point);
    search();
  };
  return {
    session,
    storage,
    data,
    advance,
    walk,
    visit,
    search,
    fail: (value: boolean) => {
      fail = value;
    },
    setTime: (time: number) => {
      now = time;
    },
  };
}

describe('independent campus 3D session', () => {
  it('maps coordinates and addresses the actual horizontal direction groups', () => {
    const point = { x: 716, y: 362 };
    const world = toWorld(point);
    expect(toMap(world.x, world.z)).toEqual(point);
    expect(animationFrame('walk', 'left', 0)).toBe(10);
    expect(animationFrame('idle', 'right', 1250)).toBe(15);
    expect(animationFrame('death', 'up', 99999)).toBe(4);
    for (const action of Object.keys(PLAYER_ANIMATIONS) as (keyof typeof PLAYER_ANIMATIONS)[]) {
      expect(animationFrame(action, 'down', 600)).toBeGreaterThanOrEqual(5);
      expect(animationFrame(action, 'down', 600)).toBeLessThan(10);
    }
  });

  it('blocks building and tree footprints without blocking the gate opening', () => {
    expect(unobstructed({ x: 100, y: 160 }, { x: 410, y: 160 })).toBe(false);
    expect(unobstructed({ x: 512, y: 600 }, { x: 512, y: 730 })).toBe(true);
    const start = { x: BUILDING.x - 15, y: 180 };
    const position = movePlayer(
      start,
      { x: 1, y: 0 },
      5000,
      145,
      8,
      TRIAL_MAP.bounds,
      TRIAL_MAP.obstacles,
    );
    expect(position.x).toBeLessThanOrEqual(BUILDING.x - 8);
    for (const tree of TREES) {
      expect(TRIAL_MAP.obstacles.some((rect) => contains(rect, tree))).toBe(true);
    }
    const cardinal = movePlayer(TRIAL_MAP.spawn, { x: 1, y: 0 }, 100, 145, 8, TRIAL_MAP.bounds, []);
    const diagonal = movePlayer(TRIAL_MAP.spawn, { x: 1, y: 1 }, 100, 145, 8, TRIAL_MAP.bounds, []);
    expect(Math.hypot(diagonal.x - 512, diagonal.y - 600)).toBeCloseTo(cardinal.x - 512);
  });

  it('completes four searches, extraction, idempotent persistence and three consecutive raids', async () => {
    const t = setup();
    t.data.set(FORMAL_SAVE_KEY, 'formal-data-must-stay-identical');
    for (let raid = 0; raid < 3; raid++) {
      expect((await t.session.start()).ok).toBe(true);
      for (let i = 0; i < 4; i++) {
        t.visit(i);
      }
      expect(t.session.controller.getView().value).toBe(100);
      t.walk({ x: 640, y: 600 });
      t.walk({ x: 512, y: 600 });
      t.walk({ x: 512, y: 670 });
      t.advance(20, { x: 0, y: 0 }, true);
      expect(t.session.controller.getView().phase).toBe('extracting');
      t.advance(5000);
      await Promise.resolve();
      expect(t.session.controller.getView().phase).toBe('success');
      const saved = t.session.save.exportRaw();
      await t.session.save.finalizeRaid(t.session.controller.getView().result!);
      expect(t.session.save.exportRaw()).toBe(saved);
      expect(t.session.prepareNext()).toBe(true);
      expect(t.session.frame().opened).toHaveLength(0);
      expect(t.session.frame().ground).toHaveLength(0);
    }
    expect(t.session.save.view().settledRaidIds).toHaveLength(3);
    expect(t.session.save.view().unlockedChapterIds).toEqual([]);
    expect(t.data.get(FORMAL_SAVE_KEY)).toBe('formal-data-must-stay-identical');
    t.session.dispose();
  });

  it('cancels searches on release, movement, damage and pause; does not open twice', async () => {
    const t = setup();
    await t.session.start();
    t.walk(TRIAL_MAP.chests[0]!);
    t.advance(1000, { x: 0, y: 0 }, true);
    expect(t.session.frame().searchProgress).toBeGreaterThan(0);
    t.advance(20);
    expect(t.session.frame().searchProgress).toBe(0);
    t.advance(1000, { x: 0, y: 0 }, true);
    t.advance(20, { x: 1, y: 0 }, true);
    expect(t.session.frame().searchProgress).toBe(0);
    t.advance(1000, { x: 0, y: 0 }, true);
    t.session.controller.applyDamage(1);
    expect(t.session.frame().searchProgress).toBe(0);
    t.advance(1000, { x: 0, y: 0 }, true);
    t.session.pause();
    const remaining = t.session.controller.getView().remainingMs;
    t.advance(8000);
    expect(t.session.controller.getView().remainingMs).toBe(remaining);
    expect(t.session.frame().searchProgress).toBe(0);
    t.session.controller.resume();
    t.search();
    t.search();
    expect(t.session.inventory.getCarriedItems()).toHaveLength(1);
    t.session.dispose();
  });

  it('all eight chests are reachable and a full bag preserves the remaining chest', async () => {
    const t = setup();
    await t.session.start();
    for (let i = 0; i < 6; i++) {
      t.visit(i);
    }
    expect(t.session.inventory.getCarriedItems()).toHaveLength(6);
    t.visit(6);
    expect(t.session.frame().opened).toHaveLength(6);
    const item = t.session.inventory.getCarriedItems()[0]!;
    expect(t.session.drop(item.instanceId)).toBe(true);
    t.advance(20, { x: 0, y: 0 }, true);
    expect(
      t.session.inventory.getCarriedItems().find((entry) => entry.instanceId === item.instanceId),
    ).toEqual(item);
    t.advance(20);
    t.session.drop(item.instanceId);
    t.walk({ x: 608, y: 210 });
    t.search();
    expect(t.session.frame().opened).toHaveLength(7);
    t.session.drop(t.session.inventory.getCarriedItems()[0]!.instanceId);
    t.walk(TRIAL_MAP.chests[7]!);
    t.search();
    expect(t.session.frame().opened).toHaveLength(8);
    t.session.dispose();
  });

  it('cancels extraction on leaving, damage and insufficient value; retries failed settlement', async () => {
    const t = setup();
    await t.session.start();
    t.walk({ x: 512, y: 670 });
    expect(t.session.controller.startExtraction()).toEqual({ ok: false, error: 'VALUE_TOO_LOW' });
    t.walk({ x: 512, y: 600 });
    for (let i = 0; i < 4; i++) {
      t.visit(i);
    }
    t.walk({ x: 640, y: 600 });
    t.walk({ x: 512, y: 670 });
    t.session.controller.startExtraction();
    t.walk({ x: 512, y: 600 });
    expect(t.session.controller.getView().phase).toBe('active');
    t.walk({ x: 512, y: 670 });
    t.session.controller.startExtraction();
    t.session.controller.applyDamage(1);
    expect(t.session.controller.getView().phase).toBe('active');
    t.session.controller.startExtraction();
    t.session.drop(t.session.inventory.getCarriedItems()[0]!.instanceId);
    expect(t.session.controller.getView().phase).toBe('active');
    t.advance(20);
    t.advance(20, { x: 0, y: 0 }, true);
    t.advance(20);
    expect(t.session.controller.getView().value).toBe(100);
    t.session.controller.startExtraction();
    t.fail(true);
    t.advance(5000);
    await Promise.resolve();
    expect(t.session.controller.getView().saveError).toBe(true);
    expect(t.session.controller.getView().phase).toBe('settling');
    t.fail(false);
    await t.session.controller.retrySettlement();
    expect(t.session.controller.getView().phase).toBe('success');
    t.session.dispose();
  });

  it('preserves a search point when inventory insertion fails', async () => {
    const t = setup();
    await t.session.start();
    t.walk(TRIAL_MAP.chests[0]!);
    const insert = vi
      .spyOn(t.session.inventory, 'addLoot')
      .mockReturnValueOnce({ ok: false, error: 'INVALID_ITEM' });
    t.search();
    expect(t.session.frame().opened).toHaveLength(0);
    insert.mockRestore();
    t.search();
    expect(t.session.frame().opened).toHaveLength(1);
    t.session.dispose();
  });

  it('handles timeout, death and interrupted raids using only the trial namespace', async () => {
    for (const outcome of ['timeout', 'death', 'interrupted']) {
      const t = setup();
      await t.session.start();
      t.visit(0);
      if (outcome === 'timeout') {
        t.setTime(600000);
        t.session.update(20, EMPTY_INPUT);
        await Promise.resolve();
        expect(t.session.controller.getView().result?.reason).toBe('timeout');
      } else if (outcome === 'death') {
        t.session.controller.applyDamage(100);
        await Promise.resolve();
        expect(t.session.frame().action).toBe('death');
        expect(t.session.controller.getView().result?.reason).toBe('death');
      } else {
        const restored = new PersistentSave(trialStorage(t.storage));
        expect(restored.recoverInterrupted()).toBe(true);
        expect(restored.view().lastResult?.reason).toBe('interrupted');
        expect(restored.recoverInterrupted()).toBe(false);
      }
      expect(t.session.save.view().warehouse).toHaveLength(0);
      expect([...t.data.keys()].every((key) => key.startsWith(TRIAL_NAMESPACE))).toBe(true);
      t.session.dispose();
    }
  });

  it('never reads the formal or legacy namespace and uses an independent Web Lock', async () => {
    const data = new Map([
      [FORMAL_SAVE_KEY, 'broken-formal'],
      [SAVE_KEY, 'broken-legacy'],
    ]);
    const getItem = vi.fn((key: string) => data.get(key) ?? null);
    const save = new PersistentSave(
      trialStorage({
        getItem,
        setItem: (key, value) => {
          data.set(key, value);
        },
      }),
    );
    expect(() => save.importReference()).toThrow('No reference save');
    expect(getItem.mock.calls.every(([key]) => key.startsWith(TRIAL_NAMESPACE))).toBe(true);
    const request = vi.fn(async (_name, _options, callback) => callback({}));
    vi.stubGlobal('navigator', { locks: { request } });
    const release = await acquireSaveLock(TRIAL_LOCK);
    expect(request.mock.calls[0]?.[0]).toBe(TRIAL_LOCK);
    release?.();
  });
});
