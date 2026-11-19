import type { Point, Rect } from '../shared/types/game';
import { WORLD } from './world-config';
import tiledText from '../../public/assets/maps/campus-night/campus.tmj?raw';

export interface MapZone extends Rect {
  readonly points?: readonly Point[];
}

export interface PlayMap {
  readonly id: 'campus' | 'generated';
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
  readonly lamps: readonly { x: number; y: number; radius: number }[];
  readonly gates: readonly {
    x: number;
    y: number;
    name: string;
    role: 'extraction' | 'landmark';
  }[];
  readonly buildings: readonly (typeof WORLD.buildings)[number][];
  readonly lootZones: typeof WORLD.lootZones;
  readonly enemyRoutes: typeof WORLD.enemyRoutes;
  readonly stone: Point | null;
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
  id: 'campus',
  title: '海淀夜巡',
  imageKey: 'campus-base',
  hasStory: true,
  width: WORLD.width,
  height: WORLD.height,
  playerRadius: WORLD.playerRadius,
  playerSpeed: WORLD.playerSpeed,
  spawn: WORLD.spawn,
  extraction: WORLD.extraction,
  extractions: [WORLD.extraction],
  obstacles: WORLD.obstacles,
  lamps: WORLD.lamps,
  gates: WORLD.gates,
  buildings: WORLD.buildings,
  lootZones: WORLD.lootZones,
  enemyRoutes: WORLD.enemyRoutes,
  stone: WORLD.stone,
  questChest: WORLD.questChest,
  chapterTwoPoints: WORLD.chapterTwoPoints,
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

const tiled = playMapFromTiled(JSON.parse(tiledText) as TiledDocument);
const columnCount = 3;
const rowCount = 2;
const lootZones = Array.from({ length: columnCount * rowCount }, (_, index) => {
  const column = index % columnCount;
  const row = Math.floor(index / columnCount);
  const spanWidth = (tiled.width - 80) / columnCount;
  const spanHeight = (tiled.height - 100) / rowCount;
  return {
    id: `generated-${column}-${row}`,
    x: 40 + column * spanWidth,
    y: 50 + row * spanHeight,
    width: spanWidth,
    height: spanHeight,
  };
});

const GENERATED_MAP: PlayMap = {
  id: 'generated',
  title: '生成校园',
  imageKey: 'generated-campus',
  hasStory: false,
  playerRadius: WORLD.playerRadius,
  playerSpeed: WORLD.playerSpeed,
  lamps: [],
  buildings: [],
  lootZones,
  enemyRoutes: WORLD.enemyRoutes,
  stone: null,
  questChest: null,
  chapterTwoPoints: null,
  gates: tiled.extractions.map((zone, index) => ({
    x: zone.x + zone.width / 2,
    y: zone.y + zone.height / 2,
    name: `撤离点 ${index + 1}`,
    role: 'extraction' as const,
  })),
  ...tiled,
};

const MAPS = [CAMPUS_MAP, GENERATED_MAP] as const;
let raidCount = 0;
let current: PlayMap = CAMPUS_MAP;

export function activeMap(): PlayMap {
  return current;
}

export function upcomingMap(): PlayMap {
  return MAPS[raidCount % MAPS.length] ?? CAMPUS_MAP;
}

/** The next raid uses this map, then the following raid switches. */
export function beginRaidMap(): PlayMap {
  current = upcomingMap();
  raidCount += 1;
  return current;
}

/** Prep screen shows the map the next raid will use, without consuming it. */
export function useCampusMap(): PlayMap {
  current = CAMPUS_MAP;
  return current;
}

export function previewUpcomingMap(): PlayMap {
  current = upcomingMap();
  return current;
}

export function resetMapRotation(): void {
  raidCount = 0;
  current = CAMPUS_MAP;
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

export function inExtraction(point: Point, map: PlayMap = current): boolean {
  return map.extractions.some((zone) => zoneContains(zone, point));
}
