import type { Point } from '../../shared/types/game';

export type TouchAction = 'E' | 'SPACE' | 'L' | 'R' | 'G';

/** Pointer capture lets movement and an action stay held by separate fingers. */
export class TouchControls {
  movement: Point = { x: 0, y: 0 };
  private directionPointer: number | null = null;
  private readonly actions = new Map<number, TouchAction>();
  private readonly pressed = new Set<TouchAction>();
  private readonly cleanup = new AbortController();
  private enabled = false;
  private readonly stick: HTMLElement;

  constructor(private readonly root: HTMLElement) {
    const stick = root.querySelector<HTMLElement>('.touch-stick');
    if (!stick) throw new Error('Missing touch stick');
    this.stick = stick;
    const options = { signal: this.cleanup.signal };
    stick.addEventListener(
      'pointerdown',
      (event) => {
        if (!this.enabled || this.directionPointer !== null) return;
        event.preventDefault();
        this.directionPointer = event.pointerId;
        stick.setPointerCapture(event.pointerId);
        this.move(event);
      },
      options,
    );
    stick.addEventListener(
      'pointermove',
      (event) => {
        if (event.pointerId === this.directionPointer) this.move(event);
      },
      options,
    );
    const releaseDirection = (event: PointerEvent) => {
      if (event.pointerId !== this.directionPointer) return;
      this.directionPointer = null;
      this.movement = { x: 0, y: 0 };
      this.drawStick();
    };
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      stick.addEventListener(event, releaseDirection, options);
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-touch-action]')) {
      button.addEventListener(
        'pointerdown',
        (event) => {
          if (!this.enabled) return;
          event.preventDefault();
          button.setPointerCapture(event.pointerId);
          const action = button.dataset.touchAction as TouchAction;
          this.actions.set(event.pointerId, action);
          this.pressed.add(action);
          button.classList.add('is-held');
        },
        options,
      );
      const release = (event: PointerEvent) => {
        this.actions.delete(event.pointerId);
        if (![...this.actions.values()].includes(button.dataset.touchAction as TouchAction)) {
          button.classList.remove('is-held');
        }
      };
      for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
        button.addEventListener(event, release, options);
      }
    }
    window.addEventListener('blur', () => this.reset(), options);
    window.addEventListener('pagehide', () => this.reset(), options);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.hidden) this.reset();
      },
      options,
    );
  }

  held(action: string): boolean {
    return (
      this.enabled &&
      (this.pressed.has(action as TouchAction) ||
        [...this.actions.values()].some((held) => held === action))
    );
  }

  /** A quick tap must survive until the next game frame, even after pointerup. */
  finishFrame(): void {
    this.pressed.clear();
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (!enabled) this.reset();
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('button')) {
      button.disabled = !enabled;
    }
  }

  reset(): void {
    this.directionPointer = null;
    this.actions.clear();
    this.pressed.clear();
    this.movement = { x: 0, y: 0 };
    this.drawStick();
    this.root.querySelectorAll('.is-held').forEach((button) => button.classList.remove('is-held'));
  }

  dispose(): void {
    this.reset();
    this.cleanup.abort();
  }

  private move(event: PointerEvent): void {
    const bounds = this.stick.getBoundingClientRect();
    const radius = bounds.width * 0.32;
    const dx = (event.clientX - bounds.left - bounds.width / 2) / radius;
    const dy = (event.clientY - bounds.top - bounds.height / 2) / radius;
    const length = Math.hypot(dx, dy);
    this.movement =
      length < 0.15
        ? { x: 0, y: 0 }
        : {
            x: dx / Math.max(1, length),
            y: dy / Math.max(1, length),
          };
    this.drawStick();
  }

  private drawStick(): void {
    this.stick.style.setProperty('--stick-x', `${this.movement.x * 32}px`);
    this.stick.style.setProperty('--stick-y', `${this.movement.y * 32}px`);
  }
}
