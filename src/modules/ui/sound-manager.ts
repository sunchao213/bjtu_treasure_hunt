/** Small audio facade so browser autoplay is started by an explicit game action. */
export class SoundManager {
  private readonly background = new Audio('/audio/background.ogg');

  constructor() {
    this.background.preload = 'auto';
    this.background.loop = true;
    this.background.volume = 0.8;
  }

  setBackground(active: boolean): void {
    if (active) {
      if (this.background.paused) {
        void this.background.play().catch(() => undefined);
      }
      return;
    }
    this.background.pause();
    this.background.currentTime = 0;
  }

  stopAll(): void {
    this.setBackground(false);
  }
}
