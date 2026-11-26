import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

const bytes = readFileSync(
  new URL('../../public/assets/models/minghu-stele/minghu-stele.glb', import.meta.url),
);
const jsonLength = bytes.readUInt32LE(12);
const model = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8')) as {
  asset: { version: string };
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number; mimeType: string }[];
  materials: { alphaMode?: string; doubleSided?: boolean; normalTexture?: unknown }[];
  nodes: {
    name: string;
    mesh?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: {
    primitives: { attributes: { POSITION: number }; indices: number; material: number }[];
  }[];
  accessors: { min: number[]; max: number[]; count: number }[];
};

describe('photo-referenced Minghu stele GLB', () => {
  it('is self-contained, opaque, lit stone with bounded download and geometry budgets', () => {
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    expect(bytes.readUInt32LE(8)).toBe(bytes.length);
    expect(model.asset.version).toBe('2.0');
    expect(bytes.length).toBeLessThan(1_600_000);
    expect(model.buffers.every((buffer) => !buffer.uri)).toBe(true);
    expect(model.images).toHaveLength(4);
    expect(
      model.images.every((image) => image.uri === undefined && image.bufferView !== undefined),
    ).toBe(true);
    expect(model.materials).toHaveLength(2);
    for (const material of model.materials) {
      expect(material.alphaMode ?? 'OPAQUE').toBe('OPAQUE');
      expect(material.doubleSided ?? false).toBe(false);
      expect(material.normalTexture).toBeDefined();
    }
    const triangles = model.meshes
      .flatMap((mesh) => mesh.primitives)
      .reduce((count, primitive) => count + model.accessors[primitive.indices]!.count / 3, 0);
    expect(triangles).toBeGreaterThan(2000);
    expect(triangles).toBeLessThan(12000);
  });

  it('has a solid body and planted feet, rather than a flat, double-sided image', () => {
    const body = model.nodes.find((node) => node.name === 'Minghu_SolidStele')!;
    expect(body).toBeDefined();
    const bounds = new Box3();
    for (const primitive of model.meshes[body.mesh!]!.primitives) {
      const position = model.accessors[primitive.attributes.POSITION]!;
      bounds.union(
        new Box3(new Vector3().fromArray(position.min), new Vector3().fromArray(position.max)),
      );
    }
    const size = bounds.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(1.6);
    expect(size.y).toBeGreaterThan(3.2);
    expect(size.z).toBeGreaterThan(0.6);
    expect(size.z).toBeLessThan(1);
    const feet = model.nodes.filter((node) => node.name.startsWith('Minghu_FootRock_'));
    expect(feet).toHaveLength(4);
    for (const foot of feet) {
      const matrix = new Matrix4().compose(
        new Vector3().fromArray(foot.translation ?? [0, 0, 0]),
        new Quaternion().fromArray(foot.rotation ?? [0, 0, 0, 1]),
        new Vector3().fromArray(foot.scale ?? [1, 1, 1]),
      );
      const position =
        model.accessors[model.meshes[foot.mesh!]!.primitives[0]!.attributes.POSITION]!;
      const box = new Box3(
        new Vector3().fromArray(position.min),
        new Vector3().fromArray(position.max),
      ).applyMatrix4(matrix);
      expect(box.min.y).toBeCloseTo(0, 5);
    }
  });
});
