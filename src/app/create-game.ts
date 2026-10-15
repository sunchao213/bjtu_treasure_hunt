import Phaser from 'phaser';
import { WorldScene } from '../scenes/world-scene';

export function createGame(scene: WorldScene): Phaser.Game {
  const parent = document.getElementById('game-canvas')!;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-canvas',
    backgroundColor: '#143c3c',
    // Measure the unrotated content box; boundingClientRect swaps axes in portrait.
    scale: { mode: Phaser.Scale.NONE, width: parent.clientWidth, height: parent.clientHeight },
    render: { antialias: true, roundPixels: true },
    scene: [scene],
  });
  const observer = new ResizeObserver(() => {
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width > 0 && height > 0 && (game.scale.width !== width || game.scale.height !== height)) {
      game.scale.resize(width, height);
    }
  });
  observer.observe(parent);
  game.events.once(Phaser.Core.Events.DESTROY, () => observer.disconnect());
  return game;
}
