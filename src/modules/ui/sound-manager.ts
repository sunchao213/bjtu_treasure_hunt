import { COMBAT_RULES } from '../../config/combat-config';

export interface AudioSettings {
  volume: number;
  brightness: number;
}

const KEY = 'bjtu-audio-settings-v1';
const AMBIENT_TRACKS = new Set(['music', 'footsteps']);
const SOURCES = {
  footsteps: 'footsteps.wav',
  alarm: 'alarm.wav',
  hit: 'hit.mp3',
  pick: 'pick.wav',
  behit: 'behit.wav',
  box: 'box.wav',
  home: 'home.wav',
  music: 'brainiac-maniac.m4a',
};
interface Track {
  name: string;
  url: string;
  loop: boolean;
  requested: boolean;
  loading: boolean;
  failed: boolean;
  buffer?: AudioBuffer;
  source?: AudioBufferSourceNode;
  fallback?: HTMLAudioElement;
  pending?: boolean;
}
export type MusicState = 'loading' | 'blocked' | 'playing' | 'stopped' | 'muted' | 'error';

/** One gesture-unlocked context mixes music and every effect on mobile browsers. */
export class SoundManager {
  private readonly tracks = new Map<string, Track>();
  private readonly activation = new AbortController();
  private readonly context?: AudioContext;
  private readonly master?: GainNode;
  private tinnitusActive = false;
  private tinnitusAmbientGain?: GainNode;
  private tinnitusFilter?: BiquadFilterNode;
  private tinnitusOscillator?: OscillatorNode;
  private tinnitusOscGain?: GainNode;
  private unlocked = false;
  private disposed = false;
  private settings: AudioSettings = { volume: 0.8, brightness: 1 };

  constructor(private readonly settingsKey = KEY) {
    try {
      const raw = localStorage.getItem(this.settingsKey);
      if (raw) this.settings = { ...this.settings, ...JSON.parse(raw) };
    } catch {
      /* defaults */
    }
    const Context = window.AudioContext;
    if (Context) {
      try {
        this.context = new Context();
        this.master = this.context.createGain();
        this.master.connect(this.context.destination);
        this.context.onstatechange = () => this.sync();
      } catch {
        // Browsers without Web Audio retain the media element fallback.
      }
    }
    for (const [name, file] of Object.entries(SOURCES)) {
      const track: Track = {
        name,
        url: `${import.meta.env.BASE_URL}audio/${file}`,
        loop: name === 'footsteps' || name === 'alarm' || name === 'music',
        requested: name === 'music',
        loading: false,
        failed: false,
      };
      this.tracks.set(name, track);
      if (this.context && this.master) {
        void this.load(track);
      } else {
        track.fallback = new Audio(track.url);
        track.fallback.preload = 'auto';
        track.fallback.loop = track.loop;
      }
    }
    this.applyVolume();
    const activate = () => this.unlock();
    // Keep listeners after rejection and resume again after an iOS interruption.
    for (const event of ['pointerup', 'touchend', 'click', 'keydown', 'WeixinJSBridgeReady']) {
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
      localStorage.setItem(this.settingsKey, JSON.stringify(this.settings));
    } catch {
      /* ignore */
    }
  }

  getMusicState(): MusicState {
    const track = this.tracks.get('music')!;
    if (this.settings.volume === 0) return 'muted';
    if (!track.requested) return 'stopped';
    if (track.failed || track.fallback?.error) return 'error';
    if (track.loading) return 'loading';
    if (!this.unlocked) return 'blocked';
    if (track.fallback) return track.fallback.paused ? 'blocked' : 'playing';
    return this.context?.state === 'running' && track.source ? 'playing' : 'blocked';
  }

