import { isTouchLayout, requestLandscape } from './mobile-layout';

interface KeyboardLock {
  lock(keys: string[]): Promise<void>;
  unlock(): void;
}

const keyboard = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

/** Own Escape only while the game has requested fullscreen for an active raid. */
export class GameFullscreen {
  private active = false;
  private generation = 0;
  private readonly onChange = () => {
    if (document.fullscreenElement || !this.active) return;
    this.release();
    this.onExit();
  };

  constructor(private readonly onExit: () => void) {
    document.addEventListener('fullscreenchange', this.onChange);
  }

  /** Invoke in the start click, after requesting pointer lock (fullscreen consumes activation). */
  async enter(): Promise<void> {
    this.active = true;
    const generation = ++this.generation;
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      if (!this.active || generation !== this.generation || !document.fullscreenElement) return;
      if (isTouchLayout()) {
        await requestLandscape();
      } else {
        await keyboard()?.lock(['Escape']);
        // Permission can finish after the raid ended or the player left fullscreen.
        if (!this.active || !document.fullscreenElement) keyboard()?.unlock();
      }
    } catch {
      // Browser support and user permission are optional; keep the normal controls available.
    }
  }

  /** Keep the display fullscreen in the lobby, but return Escape to the browser. */
  release(): void {
    if (!this.active) return;
    this.active = false;
    this.generation++;
    keyboard()?.unlock();
  }

  dispose(): void {
    document.removeEventListener('fullscreenchange', this.onChange);
    this.release();
  }
}
