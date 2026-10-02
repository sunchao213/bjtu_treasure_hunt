import Phaser from 'phaser';
import { WorldScene } from '../scenes/world-scene';

export function createGame(scene: WorldScene): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-canvas',
    backgroundColor: '#143c3c',
    scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
    render: { antialias: true, roundPixels: true },
    scene: [scene],
  });
}
