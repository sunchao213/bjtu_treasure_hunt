import { describe, expect, it } from 'vitest';
import layout from '../../assets-source/campus-3d/district/layout.json';

function roadIntersects(rect: { x: number; y: number; width: number; height: number }) {
  return layout.roads
    .filter((r) => r.kind === 'road')
    .some((road) =>
      road.points.slice(1).some((b, i) => {
        const a = road.points[i]!;
        for (let j = 0; j <= 200; j++) {
          const x = a.x + ((b.x - a.x) * j) / 200,
            y = a.y + ((b.y - a.y) * j) / 200;
          const dx = Math.max(rect.x - x, 0, x - rect.x - rect.width),
            dy = Math.max(rect.y - y, 0, y - rect.y - rect.height);
          if (Math.hypot(dx, dy) < road.width / 2 + 7) return true;
        }
        return false;
      }),
    );
}

describe('corrected campus gardens and building identities', () => {
  it('keeps dormitory two west of the plaza, with a clear public road between them', () => {
    const dorm = layout.buildings.find((b) => b.id === 'Dormitory2')!;
    expect(dorm.title).toBe('2号学生公寓');
    expect(layout.buildings.some((b) => b.id === 'MotorFleet')).toBe(false);
    expect(dorm.x + dorm.width).toBeLessThan(
      Math.min(...layout.forecourt.plaza.polygon.map((p) => p.x)) - 40,
    );
    expect(roadIntersects(dorm)).toBe(false);
  });

  it('places all asphalt outside Fanghua Garden and preserves connected park footpaths', () => {
    const park = layout.parks.find((p) => p.id === 'EastGarden')!;
    expect(park.title).toBe('芳华园');
    expect(roadIntersects(park)).toBe(false);
    const walks = layout.paths.filter((p) => p.name.startsWith('芳华园'));
    expect(walks.length).toBeGreaterThanOrEqual(4);
    expect(walks.every((p) => p.kind === 'path' && p.width < 22)).toBe(true);
    const statue = layout.fanghua.statue;
    expect(
      walks.filter((p) => p.points.some((q) => q.x === statue.x && q.y === statue.y)),
    ).toHaveLength(3);
  });

  it('faces the hall east, removes the unwanted annex and aligns seventh building, statue and clock', () => {
    expect(layout.buildings.find((b) => b.id === 'TianyouHall')!.front).toBe('east');
    expect(layout.buildings.some((b) => b.id === 'Arts')).toBe(false);
    const seventh = layout.buildings.find((b) => b.id === 'Teaching7')!;
    const fifth = layout.buildings.find((b) => b.id === 'Teaching5')!;
    expect(seventh.x + seventh.width).toBeLessThan(fifth.x);
    expect(seventh.blocks[0]!.floors).toBe(4);
    const { statue, clock } = layout.seventhGarden;
    expect(statue.x).toBeCloseTo(seventh.x + seventh.width / 2, 3);
    expect(clock.x).toBe(statue.x);
    expect(statue.y).toBeGreaterThan(seventh.y + seventh.height);
    expect(clock.y).toBeGreaterThan(statue.y);
    for (const feature of [layout.seventhGarden.statuePlaza, layout.seventhGarden.clockPlaza]) {
      expect(roadIntersects(feature)).toBe(false);
    }
  });
});
