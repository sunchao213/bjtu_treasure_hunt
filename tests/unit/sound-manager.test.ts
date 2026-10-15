import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SoundManager } from '../../src/modules/ui/sound-manager';

class FakeAudio {
  static instances: FakeAudio[] = [];
  preload = '';
  loop = false;
  volume = 1;
  currentTime = 0;
  paused = true;
  play = vi.fn(async () => {
    this.paused = false;
  });
  pause = vi.fn(() => {
    this.paused = true;
  });
  constructor(readonly src: string) {
    FakeAudio.instances.push(this);
  }
}

let documentEvents: EventTarget;
let sound: SoundManager;
const music = () => FakeAudio.instances.find((audio) => audio.src.endsWith('brainiac-maniac.m4a'))!;
const settlePlayback = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  FakeAudio.instances = [];
  documentEvents = new EventTarget();
  vi.stubGlobal('document', documentEvents);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal('Audio', FakeAudio);
  sound = new SoundManager();
});
afterEach(() => {
  sound.dispose();
  vi.unstubAllGlobals();
});

describe('mobile background music', () => {
  it('uses the deployment base and a Safari compatible source, then starts on touch release', () => {
    expect(music().src).toBe(`${import.meta.env.BASE_URL}audio/brainiac-maniac.m4a`);
    expect(music().loop).toBe(true);
    expect(music().play).not.toHaveBeenCalled();
    documentEvents.dispatchEvent(new Event('touchend'));
    expect(music().play).toHaveBeenCalledOnce();
  });

  it('retries a rejected activation on the next gesture without overlapping requests', async () => {
    music().play.mockRejectedValueOnce(
      new DOMException('Requires user activation', 'NotAllowedError'),
    );
    documentEvents.dispatchEvent(new Event('touchend'));
    documentEvents.dispatchEvent(new Event('click'));
    expect(music().play).toHaveBeenCalledTimes(1);
    await settlePlayback();
    documentEvents.dispatchEvent(new Event('click'));
    expect(music().play).toHaveBeenCalledTimes(2);
    expect(music().paused).toBe(false);
  });

  it('keeps an explicit stop across later gestures and can start the next raid', async () => {
    documentEvents.dispatchEvent(new Event('click'));
    await settlePlayback();
    sound.setMusic(false);
    documentEvents.dispatchEvent(new Event('pointerup'));
    documentEvents.dispatchEvent(new Event('click'));
    expect(music().paused).toBe(true);
    expect(music().play).toHaveBeenCalledTimes(1);
    sound.setMusic(true);
    expect(music().play).toHaveBeenCalledTimes(2);
  });

  it('removes activation listeners and stops playback on disposal', () => {
    sound.dispose();
    documentEvents.dispatchEvent(new Event('touchend'));
    expect(music().play).not.toHaveBeenCalled();
    expect(music().pause).toHaveBeenCalled();
  });
});
