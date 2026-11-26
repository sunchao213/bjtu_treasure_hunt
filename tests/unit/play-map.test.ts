import { describe, expect, it } from 'vitest';
import {
  activeMap,
  beginRaidMap,
  inExtraction,
  previewUpcomingMap,
  upcomingMap,
  resetMapRotation,
  playMapFromTiled,
} from '../../src/config/play-map';
import tiled from '../../public/assets/maps/campus-night/campus.tmj?raw';
describe('production campus selection', () => {
  it('keeps consecutive raids and previews on the district with story enabled', () => {
    resetMapRotation();
    for (let i = 0; i < 5; i++) {
      expect(beginRaidMap()).toBe(activeMap());
      expect(upcomingMap()).toBe(activeMap());
      expect(previewUpcomingMap()).toBe(activeMap());
      expect(activeMap()).toMatchObject({
        id: 'campus',
        width: 3264,
        height: 3328,
        hasStory: true,
      });
    }
    expect(inExtraction(activeMap().spawn)).toBe(true);
  });
  it('retains the standalone parser for archived Tiled maps', () => {
    const map = playMapFromTiled(JSON.parse(tiled));
    expect(map.extractions).toHaveLength(2);
    expect(map.width).toBe(1504);
    expect(map.obstacles.length).toBeGreaterThan(40);
  });
});
