import type { Point } from '../shared/types/game';
import type { TrialInput } from './session';

export interface CameraInput {
  enabled(): boolean;
  orbit(dx: number, dy: number): void;
  zoom(delta: number): void;
  reset(): void;
  move(point: Point): Point;
  aim?(): Point;
  unlocked?(): void;
}

/** Keyboard adapter; a future touch adapter can produce the same TrialInput. */
export class TrialControls {
  private readonly keys = new Set<string>();
  private readonly abort = new AbortController();
  private pointer?: Point;
  private mouse?: Point;
  private locked = false;
  private firstLockedMove = false;
  private drag?: { id: number; x: number; y: number };
  private readonly canvas: HTMLCanvasElement;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly groundPoint: (x: number, y: number) => Point | undefined,
    shortcut: (key: string) => void,
    private readonly camera?: CameraInput,
  ) {
    this.canvas = canvas;
    const options = { signal: this.abort.signal };
    document.addEventListener(
      'pointerlockchange',
      () => {
        const wasLocked = this.locked;
        this.locked = document.pointerLockElement === canvas;
        this.firstLockedMove = this.locked && !wasLocked;
        this.mouse = undefined;
        if (wasLocked && !this.locked && camera?.enabled()) camera.unlocked?.();
      },
      options,
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (
          event.target instanceof HTMLInputElement ||
          event.target instanceof HTMLSelectElement ||
          event.target instanceof HTMLTextAreaElement
        ) {
          return;
        }
        const key = event.key.toLowerCase();
        if (
          [
            'arrowup',
            'arrowdown',
            'arrowleft',
            'arrowright',
            'w',
            'a',
            's',
            'd',
            'e',
            'q',
            ' ',
          ].includes(key)
        ) {
          event.preventDefault();
          this.keys.add(key);
        }
        if (!event.repeat && ['escape', 'b', 'f', 't', 'g'].includes(key)) {
          // Escape must not also cancel a modal opened by this same keydown.
          event.preventDefault();
          shortcut(key);
        }
        if (!event.repeat && key === 'r' && camera?.enabled()) {
          event.preventDefault();
          camera.reset();
        }
      },
      options,
    );
    document.addEventListener(
      'keyup',
      (event) => this.keys.delete(event.key.toLowerCase()),
      options,
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        this.pointer = { x: event.clientX, y: event.clientY };
        if (event.pointerType !== 'touch') {
          // Browsers can report cursor recentering as the first captured delta.
          // Never interpret that transition as the player turning their head.
          if (this.locked && this.firstLockedMove) {
            this.firstLockedMove = false;
            this.mouse = { ...this.pointer };
            return;
          }
          if (camera?.enabled()) {
            const dx = this.locked
              ? event.movementX
              : this.mouse
                ? event.clientX - this.mouse.x
                : 0;
            const dy = this.locked
              ? event.movementY
              : this.mouse
                ? event.clientY - this.mouse.y
                : 0;
            if ((dx || dy) && Number.isFinite(dx) && Number.isFinite(dy)) camera.orbit(dx, dy);
            this.mouse = { ...this.pointer };
          } else this.mouse = undefined;
          return;
        }
        if (this.drag?.id === event.pointerId) {
          if (camera?.enabled())
            camera.orbit(event.clientX - this.drag.x, event.clientY - this.drag.y);
          this.drag.x = event.clientX;
          this.drag.y = event.clientY;
        }
      },
      options,
    );
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        canvas.focus();
        this.pointer = { x: event.clientX, y: event.clientY };
        if (event.pointerType !== 'touch') {
          if (camera?.enabled()) {
            // Clicking once to regain capture must not also swing the weapon.
            if (this.locked && event.button === 0) this.keys.add('mouse-attack');
            this.captureMouse();
          }
          return;
        }
        if (camera?.enabled()) {
          event.preventDefault();
          this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
          canvas.setPointerCapture(event.pointerId);
          canvas.classList.add('orbit-dragging');
        }
      },
      options,
    );
    const stopDrag = () => {
      this.keys.delete('mouse-attack');
      if (this.drag && canvas.hasPointerCapture(this.drag.id))
        canvas.releasePointerCapture(this.drag.id);
      this.drag = undefined;
      canvas.classList.remove('orbit-dragging');
    };
    canvas.addEventListener(
      'pointerup',
      () => {
        this.keys.delete('mouse-attack');
        stopDrag();
      },
      options,
    );
    canvas.addEventListener('pointercancel', stopDrag, options);
    canvas.addEventListener('lostpointercapture', stopDrag, options);
    canvas.addEventListener(
      'pointerleave',
      () => {
        this.mouse = undefined;
        this.pointer = undefined;
      },
      options,
    );
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), options);
    canvas.addEventListener(
      'wheel',
      (event) => {
        if (!camera?.enabled()) return;
        event.preventDefault();
        camera.zoom(
          event.deltaY *
            (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1),
        );
      },
      { ...options, passive: false },
    );
  }

  read(): TrialInput {
    const down = (...keys: string[]) => (keys.some((key) => this.keys.has(key)) ? 1 : 0);
    const move = {
      x: down('d', 'arrowright') - down('a', 'arrowleft'),
      y: down('s', 'arrowdown') - down('w', 'arrowup'),
    };
    return {
      move: this.camera ? this.camera.move(move) : move,
      interact: this.keys.has('e'),
      attack: this.keys.has(' ') || this.keys.has('mouse-attack'),
      hug: this.keys.has('q'),
      aim:
        this.camera?.enabled() && this.camera.aim
          ? this.camera.aim()
          : this.pointer && !this.drag
            ? this.groundPoint(this.pointer.x, this.pointer.y)
            : undefined,
    };
  }

  clear(): void {
    this.keys.clear();
    this.pointer = undefined;
    this.mouse = undefined;
    if (this.drag && this.canvas.hasPointerCapture(this.drag.id))
      this.canvas.releasePointerCapture(this.drag.id);
    this.drag = undefined;
    this.canvas.classList.remove('orbit-dragging');
  }
  captureMouse(): void {
    if (document.pointerLockElement === this.canvas || !this.canvas.requestPointerLock) return;
    // Starting/resuming supplies the browser's required user gesture. If unsupported,
    // ordinary mouse movement over the canvas still rotates without dragging.
    try {
      const result = this.canvas.requestPointerLock();
      if (result) void result.catch(() => undefined);
    } catch {
      /* Hover mouse-look remains available. */
    }
  }
  releaseMouse(): void {
    this.locked = false;
    this.firstLockedMove = false;
    this.mouse = undefined;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  dispose(): void {
    this.releaseMouse();
    this.clear();
    this.abort.abort();
  }
}
