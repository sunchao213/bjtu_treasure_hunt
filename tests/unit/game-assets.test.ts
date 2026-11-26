import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { worldAssetPaths } from '../../src/config/game-assets';

describe('局内素材', () => {
  it('场景会加载的图片都在 public 里', () => {
    const paths = worldAssetPaths();
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      const bytes = readFileSync(new URL(`../../public/${path}`, import.meta.url), 'utf8');
      expect(bytes.length, path).toBeGreaterThan(0);
    }
  });
});
