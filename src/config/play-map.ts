import type { Point, Rect } from '../shared/types/game';
import formal from './formal-campus.json';
import district from '../../assets-source/campus-3d/district/layout.json';
import { reachableGround } from '../modules/world/reachable-ground';
import { WORLD } from './world-config';

export interface MapZone extends Rect {
  readonly points?: readonly Point[];
}

export interface PlayMap {
  readonly id: 'campus' | 'generated';
  readonly canSpawn?: (point: Point) => boolean;
  readonly title: string;
  readonly imageKey: string;
  readonly hasStory: boolean;
  readonly width: number;
  readonly height: number;
  readonly playerRadius: number;
  readonly playerSpeed: number;
  readonly spawn: Point;
  readonly extraction: MapZone;
  readonly extractions: readonly MapZone[];
  readonly obstacles: readonly Rect[];
  readonly trees?: readonly Point[];
  readonly lamps: readonly { x: number; y: number; radius: number }[];
  readonly gates: readonly {
    x: number;
    y: number;
    name: string;
    role: 'extraction' | 'landmark';
  }[];
  readonly buildings: readonly (typeof WORLD.buildings)[number][];
  readonly lootZones: typeof WORLD.lootZones;
  readonly enemyRoutes: readonly {
    readonly id: string;
    readonly kind: 'patrol' | 'hug' | 'amplifier';
    readonly route: readonly Point[];
    readonly fixedPosition?: boolean;
  }[];
  readonly stone: Point | null;
  readonly chapterThreePoints?: typeof formal.chapterThreePoints;
  readonly questChest: typeof WORLD.questChest | null;
  readonly chapterTwoPoints: typeof WORLD.chapterTwoPoints | null;
}

interface TiledObject {
  x: number;
  y: number;
  width?: number;
  height?: number;
  point?: boolean;
  visible?: boolean;
  polygon?: readonly { x: number; y: number }[];
}

interface TiledLayer {
  name: string;
  objects?: readonly TiledObject[];
}

interface TiledDocument {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: readonly TiledLayer[];
}

const CAMPUS_MAP: PlayMap = {
  ...formal,
  id: 'campus',
  title: '南部校园夜巡',
  trees: district.trees,
  imageKey: 'campus-3d-overview',
  hasStory: true,
  extractions: [formal.extraction],
  enemyRoutes: formal.enemyRoutes.map((route) => ({
    ...route,
    kind:
      route.kind === 'hug'
        ? ('hug' as const)
        : route.kind === 'amplifier'
          ? ('amplifier' as const)
          : ('patrol' as const),
  })),
  gates: formal.gates.map((gate) => ({
    ...gate,
    role: gate.role === 'extraction' ? ('extraction' as const) : ('landmark' as const),
  })),
  canSpawn: reachableGround(formal),
};

function layer(map: TiledDocument, name: string): TiledLayer {
  const found = map.layers.find((entry) => entry.name === name);
  if (!found) {
    throw new Error(`地图缺少图层 ${name}`);
  }
  return found;
}

function polygonZone(object: TiledObject): MapZone | null {
  const polygon = object.polygon;
  if (!polygon || polygon.length < 3) {
    return null;
  }
  const points = polygon.map((point) => ({ x: object.x + point.x, y: object.y + point.y }));
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
    points,
  };
}

function collisionRect(object: TiledObject): Rect | null {
  const zone = polygonZone(object);
  if (zone) {
    return { x: zone.x, y: zone.y, width: zone.width, height: zone.height };
  }
  const width = object.width ?? 0;
  const height = object.height ?? 0;
  if (width < 4 || height < 4) {
    return null;
  }
  return { x: object.x, y: object.y, width, height };
}

/** Reads Collision, Spawn and Extraction from a Tiled map. */
export function playMapFromTiled(
  map: TiledDocument,
): Omit<
  PlayMap,
  | 'id'
  | 'title'
  | 'imageKey'
  | 'hasStory'
  | 'playerRadius'
  | 'playerSpeed'
  | 'lamps'
  | 'buildings'
  | 'lootZones'
  | 'enemyRoutes'
  | 'stone'
  | 'questChest'
  | 'chapterTwoPoints'
  | 'gates'
> & { extractions: readonly MapZone[] } {
  const obstacles = (layer(map, 'Collision').objects ?? [])
    .filter((object) => object.visible !== false)
    .map(collisionRect)
    .filter((rect): rect is Rect => rect !== null);
  const spawnObject = (layer(map, 'Spawn').objects ?? []).find(
    (object) => object.visible !== false && (object.point === true || object.polygon === undefined),
  );
  if (!spawnObject) {
    throw new Error('地图 Spawn 图层没有出生点');
  }
  const extractions = (layer(map, 'Extraction').objects ?? [])
    .filter((object) => object.visible !== false)
    .map((object) => polygonZone(object) ?? collisionRect(object))
    .filter((zone): zone is MapZone => zone !== null);
  if (extractions.length === 0 || !extractions[0]) {
    throw new Error('地图 Extraction 图层没有撤离点');
  }
  return {
    width: map.width * map.tilewidth,
    height: map.height * map.tileheight,
    spawn: { x: spawnObject.x, y: spawnObject.y },
    extraction: extractions[0],
    extractions,
    obstacles,
  };
}

// Keep the Tiled parser for archived resources; production always uses the 3D district.
export function activeMap(): PlayMap {
  return CAMPUS_MAP;
}
export function upcomingMap(): PlayMap {
  return CAMPUS_MAP;
}
export function beginRaidMap(): PlayMap {
  return CAMPUS_MAP;
}
export function useCampusMap(): PlayMap {
  return CAMPUS_MAP;
}
export function previewUpcomingMap(): PlayMap {
  return CAMPUS_MAP;
}
export function resetMapRotation(): void {
  /* One production map, no rotation state. */
}

export function zoneContains(zone: MapZone, point: Point): boolean {
  const points = zone.points;
  if (!points || points.length < 3) {
    return (
      point.x >= zone.x &&
      point.x <= zone.x + zone.width &&
      point.y >= zone.y &&
      point.y <= zone.y + zone.height
    );
  }
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const start = points[index]!;
    const end = points[previous]!;
    if (
      start.y > point.y !== end.y > point.y &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export function inExtraction(point: Point, map: PlayMap = CAMPUS_MAP): boolean {
  return map.extractions.some((zone) => zoneContains(zone, point));
}
