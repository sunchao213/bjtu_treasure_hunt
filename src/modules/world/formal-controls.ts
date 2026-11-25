import type { CampusView } from '../../campus-3d/view';
import type { Point } from '../../shared/types/game';
import type { TouchControls } from './touch-controls';
import type { WorldInput } from './formal-world';
import { isTouchLayout, localTouchDelta } from '../ui/mobile-layout';

/** Production Tab/Esc remain owned by the shell. This adapter owns world input only. */
export class FormalControls {
  private readonly abort = new AbortController();
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private firstLockedMove = true;
  private wasLocked = false;
  private suppressUnlock = false;
  private unlockTimer?: ReturnType<typeof setTimeout>;
  private drag?: { id: number; x: number; y: number };
  private mouse?: Point;
  private captureRequested = false;
  private captureDenied = false;
  private captureGeneration = 0;
  constructor(
    private readonly view: CampusView,
    private readonly touch: TouchControls,
    private readonly enabled: () => boolean,
    private readonly unlocked: () => void,
    private readonly inventoryOpen: () => boolean = () => false,
  ) {
    const canvas = view.renderer.domElement;
    const options = { signal: this.abort.signal };
    document.addEventListener(
      'keydown',
      (event) => {
        if (!this.enabled() || this.formFocused()) return;
        const key = event.key.toLowerCase();
        const digit = /^(Digit|Numpad)[1-4]$/.test(event.code ?? '')
          ? event.code.slice(-1)
          : /^[1-4]$/.test(key)
            ? key
            : null;
        if (digit && !this.inventoryOpen() && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault();
          if (!event.repeat) this.pressed.add(digit);
          return;
        }
        if (this.inventoryOpen() && !['w', 'a', 's', 'd'].includes(key)) return;
        if (
          ![
            'w',
            'a',
            's',
            'd',
            'arrowup',
            'arrowdown',
            'arrowleft',
            'arrowright',
            'e',
            'q',
            ' ',
            'l',
            'r',
            'g',
          ].includes(key)
        )
          return;
        event.preventDefault();
        this.keys.add(key);
        if (!event.repeat && ['e', 'q', ' ', 'l', 'r', 'g'].includes(key)) this.pressed.add(key);
      },
      options,
    );
    document.addEventListener(
      'keyup',
      (event) => this.keys.delete(event.key.toLowerCase()),
      options,
    );
    document.addEventListener(
      'pointerlockchange',
      () => {
        const locked = document.pointerLockElement === canvas;
        // A pending request can finish after a menu opened or a start failed.
        if (locked && !this.captureRequested) {
          this.releaseMouse();
          return;
        }
        if (locked) this.firstLockedMove = true;
        this.mouse = undefined;
        // Browser Esc may release the lock before delivering keydown. Let the
        // shell finish that key's panel action before opening settings.
        if (this.wasLocked && !locked && !this.suppressUnlock && this.worldInputEnabled()) {
          clearTimeout(this.unlockTimer);
          this.unlockTimer = setTimeout(() => {
            this.unlockTimer = undefined;
            if (this.worldInputEnabled()) this.unlocked();
          }, 0);
        }
        this.wasLocked = locked;
        this.suppressUnlock = false;
      },
      options,
    );
    canvas.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.worldInputEnabled()) return;
        canvas.focus();
        if (event.pointerType === 'touch') {
          this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
          event.preventDefault();
          canvas.setPointerCapture(event.pointerId);
        } else {
          const ready =
            document.pointerLockElement === canvas ||
            !canvas.requestPointerLock ||
            this.captureDenied;
          if (event.button === 0 && ready && !this.formFocused()) {
            event.preventDefault();
            this.keys.add('mouse-primary');
            this.pressed.add('mouse-primary');
          }
          this.captureMouse();
        }
      },
      options,
    );
    canvas.addEventListener(
      'pointermove',
      (event) => {
        if (!this.worldInputEnabled() || !view.canOrbit() || this.formFocused()) {
          this.mouse = undefined;
          return;
        }
        if (document.pointerLockElement === canvas) {
          if (this.firstLockedMove) {
            this.firstLockedMove = false;
            return;
          }
          view.orbitCamera(event.movementX, event.movementY);
        } else if (this.drag && this.drag.id === event.pointerId) {
          const delta = localTouchDelta(
            event.clientX - this.drag.x,
            event.clientY - this.drag.y,
            document.documentElement.dataset.rotated === 'true',
          );
          view.orbitCamera(delta.x, delta.y);
          this.drag.x = event.clientX;
          this.drag.y = event.clientY;
        } else if (event.pointerType !== 'touch') {
          if (this.mouse) {
            const dx = event.clientX - this.mouse.x;
            const dy = event.clientY - this.mouse.y;
            if (Number.isFinite(dx) && Number.isFinite(dy)) view.orbitCamera(dx, dy);
          }
          this.mouse = { x: event.clientX, y: event.clientY };
        }
      },
      options,
    );
    const stop = () => {
      this.keys.delete('mouse-primary');
      this.drag = undefined;
    };
    canvas.addEventListener('pointerup', stop, options);
    canvas.addEventListener('pointercancel', stop, options);
    canvas.addEventListener('lostpointercapture', stop, options);
    document.addEventListener('pointerup', stop, options);
    canvas.addEventListener('pointerleave', () => (this.mouse = undefined), options);
    window.addEventListener('blur', () => this.clear(), options);
    document.addEventListener(
      'focusin',
      () => {
        if (this.formFocused()) this.clear();
      },
      options,
    );
  }
  private worldInputEnabled(): boolean {
    return this.enabled() && !this.inventoryOpen();
  }
  private formFocused() {
    return !!document.activeElement?.closest('input,textarea,select,[contenteditable="true"]');
  }
  read(position: Point, lastAim: number): WorldInput {
    const allowed = this.enabled() && !this.formFocused();
    const inventoryOpen = this.inventoryOpen();
    const down = (key: string, touchKey = key.toUpperCase()) =>
      allowed &&
      (!inventoryOpen || ['w', 'a', 's', 'd'].includes(key)) &&
      (this.keys.has(key) ||
        this.pressed.has(key) ||
        (!inventoryOpen && this.touch.held(touchKey)));
    const raw = allowed
      ? {
          x:
            Number(down('d') || down('arrowright', 'RIGHT')) -
            Number(down('a') || down('arrowleft', 'LEFT')) +
            (inventoryOpen ? 0 : this.touch.movement.x),
          y:
            Number(down('s') || down('arrowdown', 'DOWN')) -
            Number(down('w') || down('arrowup', 'UP')) +
            (inventoryOpen ? 0 : this.touch.movement.y),
        }
      : { x: 0, y: 0 };
    const move = this.view.movementDirection(raw);
    let aim = lastAim;
    if (allowed && !inventoryOpen && isTouchLayout()) {
      const direction = this.touch.aim ?? this.touch.aimDirection;
      const world = direction ? this.view.movementDirection(direction) : move;
      if (world.x || world.y) aim = Math.atan2(world.y, world.x);
    } else if (allowed && !inventoryOpen) {
      const target = this.view.cameraAim();
      if (target && Math.hypot(target.x - position.x, target.y - position.y) > 8)
        aim = Math.atan2(target.y - position.y, target.x - position.x);
    }
    const input = {
      move,
      aim,
      interact: down('e'),
      attack: down(' ', 'SPACE') || down('mouse-primary', 'SPACE'),
      usePressed:
        allowed &&
        !inventoryOpen &&
        (this.pressed.has(' ') ||
          this.pressed.has('mouse-primary') ||
          (this.touch.justPressed?.('SPACE') ?? false)),
      hug: down('q'),
      flashlight: down('l'),
      refill: down('r'),
      flare: down('g'),
    };
    const slot = [...this.pressed].reverse().find((key) => /^[1-4]$/.test(key));
    this.pressed.clear();
    return slot && allowed && !inventoryOpen ? { ...input, quickSlot: Number(slot) - 1 } : input;
  }
  clear(preserveMouse = false): void {
    clearTimeout(this.unlockTimer);
    this.unlockTimer = undefined;
    this.keys.clear();
    this.pressed.clear();
    if (this.drag && this.view.renderer.domElement.hasPointerCapture?.(this.drag.id))
      this.view.renderer.domElement.releasePointerCapture(this.drag.id);
    this.drag = undefined;
    this.mouse = undefined;
    this.touch.reset();
    this.view.stopCameraLook();
    if (!preserveMouse) this.releaseMouse();
  }
  /** Call in a start/resume user gesture, before awaiting saves or networking. */
  captureMouse(): void {
    const canvas = this.view.renderer.domElement;
    if (
      this.inventoryOpen() ||
      isTouchLayout() ||
      !this.view.canOrbit() ||
      !canvas.requestPointerLock
    )
      return;
    this.captureRequested = true;
    if (document.pointerLockElement === canvas) return;
    const generation = ++this.captureGeneration;
    try {
      Promise.resolve(canvas.requestPointerLock())
        .then(() => {
          if (!this.captureRequested && document.pointerLockElement === canvas) this.releaseMouse();
        })
        .catch(() => {
          if (generation === this.captureGeneration) {
            this.captureRequested = false;
            this.captureDenied = true;
          }
        });
    } catch {
      this.captureDenied = true;
      this.captureRequested = false;
      // Hover look remains available without another click.
    }
  }
  releaseMouse(): void {
    this.captureRequested = false;
    this.captureGeneration++;
    this.mouse = undefined;
    if (document.pointerLockElement === this.view.renderer.domElement) {
      this.suppressUnlock = true;
      document.exitPointerLock();
    }
  }
  dispose(): void {
    this.clear();
    this.abort.abort();
  }
}