  /** Call synchronously inside a gesture, before awaiting saves or fullscreen. */
  unlock(): void {
    if (this.disposed) return;
    this.unlocked = true;
    if (this.context && this.master) {
      if (this.context.state !== 'running' && this.context.state !== 'closed') {
        void this.context
          .resume()
          .then(() => this.sync())
          .catch(() => undefined);
      }
      for (const track of this.tracks.values()) {
        if (track.failed) void this.load(track);
      }
    }
    this.sync();
  }

  play(name: string): void {
    const track = this.tracks.get(name);
    if (!track || !this.unlocked || this.disposed) return;
    this.stopTrack(track);
    track.requested = true;
    this.startTrack(track);
  }

  setLoop(name: 'footsteps' | 'alarm', active: boolean): void {
    const track = this.tracks.get(name);
    if (!track) return;
    track.requested = active;
    if (active) this.startTrack(track);
    else this.stopTrack(track);
  }

  setMusic(active: boolean): void {
    const track = this.tracks.get('music')!;
    track.requested = active;
    if (active) this.unlock();
    else this.stopTrack(track);
  }

  playHugCry(): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running' || this.disposed) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(720, start);
    oscillator.frequency.exponentialRampToValueAtTime(390, start + 0.28);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.34);
    oscillator.connect(gain).connect(this.master);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + 0.36);
  }

  /** Short electric static warning cue during amplifier windup; stays audible during tinnitus. */
  playAmplifierCharge(): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running' || this.disposed) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = 'sawtooth';
    oscillator.frequency.setValueAtTime(520, start);
    oscillator.frequency.exponentialRampToValueAtTime(1240, start + 0.14);
    oscillator.frequency.exponentialRampToValueAtTime(860, start + 0.26);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.075, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.27);
    oscillator.connect(gain).connect(this.master);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
    oscillator.start(start);
    oscillator.stop(start + 0.28);
  }

  /** Muffle ambient tracks to 50% and play a quiet ringing tone while keeping alerts clear. */
  setTinnitus(active: boolean): void {
    if (this.disposed) return;
    const next = active && this.unlocked;
    if (next === this.tinnitusActive) return;
    this.tinnitusActive = next;
    this.syncTinnitusRouting();
    this.applyVolume();
  }

  isTinnitusActive(): boolean {
    return this.tinnitusActive;
  }

  stopAll(): void {
    this.tinnitusActive = false;
    this.stopTinnitusTone();
    this.syncTinnitusRouting();
    for (const track of this.tracks.values()) {
      track.requested = false;
      this.stopTrack(track);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.activation.abort();
    this.stopAll();
    this.tinnitusFilter?.disconnect();
    this.tinnitusFilter = undefined;
    this.tinnitusAmbientGain?.disconnect();
    this.tinnitusAmbientGain = undefined;
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => undefined);
    }
  }

  private async load(track: Track): Promise<void> {
    if (!this.context || track.loading || this.disposed) return;
    track.loading = true;
    track.failed = false;
    try {
      const response = await fetch(track.url, { signal: this.activation.signal });
      if (!response.ok) throw new Error(`Audio HTTP ${response.status}`);
      track.buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      if (!this.disposed && track.requested) this.startTrack(track);
    } catch {
      track.failed = true;
    } finally {
      track.loading = false;
    }
  }

  private sync(): void {
    for (const track of this.tracks.values()) {
      if (track.requested) this.startTrack(track);
    }
    this.syncTinnitusRouting();
  }

  private ensureTinnitusBus(): AudioNode | undefined {
    if (!this.context || !this.master) return undefined;
    if (!this.tinnitusAmbientGain) {
      this.tinnitusAmbientGain = this.context.createGain();
      this.tinnitusAmbientGain.gain.value = COMBAT_RULES.enemy.amplifier.tinnitusAmbientGain;
      this.tinnitusAmbientGain.connect(this.master);
      if (typeof this.context.createBiquadFilter === 'function') {
        const filter = this.context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 780;
        filter.Q.value = 0.7;
        filter.connect(this.tinnitusAmbientGain);
        this.tinnitusFilter = filter;
      }
    }
    return this.tinnitusFilter ?? this.tinnitusAmbientGain;
  }

  private destinationFor(trackName: string): AudioNode | undefined {
    if (!this.master) return undefined;
    if (this.tinnitusActive && AMBIENT_TRACKS.has(trackName)) {
      return this.ensureTinnitusBus() ?? this.master;
    }
    return this.master;
  }

  private startTinnitusTone(): void {
    const context = this.context;
    if (
      !context ||
      !this.master ||
      context.state !== 'running' ||
      this.disposed ||
      this.tinnitusOscillator
    ) {
      return;
    }
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(3850, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.038, start + 0.08);
    oscillator.connect(gain).connect(this.master);
    oscillator.onended = () => {
      if (this.tinnitusOscillator === oscillator) {
        this.tinnitusOscillator = undefined;
        this.tinnitusOscGain = undefined;
      }
      oscillator.disconnect();
      gain.disconnect();
    };
    this.tinnitusOscillator = oscillator;
    this.tinnitusOscGain = gain;
    oscillator.start(start);
  }

  private stopTinnitusTone(): void {
    const oscillator = this.tinnitusOscillator;
    const gain = this.tinnitusOscGain;
    this.tinnitusOscillator = undefined;
    this.tinnitusOscGain = undefined;
    if (oscillator) {
      try {
        oscillator.stop();
      } catch {
        /* already stopped */
      }
      oscillator.disconnect();
    }
    gain?.disconnect();
  }

  private syncTinnitusRouting(): void {
    if (!this.context || !this.master) return;
    if (this.tinnitusActive && !this.disposed) {
      const target = this.ensureTinnitusBus() ?? this.master;
      if (this.tinnitusAmbientGain) {
        this.tinnitusAmbientGain.gain.value = COMBAT_RULES.enemy.amplifier.tinnitusAmbientGain;
      }
      for (const track of this.tracks.values()) {
        if (!track.source || !AMBIENT_TRACKS.has(track.name)) continue;
        track.source.disconnect();
        track.source.connect(target);
      }
      this.startTinnitusTone();
    } else {
      this.stopTinnitusTone();
      for (const track of this.tracks.values()) {
        if (!track.source || !AMBIENT_TRACKS.has(track.name)) continue;
        track.source.disconnect();
        track.source.connect(this.master);
      }
    }
  }

  private startTrack(track: Track): void {
    if (!this.unlocked || this.disposed) return;
    if (track.fallback) {
      if (!track.fallback.paused || track.pending) return;
      track.pending = true;
      void track.fallback
        .play()
        .catch(() => undefined)
        .finally(() => {
          track.pending = false;
        });
    } else {
      if (
        !this.context ||
        !this.master ||
        this.context.state !== 'running' ||
        !track.buffer ||
        track.source
      )
        return;
      const source = this.context.createBufferSource();
      source.buffer = track.buffer;
      source.loop = track.loop;
      source.connect(this.destinationFor(track.name) ?? this.master);
      source.onended = () => {
        if (track.source === source) track.source = undefined;
        source.disconnect();
      };
      track.source = source;
      source.start();
    }
    if (!track.loop) track.requested = false;
  }

  private stopTrack(track: Track): void {
    track.source?.stop();
    track.source = undefined;
    if (track.fallback) {
      track.fallback.pause();
      track.fallback.currentTime = 0;
    }
  }

  private applyVolume(): void {
    const volume = Math.max(0, Math.min(1, this.settings.volume));
    if (this.master) this.master.gain.value = volume;
    for (const track of this.tracks.values()) {
      if (track.fallback) {
        const scale =
          this.tinnitusActive && AMBIENT_TRACKS.has(track.name)
            ? COMBAT_RULES.enemy.amplifier.tinnitusAmbientGain
            : 1;
        track.fallback.volume = volume * scale;
      }
    }
  }
}
