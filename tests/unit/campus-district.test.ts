import { describe, expect, it } from 'vitest';
import layout from '../../assets-source/campus-3d/district/layout.json';
import { DISTRICT_MAP } from '../../src/campus-3d/map';
import { contains } from '../../src/modules/world/movement';
import { TrialSession } from '../../src/campus-3d/session';

const blocked = (x: number, y: number, radius = 8) =>
  DISTRICT_MAP.obstacles.some(
    (r) =>
      x + radius > r.x &&
      x - radius < r.x + r.width &&
      y + radius > r.y &&
      y - radius < r.y + r.height,
  );

/** A walkable grid floods the real configured collision, including shoreline and trees. */
function routes() {
  const step = 16;
  const cols = Math.floor(layout.width / step);
  const rows = Math.floor(layout.height / step);
  const walls = new Uint8Array(cols * rows);
  for (const rect of DISTRICT_MAP.obstacles) {
    for (
      let row = Math.max(0, Math.floor((rect.y - 8) / step));
      row <= Math.min(rows - 1, Math.ceil((rect.y + rect.height + 8) / step));
      row++
    ) {
      for (
        let col = Math.max(0, Math.floor((rect.x - 8) / step));
        col <= Math.min(cols - 1, Math.ceil((rect.x + rect.width + 8) / step));
        col++
      ) {
        const x = col * step,
          y = row * step;
        if (
          x + 8 > rect.x &&
          x - 8 < rect.x + rect.width &&
          y + 8 > rect.y &&
          y - 8 < rect.y + rect.height
        )
          walls[row * cols + col] = 1;
      }
    }
  }
  const point = (i: number) => ({ x: (i % cols) * step, y: Math.floor(i / cols) * step });
  const index = (x: number, y: number) => Math.round(y / step) * cols + Math.round(x / step);
  const parent = new Int32Array(cols * rows).fill(-1);
  const start = index(layout.spawn.x, layout.spawn.y);
  const queue = [start];
  parent[start] = start;
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head]!;
    for (const next of [current - 1, current + 1, current - cols, current + cols]) {
      if (next < 0 || next >= walls.length || parent[next] !== -1 || walls[next]) continue;
      const p = point(next);
      if (p.x < 32 || p.x > layout.width - 32 || p.y < 32 || p.y > layout.height - 32) continue;
      parent[next] = current;
      queue.push(next);
    }
  }
  return {
    path(x: number, y: number) {
      let end = index(x, y);
      expect(parent[end], `Unreachable ${x},${y}`).not.toBe(-1);
      const result = [];
      for (let count = 0; count < parent.length && end !== start; count++) {
        result.push(point(end));
        end = parent[end]!;
      }
      return result.reverse();
    },
  };
}

describe('continuous campus district', () => {
  it('preserves building identities, rear context and separate Siyuan roads', () => {
    const find = (id: string) => layout.buildings.find((b) => b.id === id)!;
    expect(layout.buildings).toHaveLength(15);
    expect(find('InformationCenter').y).toBeLessThan(find('West').y);
    expect(find('ScienceHall').y).toBeLessThan(find('East').y);
    expect(find('Library').x).toBeGreaterThan(find('East').x + find('East').width);
    expect(find('Teaching9').blocks.length).toBeGreaterThan(4);
    expect(find('Teaching7').y).toBeGreaterThan(find('Main').y + find('Main').height);
    for (const name of ['西侧楼间路', '东侧楼间路']) {
      const road = layout.roads.find((r) => r.name === name)!;
      const x = road.points[0]!.x;
      for (let y = 450; y < 1100; y += 8) expect(blocked(x, y), `${name} at ${y}`).toBe(false);
    }
  });

  it('blocks the lake and building masses while leaving gate and ninth-building courtyard walkable', () => {
    const lake = layout.waterObstacles[Math.floor(layout.waterObstacles.length / 2)]!;
    expect(blocked(lake.x + 8, lake.y + 8)).toBe(true);
    expect(blocked(layout.gate.x, layout.gate.y)).toBe(false);
    const ninth = layout.buildings.find((b) => b.id === 'Teaching9')!;
    for (const court of ninth.courtyards!) {
      expect(blocked(court.x + court.width / 2, court.y + court.height / 2)).toBe(false);
    }
    const passage = ninth.sidePassage!;
    for (let x = ninth.x - 20; x <= ninth.x + 150; x += 4) {
      expect(blocked(x, passage.y), `Teaching9 side passage blocked at ${x}`).toBe(false);
    }
    const trees = layout.trees;
    for (const chest of DISTRICT_MAP.chests) {
      expect(blocked(chest.x, chest.y)).toBe(false);
      expect(trees.some((t) => Math.hypot(t.x - chest.x, t.y - chest.y) < 40)).toBe(false);
    }
    const graph = routes();
    for (const chest of DISTRICT_MAP.chests)
      expect(graph.path(chest.x, chest.y).length).toBeGreaterThan(0);
  });

  it('walks from south gate to four actual chests and returns to save a complete raid', async () => {
    const graph = routes();
    const data = new Map<string, string>();
    let now = 0;
    const session = new TrialSession(
      {
        getItem: (key) => data.get(key) ?? null,
        setItem: (key, value) => {
          data.set(key, value);
        },
      },
      () => now,
      () => 'district-raid',
      () => undefined,
      DISTRICT_MAP,
    );
    const tick = (move = { x: 0, y: 0 }, interact = false) => {
      now += 20;
      session.update(20, { move, interact });
    };
    const walk = (x: number, y: number) => {
      for (let frame = 0; frame < 800; frame++) {
        const p = session.frame().position;
        if (Math.hypot(p.x - x, p.y - y) < 3) return;
        tick({ x: x - p.x, y: y - p.y });
      }
      throw new Error(`Movement blocked before ${x},${y}`);
    };
    await session.start();
    const paths = DISTRICT_MAP.chests.slice(0, 4).map((chest) => graph.path(chest.x, chest.y));
    for (let i = 0; i < 4; i++) {
      if (i) for (const p of [...paths[i - 1]!].reverse()) walk(p.x, p.y);
      walk(layout.spawn.x, layout.spawn.y);
      for (const p of paths[i]!) walk(p.x, p.y);
      const chest = DISTRICT_MAP.chests[i]!;
      walk(chest.x, chest.y);
      tick();
      for (let frame = 0; frame < 103; frame++) tick({ x: 0, y: 0 }, true);
      tick();
    }
    expect(session.controller.getView().value).toBe(100);
    for (const p of [...paths[3]!].reverse()) walk(p.x, p.y);
    walk(layout.spawn.x, layout.spawn.y);
    expect(contains(layout.extraction, session.frame().position)).toBe(true);
    tick({ x: 0, y: 0 }, true);
    for (let frame = 0; frame < 252; frame++) tick();
    await Promise.resolve();
    expect(session.controller.getView().phase).toBe('success');
    session.dispose();
  });
});
