export type Facing = 'up' | 'down' | 'left' | 'right';
export type PlayerAnimation = 'idle' | 'walk' | 'hurt' | 'death' | 'attack';
export const DIRECTIONS: readonly Facing[] = ['up', 'down', 'left', 'right'];
export const PLAYER_ANIMATIONS = {
  idle: { width: 128, height: 160, frames: 5, fps: 4, loop: true },
  walk: { width: 128, height: 160, frames: 5, fps: 9, loop: true },
  hurt: { width: 128, height: 160, frames: 5, fps: 10, loop: false },
  death: { width: 128, height: 160, frames: 5, fps: 8, loop: false },
  attack: { width: 314, height: 167, frames: 4, fps: 12, loop: false },
} as const;

/** All four direction groups are laid out horizontally, not in separate rows. */
export function animationFrame(action: PlayerAnimation, facing: Facing, elapsedMs: number): number {
  const animation = PLAYER_ANIMATIONS[action];
  const step = Math.floor((Math.max(0, elapsedMs) * animation.fps) / 1000);
  return (
    DIRECTIONS.indexOf(facing) * animation.frames +
    (animation.loop ? step % animation.frames : Math.min(step, animation.frames - 1))
  );
}

export function facingFromDirection(direction: { x: number; y: number }): Facing {
  return Math.abs(direction.x) > Math.abs(direction.y)
    ? direction.x < 0
      ? 'left'
      : 'right'
    : direction.y < 0
      ? 'up'
      : 'down';
}
