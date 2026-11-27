import type { FormalWorldScene } from '../scenes/formal-world-scene';

/** Start the production Three.js scene without a second rendering engine. */
export function createGame(scene: FormalWorldScene) {
  void scene.start();
  return { destroy: () => scene.destroy() };
}
