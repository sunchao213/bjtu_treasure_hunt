export interface AudioSettings {
  volume: number;
  brightness: number;
}
const KEY = 'bjtu-audio-settings-v1';
export class SoundManager {
  private readonly sounds = new Map<string, HTMLAudioElement>();
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
    })) {
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.loop = name === 'footsteps' || name === 'alarm';
      this.sounds.set(name, audio);
    }
    this.applyVolume();
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
  stopAll(): void {
    for (const audio of this.sounds.values()) {
      audio.pause();
      audio.currentTime = 0;
    }
  }
  private applyVolume(): void {
    for (const audio of this.sounds.values())
      audio.volume = Math.max(0, Math.min(1, this.settings.volume));
  }
}
