import { describe, expect, it } from 'vitest';
import { CAMPUS_FOREGROUND, foregroundOpacity } from '../../src/modules/world/campus-foreground';

describe('foreground readability at story search points', () => {
  const flag = CAMPUS_FOREGROUND.find((layer) => layer.key === 'flagpole-landmark-foreground')!;
  const gate = CAMPUS_FOREGROUND.find((layer) => layer.key === 'campus-foreground')!;

  it('fades the flag over the fixed notebook search position and the gate over the spawn', () => {
    expect(foregroundOpacity(flag, [{ x: 240, y: 655 }])).toBe(0.22);
    expect(foregroundOpacity(gate, [{ x: 235, y: 1682 }])).toBe(0.22);
  });

  it('restores landmarks when players leave or stand in front of their base', () => {
    expect(foregroundOpacity(flag, [{ x: 900, y: 620 }])).toBe(1);
    expect(foregroundOpacity(flag, [{ x: 260, y: 880 }])).toBe(1);
    expect(foregroundOpacity(gate, [{ x: 160, y: 1500 }])).toBe(1);
    expect(foregroundOpacity(gate, [])).toBe(1);
  });
});
