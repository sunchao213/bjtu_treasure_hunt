import { describe, expect, it } from 'vitest';
import { TrialSession, EMPTY_INPUT } from '../../src/campus-3d/session';
import { campusLamps } from '../../src/campus-3d/night';
import type { TrialMap } from '../../src/campus-3d/map';

const map: TrialMap = {
  id: 'night-test',
  width: 800,
  height: 800,
  bounds: { x: 0, y: 0, width: 800, height: 800 },
  spawn: { x: 400, y: 400 },
  extraction: { x: 600, y: 600, width: 100, height: 100 },
  playerRadius: 8,
  playerSpeed: 145,
  obstacles: [],
  chests: [{ id: 'north', x: 400, y: 360, itemId: 'school-badge' }],
};
async function setup(night = true, walls: TrialMap['obstacles'] = []) {
  let now = 0;
  const data = new Map<string, string>();
  const session = new TrialSession(
    {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    },
    () => now,
    () => 'night-test',
    () => undefined,
    { ...map, obstacles: walls },
    night,
    false,
  );
  await session.start();
  const tick = (ms = 20, input = EMPTY_INPUT) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 20) {
      now += 20;
      session.update(20, input);
    }
  };
  return { session, tick };
}

describe('three-dimensional night exploration', () => {
  it('keeps mouse-facing independent of forward, backward and sideways movement', async () => {
    const { session, tick } = await setup();
    for (const move of [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ]) {
      const before = session.frame().position;
      tick(100, { move, interact: false, aim: { x: before.x, y: before.y - 250 } });
      const frame = session.frame();
      expect(frame.facing).toBe('up');
      expect(frame.action).toBe('walk');
      expect(frame.position.x - before.x).toBeCloseTo(move.x * 14.5);
      expect(frame.position.y - before.y).toBeCloseTo(move.y * 14.5);
    }
    const position = session.frame().position;
    for (const [x, y, facing] of [
      [250, 0, 'right'],
      [0, 250, 'down'],
      [-250, 0, 'left'],
    ] as const) {
      tick(20, { ...EMPTY_INPUT, aim: { x: position.x + x, y: position.y + y } });
      expect(session.frame().facing).toBe(facing);
      expect(session.frame().position).toEqual(position);
    }
    session.dispose();
  });

  it('hides chests and cancels an ongoing search when the flashlight switches off', async () => {
    const { session, tick } = await setup();
    tick(1000, { ...EMPTY_INPUT, interact: true });
    expect(session.frame().searchProgress).toBeGreaterThan(0.4);
    session.nightAction('flashlight');
    tick(1100, { ...EMPTY_INPUT, interact: true });
    expect(session.frame().visibleChests).toEqual([]);
    expect(session.frame().target).toBeNull();
    expect(session.frame().searchProgress).toBe(0);
    expect(session.inventory.getCarriedItems()).toHaveLength(0);
    session.nightAction('flashlight');
    tick(2100, { ...EMPTY_INPUT, interact: true });
    expect(session.frame().opened).toEqual(['north']);
    session.dispose();
  });

  it('uses map-local walls and aim for discovery; flares cannot reveal chests', async () => {
    const { session, tick } = await setup(true, [{ x: 390, y: 375, width: 20, height: 8 }]);
    tick();
    expect(session.frame().visibleChests).toEqual([]);
    session.nightAction('flare');
    tick();
    expect(session.frame().night.flares).toHaveLength(1);
    expect(session.frame().visibleChests).toEqual([]);
    session.dispose();
    const open = await setup();
    open.tick(20, { ...EMPTY_INPUT, aim: { x: 500, y: 400 } });
    expect(open.session.frame().visibleChests).toEqual([]);
    open.tick(20, { ...EMPTY_INPUT, aim: map.chests[0] });
    expect(open.session.frame().visibleChests).toEqual(['north']);
    open.session.nightAction('flashlight');
    open.session.nightAction('flare');
    expect(open.session.frame().visibleChests).toEqual([]);
    open.session.dispose();
  });

  it('freezes battery and flares during pause and ignores paused equipment actions', async () => {
    const { session, tick } = await setup();
    session.nightAction('flare');
    tick(2000);
    session.pause();
    const before = session.frame().night;
    tick(30_000);
    expect(session.nightAction('battery')).toBeUndefined();
    expect(session.nightAction('flare')).toBeUndefined();
    expect(session.nightAction('flashlight')).toBeUndefined();
    expect(session.frame().night).toEqual(before);
    session.controller.resume();
    tick(28_000);
    expect(session.frame().night.flares).toHaveLength(0);
    expect(session.frame().night.battery).toBeLessThan(before.battery);
    session.dispose();
  });

  it('limits batteries and flares, shuts down at zero and replenishes only on a new round', async () => {
    const { session, tick } = await setup();
    session.nightAction('battery');
    expect(session.frame().night.spareBatteries).toBe(2);
    tick(180_100);
    expect(session.frame().night.flashlight).toBe(false);
    expect(session.frame().visibleChests).toEqual([]);
    session.nightAction('battery');
    expect(session.frame().night.battery).toBe(100);
    expect(session.frame().night.spareBatteries).toBe(1);
    tick(100);
    session.nightAction('battery');
    tick(100);
    session.nightAction('battery');
    expect(session.frame().night.spareBatteries).toBe(0);
    session.nightAction('flare');
    session.nightAction('flare');
    session.nightAction('flare');
    expect(session.frame().night.flares).toHaveLength(2);
    expect(session.frame().night.flareCount).toBe(0);
    session.controller.abandon();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.prepareNext()).toBe(true);
    expect(session.frame().night).toMatchObject({
      battery: 100,
      spareBatteries: 2,
      flareCount: 2,
      flares: [],
    });
    session.dispose();
  });

  it('keeps daytime exploration and map-local lamp placements intact', async () => {
    const { session, tick } = await setup(false);
    expect(session.nightAction('flashlight')).toBeUndefined();
    tick(2100, { ...EMPTY_INPUT, interact: true });
    expect(session.frame().opened).toEqual(['north']);
    expect(session.frame().night.battery).toBe(100);
    const lamps = campusLamps(map);
    expect(lamps).toHaveLength(2);
    expect(lamps.every((p) => p.x > 0 && p.x < map.width && p.y > 0 && p.y < map.height)).toBe(
      true,
    );
    session.dispose();
  });
});
