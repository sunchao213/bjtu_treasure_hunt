import { describe, expect, it } from 'vitest';
import { landscapeSize, localTouchDelta } from '../../src/modules/ui/mobile-layout';

describe('mobile landscape coordinates', () => {
  it('keeps a landscape viewport on portrait phones but never rotates desktop', () => {
    expect(landscapeSize(390, 844, true)).toEqual({ width: 844, height: 390, rotated: true });
    expect(landscapeSize(844, 390, true)).toEqual({ width: 844, height: 390, rotated: false });
    expect(landscapeSize(390, 844, false)).toEqual({ width: 390, height: 844, rotated: false });
  });
  it('maps each physical drag to the correct game axis after a clockwise rotation', () => {
    expect(localTouchDelta(0, 32, true)).toEqual({ x: 32, y: -0 });
    expect(localTouchDelta(-32, 0, true)).toEqual({ x: 0, y: 32 });
    expect(localTouchDelta(0, -32, true)).toEqual({ x: -32, y: -0 });
    expect(localTouchDelta(32, 0, true)).toEqual({ x: 0, y: -32 });
    expect(localTouchDelta(20, -10, false)).toEqual({ x: 20, y: -10 });
  });
});
