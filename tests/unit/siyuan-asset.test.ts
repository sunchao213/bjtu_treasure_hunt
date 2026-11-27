import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import layout from '../../assets-source/campus-3d/siyuan/layout.json';
import { SIYUAN_MAP } from '../../src/campus-3d/map';
import { TrialSession } from '../../src/campus-3d/session';
import { contains, movePlayer } from '../../src/modules/world/movement';
import {
  siyuanToWebsiteGround,
  websiteGroundToSiyuan,
} from '../../src/campus-3d/siyuan-coordinates';

const bytes = readFileSync(
  new URL('../../public/assets/models/bjtu-siyuan/siyuan.glb', import.meta.url),
);
const document = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
  buffers: { uri?: string }[];
  accessors: { min: number[]; max: number[] }[];
  meshes: { primitives: { attributes: { POSITION: number } }[] }[];
  nodes: {
    name: string;
    mesh?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
};

describe('website-referenced Siyuan block', () => {
  it('ships three independent buildings on the same X/Z axes used for collision', () => {
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.length).toBeLessThan(2_000_000);
    expect(layout.parts.map((part) => part.id)).toEqual(['West', 'Main', 'East']);
    expect(document.nodes.some((node) => /Link|Wing/.test(node.name))).toBe(false);
    expect(document.buffers.every((buffer) => !buffer.uri)).toBe(true);
    for (const part of layout.parts) {
      const node = document.nodes.find((n) => n.name === `Siyuan_${part.id}_ivory_stone`)!;
      expect(node).toBeDefined();
      const matrix = new Matrix4().compose(
        new Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new Vector3().fromArray(node.scale ?? [1, 1, 1]),
      );
      const accessor =
        document.accessors[document.meshes[node.mesh!]!.primitives[0]!.attributes.POSITION]!;
      const bounds = new Box3(
        new Vector3().fromArray(accessor.min),
        new Vector3().fromArray(accessor.max),
      ).applyMatrix4(matrix);
      expect(bounds.min.x).toBeCloseTo(part.x / 32, 3);
      expect(bounds.max.x).toBeCloseTo((part.x + part.width) / 32, 3);
      expect(bounds.min.z).toBeCloseTo(part.y / 32, 3);
      expect(bounds.max.z).toBeCloseTo((part.y + part.height) / 32, 3);
      expect(bounds.max.y).toBeCloseTo(part.elevation, 3);
      const stop = movePlayer(
        { x: part.x + part.width / 2, y: part.y + part.height + 20 },
        { x: 0, y: -1 },
        5000,
        145,
        8,
        SIYUAN_MAP.bounds,
        SIYUAN_MAP.obstacles,
      );
      expect(stop.y).toBeGreaterThanOrEqual(part.y + part.height + 8);
    }
  });

  it('records reference coordinates and keeps named roads on the correct sides', () => {
    const main = layout.parts.find((part) => part.id === 'Main')!;
    const west = layout.parts.find((part) => part.id === 'West')!;
    const east = layout.parts.find((part) => part.id === 'East')!;
    const road = (name: string) => layout.roads.find((road) => road.name === name)!;
    expect(west.x + west.width).toBeLessThan(main.x);
    expect(east.x).toBeGreaterThan(main.x + main.width);
    expect(road('银杏大道').points[0]!.y).toBeGreaterThan(main.y + main.height);
    expect(road('知行大道').points[0]!.y).toBeLessThan(
      Math.min(...layout.parts.map((part) => part.y)),
    );
    expect(road('明湖路').points[0]!.x).toBeGreaterThan(east.x + east.width);
    // Every authored ground corner must round-trip to its retained source-image pixel.
    const projection = layout.reference.projection;
    const anchor = websiteGroundToSiyuan({ x: 12456, y: 11940 });
    expect(anchor.x).toBeCloseTo(650);
    expect(anchor.y).toBeCloseTo(850);
    for (const point of [SIYUAN_MAP.spawn, ...SIYUAN_MAP.chests]) {
      const roundTrip = websiteGroundToSiyuan(siyuanToWebsiteGround(point));
      expect(roundTrip.x).toBeCloseTo(point.x, 6);
      expect(roundTrip.y).toBeCloseTo(point.y, 6);
    }
    for (const part of layout.parts) {
      const corners = [
        { x: part.x, y: part.y },
        { x: part.x + part.width, y: part.y },
        { x: part.x + part.width, y: part.y + part.height },
        { x: part.x, y: part.y + part.height },
      ];
      corners.forEach((point, i) => {
        const u = (point.x - projection.gameAnchor[0]!) / projection.logicalUnitsPerGroundPixel;
        const v = (point.y - projection.gameAnchor[1]!) / projection.logicalUnitsPerGroundPixel;
        expect(projection.cropAnchor[0]! + Math.cos(Math.PI / 6) * (u + v)).toBeCloseTo(
          part.referenceGroundCorners[i]![0]!,
          2,
        );
        expect(projection.cropAnchor[1]! + 0.5 * (-u + v)).toBeCloseTo(
          part.referenceGroundCorners[i]![1]!,
          2,
        );
      });
    }
  });

  it('keeps both separating roads free in exported geometry and collision, and names the rear context', () => {
    for (const name of ['西侧楼间路', '东侧楼间路']) {
      const road = layout.roads.find((road) => road.name === name)!;
      const x = road.points[0]!.x;
      const start = { x, y: 1005 };
      let stopped = start;
      for (let frame = 0; frame < 50; frame++) {
        stopped = movePlayer(
          stopped,
          { x: 0, y: -1 },
          100,
          145,
          8,
          SIYUAN_MAP.bounds,
          SIYUAN_MAP.obstacles,
        );
      }
      expect(stopped.y).toBeCloseTo(280, 5);
      // Read actual exported bounds for every batch, including trim, stairs and roofs.
      // A reintroduced bridge can be above the player, so check 0.25–12 world units.
      const corridor = new Box3(
        new Vector3((x - 10) / 32, 0.25, 535 / 32),
        new Vector3((x + 10) / 32, 12, 850 / 32),
      );
      for (const node of document.nodes.filter((node) => node.mesh !== undefined)) {
        const matrix = new Matrix4().compose(
          new Vector3().fromArray(node.translation ?? [0, 0, 0]),
          new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
          new Vector3().fromArray(node.scale ?? [1, 1, 1]),
        );
        for (const primitive of document.meshes[node.mesh!]!.primitives) {
          const accessor = document.accessors[primitive.attributes.POSITION]!;
          const bounds = new Box3(
            new Vector3().fromArray(accessor.min),
            new Vector3().fromArray(accessor.max),
          ).applyMatrix4(matrix);
          expect(bounds.intersectsBox(corridor), `${name} blocked by ${node.name}`).toBe(false);
        }
      }
    }
    for (const [behind, title] of [
      ['West', '信息中心'],
      ['East', '科学会堂'],
    ]) {
      const landmark = layout.contextLandmarks.find((landmark) => landmark.behind === behind)!;
      expect(landmark.title).toBe(title);
      expect(landmark.status).toBe('待建');
      expect(landmark.y).toBeLessThan(layout.parts.find((part) => part.id === behind)!.y);
    }
    const names = document.nodes.map((node) => node.name);
    expect(names).toContain('Siyuan_West_blue_curtain_wall');
    expect(names).toContain('Siyuan_East_blue_curtain_wall');
  });

  it('walks to all eight chests around the real footprint and saves a complete extraction', async () => {
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
      () => 'siyuan-test',
      () => undefined,
      SIYUAN_MAP,
    );
    const advance = (ms: number, move = { x: 0, y: 0 }, interact = false) => {
      for (let t = 0; t < ms; t += 20) {
        now += 20;
        session.update(20, { move, interact });
      }
    };
    const walk = (x: number, y: number) => {
      for (let t = 0; t < 1500; t++) {
        const p = session.frame().position;
        if (Math.hypot(x - p.x, y - p.y) < 3) return;
        advance(20, { x: x - p.x, y: y - p.y });
      }
      throw new Error(
        `Unreachable ${x},${y}, stopped at ${JSON.stringify(session.frame().position)}`,
      );
    };
    await session.start();
    for (let i = 0; i < 8; i++) {
      const chest = SIYUAN_MAP.chests[i]!;
      expect(SIYUAN_MAP.obstacles.some((rect) => contains(rect, chest))).toBe(false);
      if (i < 4) {
        walk(session.frame().position.x, 1030);
        walk(chest.x, 1030);
      } else if (i === 4) {
        walk(1880, 1030);
        walk(1880, chest.y);
      } else {
        walk(session.frame().position.x, 490);
        walk(chest.x, 490);
      }
      walk(chest.x, chest.y);
      if (i >= 6) session.drop(session.inventory.getCarriedItems()[0]!.instanceId);
      // Drop stays behind on a different position, so E searches rather than picks it up.
      if (i >= 6) walk(chest.x, chest.y + 48);
      advance(20);
      advance(2040, { x: 0, y: 0 }, true);
      advance(20);
      expect(session.frame().opened).toHaveLength(i + 1);
    }
    walk(session.frame().position.x, 490);
    walk(1880, 490);
    walk(1880, 1100);
    const zone = SIYUAN_MAP.extraction;
    walk(zone.x + zone.width / 2, 1100);
    walk(zone.x + zone.width / 2, zone.y + zone.height / 2);
    advance(20, { x: 0, y: 0 }, true);
    expect(session.controller.getView().phase).toBe('extracting');
    advance(5020);
    await Promise.resolve();
    expect(session.controller.getView().phase).toBe('success');
    expect(session.save.view().settledRaidIds).toContain('siyuan-test');
    session.dispose();
  });
});
