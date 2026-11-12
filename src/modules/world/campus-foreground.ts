import type { Point } from '../../shared/types/game';

interface ForegroundLayer {
  key: string;
  feetY: number;
  /** Map artwork silhouettes, including holes in archways. */
  outlines: readonly (readonly Point[])[];
}

const polygon = (coordinates: readonly number[]): Point[] =>
  Array.from({ length: coordinates.length / 2 }, (_, i) => ({
    x: coordinates[i * 2]!,
    y: coordinates[i * 2 + 1]!,
  }));

// These coordinates follow campus-base.png. Never copy a rectangular patch of
// pavement into a foreground layer: it would erase actors passing through it.
export const CAMPUS_FOREGROUND: readonly ForegroundLayer[] = [
  {
    key: 'campus-foreground',
    feetY: 1790,
    outlines: [
      polygon([
        133, 1788, 133, 1661, 141, 1640, 159, 1621, 184, 1608, 216, 1600, 247, 1598, 280, 1605, 305,
        1620, 323, 1641, 334, 1667, 334, 1788, 310, 1788, 310, 1723, 302, 1708, 286, 1697, 263,
        1690, 217, 1690, 197, 1698, 183, 1710, 174, 1726, 174, 1788,
      ]),
    ],
  },
  {
    key: 'flagpole-landmark-foreground',
    feetY: 867,
    outlines: [
      polygon([
        199, 615, 218, 612, 241, 602, 256, 596, 256, 638, 239, 637, 218, 643, 199, 645, 205, 630,
      ]),
      polygon([257, 583, 263, 583, 263, 816, 253, 816, 253, 784, 257, 781]),
      polygon([226, 812, 284, 812, 294, 823, 294, 865, 220, 865, 220, 825]),
    ],
  },
];

/** Keep characters readable when an actual foreground landmark overlaps them. */
export function foregroundOpacity(layer: ForegroundLayer, players: readonly Point[]): number {
  const overlapping = players.some(
    (player) =>
      player.y < layer.feetY &&
      layer.outlines.some((outline) => {
        const xs = outline.map((point) => point.x);
        const ys = outline.map((point) => point.y);
        return (
          player.x + 22 >= Math.min(...xs) &&
          player.x - 22 <= Math.max(...xs) &&
          player.y >= Math.min(...ys) &&
          player.y - 72 <= Math.max(...ys)
        );
      }),
  );
  return overlapping ? 0.22 : 1;
}
