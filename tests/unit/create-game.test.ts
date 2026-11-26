import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../../src/app/create-game';
import type { FormalWorldScene } from '../../src/scenes/formal-world-scene';
describe('formal game lifecycle', () => {
  it('boots and tears down the injected Three.js runtime', () => {
    const scene = { start: vi.fn(async () => {}), destroy: vi.fn() };
    const game = createGame(scene as unknown as FormalWorldScene);
    expect(scene.start).toHaveBeenCalledOnce();
    game.destroy();
    expect(scene.destroy).toHaveBeenCalledOnce();
  });
});
