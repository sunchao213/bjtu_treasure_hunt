import layout from '../../assets-source/campus-3d/siyuan/layout.json';
import type { Point } from '../shared/types/game';

const { crop, projection } = layout.reference;
const zoomDivisor = 2 ** (crop.level - 1);
const cosine = Math.cos((projection.angleDegrees * Math.PI) / 180);
const sine = Math.sin((projection.angleDegrees * Math.PI) / 180);

/** Website zoom1 IMAGE ground point, not a roof label or longitude/latitude. */
export function websiteGroundToSiyuan(point: Point): Point {
  const x = point.x / zoomDivisor - crop.columns[0]! * crop.tileSize - projection.cropAnchor[0]!;
  const y = point.y / zoomDivisor - crop.rows[0]! * crop.tileSize - projection.cropAnchor[1]!;
  return {
    x:
      projection.gameAnchor[0]! +
      ((x / cosine - y / sine) / 2) * projection.logicalUnitsPerGroundPixel,
    y:
      projection.gameAnchor[1]! +
      ((x / cosine + y / sine) / 2) * projection.logicalUnitsPerGroundPixel,
  };
}

export function siyuanToWebsiteGround(point: Point): Point {
  const u = (point.x - projection.gameAnchor[0]!) / projection.logicalUnitsPerGroundPixel;
  const v = (point.y - projection.gameAnchor[1]!) / projection.logicalUnitsPerGroundPixel;
  return {
    x:
      (crop.columns[0]! * crop.tileSize + projection.cropAnchor[0]! + cosine * (u + v)) *
      zoomDivisor,
    y: (crop.rows[0]! * crop.tileSize + projection.cropAnchor[1]! + sine * (-u + v)) * zoomDivisor,
  };
}
