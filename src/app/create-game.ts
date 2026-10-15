import Phaser from 'phaser';
import type { WorldScene } from '../scenes/world-scene';

export function createGame(scene: WorldScene): Phaser.Game {
  const parent = document.getElementById('game-canvas')!;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-canvas',
    backgroundColor: '#143c3c',
    // DOM joysticks handle gameplay touch; allow swiping the canvas to scroll.
    input: { touch: { capture: false } },
    // Measure the unrotated content box; boundingClientRect swaps axes in portrait.
    scale: { mode: Phaser.Scale.NONE, width: parent.clientWidth, height: parent.clientHeight },
    render: { antialias: true, roundPixels: true },
    scene: [scene],
  });
  const resize = () => {
    // A first ResizeObserver delivery can precede Phaser's asynchronous boot.
    if (!game.scale.canvas) return;
    const width = parent.clientWidth;
    const height = parent.clientHeight;
    if (width > 0 && height > 0 && (game.scale.width !== width || game.scale.height !== height)) {
      game.scale.resize(width, height);
    }
  };
  const observer = new ResizeObserver(resize);
  game.events.once(Phaser.Core.Events.READY, resize);
  observer.observe(parent);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    observer.disconnect();
    game.events.off(Phaser.Core.Events.READY, resize);
  });
  return game;
}
