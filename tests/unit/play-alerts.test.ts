import { describe, expect, it } from 'vitest';
import {
  ENTITY_DEPTH_BASE,
  NIGHT_MASK_DEPTH,
  PLAY_ALERT_DEPTH,
  SOUTH_GATE_FEET_Y,
  alertClearsArt,
} from '../../src/modules/world/play-alerts';

describe('局内搜索与危险预警层级', () => {
  it('画在南门前景、地图底边和夜色遮罩之上', () => {
    const gateDepth = ENTITY_DEPTH_BASE + SOUTH_GATE_FEET_Y;
    const mapBottomDepth = ENTITY_DEPTH_BASE + 1824;
    expect(PLAY_ALERT_DEPTH).toBeGreaterThan(gateDepth);
    expect(PLAY_ALERT_DEPTH).toBeGreaterThan(mapBottomDepth);
    expect(PLAY_ALERT_DEPTH).toBeGreaterThan(NIGHT_MASK_DEPTH);
    expect(alertClearsArt(gateDepth)).toBe(true);
    expect(alertClearsArt(mapBottomDepth)).toBe(true);
  });
});
