import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundManager } from '../../src/modules/ui/sound-manager';

class FakeSource {
  buffer?: { name: string };
  loop = false;
  onended: (() => void) | null = null;
  connect = vi.fn((target: unknown) => target);
  disconnect = vi.fn();
  start = vi.fn();
  stop = vi.fn(() => this.onended?.());
}
class FakeGain {
  gain = { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
  connect = vi.fn((target: unknown) => target);
  disconnect = vi.fn();
}
class FakeContext {
  static instances: FakeContext[] = [];
  state = 'suspended';
  currentTime = 0;
  destination = {};
  onstatechange: (() => void) | null = null;
  sources: FakeSource[] = [];
  gains: FakeGain[] = [];
  createGain = vi.fn(() => {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  });
  decodeAudioData = vi.fn(async (data: ArrayBuffer) => ({ name: new TextDecoder().decode(data) }));
  resume = vi.fn(async () => {
    this.state = 'running';
    this.onstatechange?.();
  });
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createBufferSource = vi.fn(() => {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  });
  createOscillator = vi.fn(() => ({
    ...new FakeSource(),
    type: 'sine',
    frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
  }));
  constructor() {
    FakeContext.instances.push(this);
  }
}

let sound: SoundManager;
let documentEvents: EventTarget;
let failingFiles: Set<string>;
const context = () => FakeContext.instances[0]!;
const sources = (file: string) =>
  context().sources.filter((source) => source.buffer?.name.endsWith(file));
const ready = () => vi.waitFor(() => expect(sound.getMusicState()).toBe('blocked'));

beforeEach(() => {
  FakeContext.instances = [];
  documentEvents = new EventTarget();
  failingFiles = new Set();
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: !failingFiles.has(url),
      status: failingFiles.has(url) ? 404 : 200,
      arrayBuffer: async () => new TextEncoder().encode(url).buffer,
    })),
  );
});
afterEach(() => {
  sound?.dispose();
  vi.unstubAllGlobals();
});

describe('shared mobile audio', () => {
  it('preloads a Safari compatible music file relative to the deployment and waits for touch release', async () => {
    sound = new SoundManager();
    await ready();
    expect(fetch).toHaveBeenCalledWith(
      `${import.meta.env.BASE_URL}audio/brainiac-maniac.m4a`,
      expect.any(Object),
    );
    expect(context().sources).toHaveLength(0);
    documentEvents.dispatchEvent(new Event('touchend'));
    expect(context().resume).toHaveBeenCalledOnce();
    expect(sound.getMusicState()).toBe('playing');
    expect(sources('brainiac-maniac.m4a')[0]?.loop).toBe(true);
  });

  it('mixes music, footsteps, alarm and all action effects after one activation', async () => {
    sound = new SoundManager();
    await ready();
    sound.setMusic(true);
    sound.setLoop('footsteps', true);
    sound.setLoop('footsteps', true);
    sound.setLoop('alarm', true);
    for (const name of ['hit', 'pick', 'behit', 'box', 'home']) sound.play(name);
    expect(FakeContext.instances).toHaveLength(1);
    expect(context().sources).toHaveLength(8);
    expect(sources('footsteps.wav')).toHaveLength(1);
    expect(sources('brainiac-maniac.m4a')[0]?.stop).not.toHaveBeenCalled();
    sound.setLoop('footsteps', false);
    expect(sources('footsteps.wav')[0]?.stop).toHaveBeenCalledOnce();
    expect(sound.getMusicState()).toBe('playing');
  });

  it('retries denied activation and resumes the same channels after interruption', async () => {
    sound = new SoundManager();
    await ready();
    context().resume.mockRejectedValueOnce(new DOMException('Gesture required', 'NotAllowedError'));
    documentEvents.dispatchEvent(new Event('touchend'));
    await Promise.resolve();
    await Promise.resolve();
    expect(sound.getMusicState()).toBe('blocked');
    documentEvents.dispatchEvent(new Event('click'));
    expect(sound.getMusicState()).toBe('playing');
    context().state = 'suspended';
    documentEvents.dispatchEvent(new Event('WeixinJSBridgeReady'));
    expect(sound.getMusicState()).toBe('playing');
    expect(sources('brainiac-maniac.m4a')).toHaveLength(1);
  });

  it('starts music after loading even when the gesture happened before decoding completed', async () => {
    sound = new SoundManager();
    sound.setMusic(true);
    expect(context().resume).toHaveBeenCalledOnce();
    expect(sound.getMusicState()).toBe('loading');
    await vi.waitFor(() => expect(sound.getMusicState()).toBe('playing'));
  });

  it('does not restart stopped music when a deferred decode completes or another gesture arrives', async () => {
    sound = new SoundManager();
    sound.setMusic(true);
    sound.setMusic(false);
    await vi.waitFor(() => expect(context().decodeAudioData).toHaveBeenCalledTimes(8));
    documentEvents.dispatchEvent(new Event('click'));
    expect(sources('brainiac-maniac.m4a')).toHaveLength(0);
    expect(sound.getMusicState()).toBe('stopped');
    sound.setMusic(true);
    await vi.waitFor(() => expect(sound.getMusicState()).toBe('playing'));
  });

  it('reports music loading failures and retries on a later gesture', async () => {
    failingFiles.add(`${import.meta.env.BASE_URL}audio/brainiac-maniac.m4a`);
    sound = new SoundManager();
    await vi.waitFor(() => expect(sound.getMusicState()).toBe('error'));
    failingFiles.clear();
    documentEvents.dispatchEvent(new Event('click'));
    await vi.waitFor(() => expect(sound.getMusicState()).toBe('playing'));
  });

  it('routes the cry through the same volume control and closes all audio on disposal', async () => {
    sound = new SoundManager();
    await ready();
    sound.setMusic(true);
    sound.setSettings({ volume: 0.3 });
    sound.playHugCry();
    expect(context().gains[0]?.gain.value).toBe(0.3);
    expect(context().createOscillator).toHaveBeenCalledOnce();
    const cry = context().createOscillator.mock.results[0]!.value;
    expect(cry.connect).toHaveBeenCalledWith(context().gains[1]);
    expect(context().gains[1]?.connect).toHaveBeenCalledWith(context().gains[0]);
    sound.dispose();
    sound.dispose();
    const attempts = context().resume.mock.calls.length;
    documentEvents.dispatchEvent(new Event('click'));
    expect(context().resume).toHaveBeenCalledTimes(attempts);
    expect(context().close).toHaveBeenCalledOnce();
    expect(sources('brainiac-maniac.m4a')[0]?.stop).toHaveBeenCalledOnce();
  });

  it('retains playback in browsers without Web Audio', () => {
    const players: Array<{ src: string; paused: boolean; play: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal('window', {});
    vi.stubGlobal(
      'Audio',
      class {
        paused = true;
        play = vi.fn(async () => {
          this.paused = false;
        });
        pause = vi.fn();
        constructor(readonly src: string) {
          players.push(this);
        }
      },
    );
    sound = new SoundManager();
    documentEvents.dispatchEvent(new Event('click'));
    expect(sound.getMusicState()).toBe('playing');
    sound.play('pick');
    expect(players.find((player) => player.src.endsWith('pick.wav'))?.play).toHaveBeenCalledOnce();
  });
});
