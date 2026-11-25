import district from '../../assets-source/campus-3d/district/layout.json';
import type { Point } from '../shared/types/game';
import type { TrialMap } from './map';

export const toWorld = (p: Point) => ({ x: p.x / 32, z: p.y / 32 });
export const toMap = (x: number, z: number): Point => ({ x: x * 32, y: z * 32 });
export interface CampusSceneConfig {
  area: 'district' | 'siyuan' | 'south-gate';
  name: string;
  modelUrl: string;
  map: TrialMap;
  trees: readonly (Point & { variant: number })[];
  roads: readonly { name: string; width: number; points: readonly Point[] }[];
  lamps?: readonly (Point & { radius: number })[];
  markers?: readonly (Point & { kind: 'stele' | 'board' | 'door' | 'record' })[];
}

/** Safe URL-independent default, also convenient for isolated map previews. */
export const DISTRICT_SCENE: CampusSceneConfig = {
  area: 'district',
  name: '南部校园',
  modelUrl: 'assets/models/bjtu-district/district.glb',
  map: {
    id: district.id,
    width: district.width,
    height: district.height,
    bounds: { x: 30, y: 35, width: district.width - 60, height: district.height - 70 },
    spawn: district.spawn,
    extraction: district.extraction,
    playerRadius: 8,
    playerSpeed: 145,
    obstacles: district.obstacles,
    chests: district.chests.map((p, i) => ({
      ...p,
      id: `district-chest-${i + 1}`,
      itemId: 'school-badge',
    })),
  },
  trees: district.trees,
  roads: [...district.roads, ...district.paths],
};
