export interface AudioSettings {
  volume: number;
  brightness: number;
}
const KEY = 'bjtu-audio-settings-v1';
export class SoundManager {
  private readonly sounds = new Map<string, HTMLAudioElement>();
  private readonly activation = new AbortController();
  private musicRequested = true;
  private musicPending = false;
  private settings: AudioSettings = { volume: 0.8, brightness: 1 };
  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.settings = { ...this.settings, ...JSON.parse(raw) };
    } catch {
      /* defaults */
    }
    for (const [name, src] of Object.entries({
      footsteps: '/audio/footsteps.wav',
      alarm: '/audio/alarm.wav',
      hit: '/audio/hit.mp3',
      pick: '/audio/pick.wav',
      behit: '/audio/behit.wav',
      box: '/audio/box.wav',
      home: '/audio/home.wav',
      // AAC also plays in Safari and iOS webviews that cannot decode Ogg Vorbis.
      music: '/audio/brainiac-maniac.m4a',
    })) {
      const audio = new Audio(`${import.meta.env.BASE_URL}${src.slice(1)}`);
      audio.preload = 'auto';
      audio.loop = name === 'footsteps' || name === 'alarm' || name === 'music';
      this.sounds.set(name, audio);
    }
    this.applyVolume();
    // Mobile activation is granted on release/click. Keep retrying after a denied
    // attempt, and respect an explicit stop when subsequent gestures arrive.
    const activate = () => {
      if (this.musicRequested) this.setMusic(true);
    };
    for (const event of ['pointerup', 'touchend', 'click', 'keydown']) {
      document.addEventListener(event, activate, { signal: this.activation.signal });
    }
  }
  getSettings(): Readonly<AudioSettings> {
    return this.settings;
  }
  setSettings(next: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...next };
    this.applyVolume();
    try {
      localStorage.setItem(KEY, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }
  play(name: string): void {
    const audio = this.sounds.get(name);
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }
  setLoop(name: 'footsteps' | 'alarm', active: boolean): void {
    const audio = this.sounds.get(name);
    if (!audio) return;
    if (active) {
      if (audio.paused) void audio.play().catch(() => undefined);
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }
  setMusic(active: boolean): void {
    this.musicRequested = active;
    const music = this.sounds.get('music');
    if (!music) return;
    if (active) {
      if (music.paused && !this.musicPending) {
        this.musicPending = true;
        void music
          .play()
          .catch(() => undefined)
          .finally(() => {
            this.musicPending = false;
          });
      }
    } else {
      music.pause();
      music.currentTime = 0;
    }
  }
  stopAll(): void {
    this.musicRequested = false;
    for (const audio of this.sounds.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
  }
  dispose(): void {
    this.activation.abort();
    this.stopAll();
  }
  private applyVolume(): void {
    for (const audio of this.sounds.values())
      audio.volume = Math.max(0, Math.min(1, this.settings.volume));
  }
}
