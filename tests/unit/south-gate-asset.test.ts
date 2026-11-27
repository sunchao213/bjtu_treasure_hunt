import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  Vector3,
} from 'three';
import { GATE, GUARDHOUSE, TRIAL_MAP, toWorld } from '../../src/campus-3d/map';
import { contains, movePlayer } from '../../src/modules/world/movement';

interface Accessor {
  bufferView: number;
  byteOffset?: number;
  count: number;
  componentType: number;
  type: string;
}
interface Primitive {
  attributes: { POSITION: number };
  indices: number;
}
interface Document {
  asset: { version: string };
  buffers: { uri?: string; byteLength: number }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
  accessors: Accessor[];
  images: { uri?: string; bufferView?: number; mimeType: string }[];
  meshes: { primitives: Primitive[] }[];
  nodes: {
    name: string;
    mesh?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
}

const bytes = readFileSync(
  new URL('../../public/assets/models/bjtu-south-gate/south-gate.glb', import.meta.url),
);
const jsonLength = bytes.readUInt32LE(12);
const model = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as Document;
const binStart = 28 + jsonLength;

/** Decode real exported triangles, so a filled-in arch or wrong export axis fails this test. */
function meshes(prefix: string) {
  return model.nodes
    .filter((node) => node.name.startsWith(prefix) && node.mesh !== undefined)
    .flatMap((node) => {
      const matrix = new Matrix4().compose(
        new Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new Vector3().fromArray(node.scale ?? [1, 1, 1]),
      );
      return model.meshes[node.mesh!]!.primitives.map((primitive) => {
        const position = model.accessors[primitive.attributes.POSITION]!;
        const view = model.bufferViews[position.bufferView]!;
        const offset = binStart + (view.byteOffset ?? 0) + (position.byteOffset ?? 0);
        expect(position.componentType).toBe(5126);
        const vertices = Array.from({ length: position.count * 3 }, (_, index) =>
          bytes.readFloatLE(
            offset + Math.floor(index / 3) * (view.byteStride ?? 12) + (index % 3) * 4,
          ),
        );
        const accessor = model.accessors[primitive.indices]!;
        const indexView = model.bufferViews[accessor.bufferView]!;
        const start = binStart + (indexView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        const indices = Array.from({ length: accessor.count }, (_, index) =>
          accessor.componentType === 5123
            ? bytes.readUInt16LE(start + index * 2)
            : bytes.readUInt32LE(start + index * 4),
        );
        const geometry = new BufferGeometry().setAttribute(
          'position',
          new Float32BufferAttribute(vertices, 3),
        );
        geometry.setIndex(indices);
        geometry.applyMatrix4(matrix);
        const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
        mesh.updateMatrixWorld(true);
        return mesh;
      });
    });
}

describe('shipped Blender south-gate sample', () => {
  it('ships all textures inside a bounded glTF 2 file', () => {
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(4)).toBe(2);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    expect(model.asset.version).toBe('2.0');
    expect(bytes.length).toBeLessThan(900000);
    expect(model.buffers.every((buffer) => !buffer.uri)).toBe(true);
    expect(model.images).toHaveLength(3);
    for (const image of model.images) {
      expect(image.uri).toBeUndefined();
      expect(image.mimeType).toBe('image/png');
      const view = model.bufferViews[image.bufferView!]!;
      const offset = binStart + (view.byteOffset ?? 0);
      expect(bytes.readUInt32BE(offset + 16)).toBeLessThanOrEqual(256);
      expect(bytes.readUInt32BE(offset + 20)).toBeLessThanOrEqual(256);
    }
  });

  it('keeps the actual exported arch opening clear and its feet aligned to collisions', () => {
    const gate = meshes('SouthGate_gate_red_granite');
    expect(gate).toHaveLength(1);
    const centre = toWorld(GATE);
    const ray = new Raycaster(
      new Vector3(centre.x, 0.8, centre.z + 3),
      new Vector3(0, 0, -1),
      0,
      6,
    );
    expect(ray.intersectObjects(gate)).toHaveLength(0);
    const footX = centre.x - GATE.width / 64;
    ray.set(new Vector3(footX, 0.8, centre.z + 3), new Vector3(0, 0, -1));
    expect(ray.intersectObjects(gate).length).toBeGreaterThan(0);
    expect(TRIAL_MAP.obstacles.some((rect) => contains(rect, { x: footX * 32, y: GATE.y }))).toBe(
      true,
    );
    const bounds = new Box3().setFromObject(gate[0]!);
    expect(bounds.min.x).toBeCloseTo(12.125, 3);
    expect(bounds.max.y).toBeGreaterThan(5);
    expect(bounds.max.y).toBeLessThan(8);
    expect(bounds.min.z).toBeCloseTo(centre.z - GATE.depth / 64, 3);
    gate.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
  });

  it('blocks the guardhouse while preserving the central extraction route', () => {
    const house = meshes('Guardhouse_academic_warm_stucco');
    const bounds = new Box3().setFromObject(house[0]!);
    expect(bounds.min.x).toBeCloseTo(GUARDHOUSE.x / 32, 3);
    expect(bounds.max.z).toBeCloseTo((GUARDHOUSE.y + GUARDHOUSE.height) / 32, 3);
    const result = movePlayer(
      { x: GUARDHOUSE.x - 10, y: GUARDHOUSE.y + 10 },
      { x: 1, y: 0 },
      100,
      145,
      8,
      TRIAL_MAP.bounds,
      TRIAL_MAP.obstacles,
    );
    expect(result.x).toBeLessThan(GUARDHOUSE.x - 8);
    const centre = movePlayer(
      { x: 512, y: 685 },
      { x: 0, y: 1 },
      100,
      145,
      8,
      TRIAL_MAP.bounds,
      TRIAL_MAP.obstacles,
    );
    expect(centre.y).toBeGreaterThan(685);
    house.forEach((mesh) => {
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
  });
});
