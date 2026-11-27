import { readFileSync } from 'node:fs';
import {
  Box3,
  Matrix4,
  Quaternion,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
  Raycaster,
} from 'three';
import { describe, expect, it } from 'vitest';
import layout from '../../assets-source/campus-3d/district/layout.json';

const bytes = readFileSync(
  new URL('../../public/assets/models/bjtu-district/district.glb', import.meta.url),
);
const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as {
  buffers: { uri?: string }[];
  images?: { uri?: string }[];
  bufferViews: { byteOffset?: number; byteStride?: number }[];
  accessors: {
    min: number[];
    max: number[];
    bufferView: number;
    byteOffset?: number;
    count: number;
    componentType: number;
  }[];
  meshes: { primitives: { attributes: { POSITION: number }; indices: number }[] }[];
  nodes: {
    name: string;
    mesh?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
};
function bounds(prefix: string) {
  const result = new Box3();
  const nodes = model.nodes.filter((n) => n.name.startsWith(prefix) && n.mesh !== undefined);
  expect(nodes.length, `Missing ${prefix}`).toBeGreaterThan(0);
  for (const node of nodes) {
    const matrix = new Matrix4().compose(
      new Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new Vector3().fromArray(node.scale ?? [1, 1, 1]),
    );
    for (const primitive of model.meshes[node.mesh!]!.primitives) {
      const a = model.accessors[primitive.attributes.POSITION]!;
      result.union(
        new Box3(new Vector3().fromArray(a.min), new Vector3().fromArray(a.max)).applyMatrix4(
          matrix,
        ),
      );
    }
  }
  return result;
}

describe('shipped Blender district', () => {
  it('keeps the actual apartment roof and facade clear of the plaza road and paving', () => {
    const apartment = bounds('District_Dormitory2_');
    const road = layout.roads.find((r) => r.name === '草坪西侧道路')!;
    const curbWest = (road.points.at(-1)!.x - road.width / 2 - 7) / 32;
    expect(curbWest - apartment.max.x).toBeGreaterThan(0.9);
    expect(apartment.max.x).toBeLessThan(
      Math.min(...layout.forecourt.plaza.polygon.map((p) => p.x)) / 32,
    );
    expect(bounds('District_Dormitory2_recessed_blue_windows').max.y).toBeGreaterThan(2.5);
  });

  it('packages every selected landmark in a bounded self-contained GLB', () => {
    expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
    // Includes photo-refined buildings, two gardens, statue and four-face clock.
    // No external textures; keep the whole continuous district below 12 MB.
    expect(bytes.length).toBeLessThan(12_000_000);
    expect(model.buffers.every((b) => !b.uri)).toBe(true);
    expect(model.images?.length ?? 0).toBe(0);
    for (const building of layout.buildings) {
      const box = bounds(`${building.kind === 'siyuan' ? 'Siyuan' : 'District'}_${building.id}_`);
      expect(box.min.x).toBeGreaterThan(building.x / 32 - 0.7);
      // Tianyou's east-facing canopy/steps project one world unit beyond its wall.
      expect(box.max.x).toBeLessThan(
        (building.x + building.width) / 32 + (building.id === 'TianyouHall' ? 1.2 : 0.7),
      );
      expect(box.min.z).toBeGreaterThan(building.y / 32 - 0.7);
      // Teaching 9's broad shallow entry steps extend beyond the facade.
      expect(box.max.z).toBeLessThan(
        (building.y + building.height) / 32 + (building.id === 'Teaching9' ? 2.5 : 1.8),
      );
      expect(box.max.y).toBeGreaterThan(building.elevation - 0.3);
    }
  });

  it('ships the five-star flag and distinct hall/library/lake architectural materials', () => {
    const stars = model.nodes.find(
      (n) => n.name === 'District_Forecourt_forecourt_flag_five_stars',
    )!;
    expect(stars).toBeDefined();
    const triangles = model.meshes[stars.mesh!]!.primitives.reduce(
      (sum, p) => sum + model.accessors[p.indices]!.count / 3,
      0,
    );
    // Five filled 10-point stars, ten triangles each, separately on both sides.
    expect(triangles).toBe(100);
    const field = bounds('District_Forecourt_forecourt_flag_red');
    expect(field.max.x - field.min.x).toBeCloseTo(1.5, 2);
    expect(field.max.y - field.min.y).toBeCloseTo(1.07, 2);
    expect(bounds('District_TianyouHall_tianyou_blue_glass').max.y).toBeGreaterThan(7);
    expect(bounds('District_TianyouHall_tianyou_soffit').max.y).toBeLessThan(5);
    expect(bounds('District_Library_library_red_tiles').max.y).toBeGreaterThan(16);
    expect(bounds('District_Library_library_blue_atrium').max.y).toBeGreaterThan(13);
    const lake = bounds('District_Water_lake_pavilion_roof_gold');
    expect(lake.max.y).toBeGreaterThan(2.9);
    expect(lake.max.x - lake.min.x).toBeLessThan(3);
  });

  it('places the imported south arch above ground at its actual passage and lake on its shoreline', () => {
    const gate = bounds('District_SouthGate_gate_red_granite');
    expect(gate.getCenter(new Vector3()).x).toBeCloseTo(layout.gate.x / 32, 2);
    expect(gate.getCenter(new Vector3()).z).toBeCloseTo(layout.gate.y / 32, 2);
    expect(gate.min.y).toBeGreaterThanOrEqual(0);
    expect(gate.max.y).toBeGreaterThan(5);
    const lake = bounds('District_Water_district_lake');
    expect(lake.min.y).toBeCloseTo(0.025, 3);
    expect(lake.max.y).toBeCloseTo(0.025, 3);
    expect(lake.min.x).toBeCloseTo(Math.min(...layout.lake.map((p) => p.x)) / 32, 3);
    expect(lake.max.z).toBeCloseTo(Math.max(...layout.lake.map((p) => p.y)) / 32, 3);
  });

  it('exports an open side passage with an overhead bridge and a flat stone front portal', () => {
    const building = layout.buildings.find((b) => b.id === 'Teaching9')!;
    const passage = building.sidePassage!;
    const start = new Vector3(building.x / 32 - 0.6, 1.05, passage.y / 32);
    const ray = new Raycaster(start, new Vector3(1, 0, 0), 0, 5);
    const triangles: Mesh[] = [];
    const binStart = 28 + bytes.readUInt32LE(12);
    for (const node of model.nodes.filter(
      (n) => n.name.startsWith('District_Teaching9_') && n.mesh !== undefined,
    )) {
      const matrix = new Matrix4().compose(
        new Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new Vector3().fromArray(node.scale ?? [1, 1, 1]),
      );
      for (const primitive of model.meshes[node.mesh!]!.primitives) {
        const a = model.accessors[primitive.attributes.POSITION]!;
        const view = model.bufferViews[a.bufferView]!;
        const offset = binStart + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
        expect(a.componentType).toBe(5126);
        const vertices = Array.from({ length: a.count * 3 }, (_, i) =>
          bytes.readFloatLE(offset + Math.floor(i / 3) * (view.byteStride ?? 12) + (i % 3) * 4),
        );
        const ia = model.accessors[primitive.indices]!,
          iv = model.bufferViews[ia.bufferView]!;
        const io = binStart + (iv.byteOffset ?? 0) + (ia.byteOffset ?? 0);
        const indices = Array.from({ length: ia.count }, (_, i) =>
          ia.componentType === 5123
            ? bytes.readUInt16LE(io + i * 2)
            : bytes.readUInt32LE(io + i * 4),
        );
        const geometry = new BufferGeometry().setAttribute(
          'position',
          new Float32BufferAttribute(vertices, 3),
        );
        geometry.setIndex(indices);
        geometry.applyMatrix4(matrix);
        const mesh = new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }));
        mesh.updateMatrixWorld();
        triangles.push(mesh);
      }
    }
    expect(ray.intersectObjects(triangles).length).toBe(0);
    ray.ray.origin.y = 4.0;
    expect(ray.intersectObjects(triangles).length).toBeGreaterThan(0);
    expect(bounds('District_Teaching9_teaching9_portal_stone').max.y).toBeGreaterThan(5);
    expect(
      model.nodes.some(
        (n) => n.name.includes('Teaching9') && n.name.includes('blue_grey_metal_roof'),
      ),
    ).toBe(false);
    triangles.forEach((mesh) => {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
    });
  });
});
