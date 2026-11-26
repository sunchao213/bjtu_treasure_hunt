import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameFullscreen } from '../../src/modules/ui/game-fullscreen';

afterEach(() => vi.unstubAllGlobals());

function setup(touch = false) {
  const document = Object.assign(new EventTarget(), {
    fullscreenElement: null as object | null,
    documentElement: { requestFullscreen: vi.fn(async () => {}) },
  });
  document.documentElement.requestFullscreen.mockImplementation(async () => {
    document.fullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
  });
  const keyboard = {
    lock: vi.fn<(keys: string[]) => Promise<void>>(async () => {}),
    unlock: vi.fn(),
  };
  const orientation = { lock: vi.fn(async () => {}) };
  const onExit = vi.fn();
  vi.stubGlobal('document', document);
  vi.stubGlobal('navigator', { keyboard });
  vi.stubGlobal('screen', { orientation });
  vi.stubGlobal('matchMedia', () => ({ matches: touch }));
  const fullscreen = new GameFullscreen(onExit);
  return { document, keyboard, orientation, onExit, fullscreen };
}

describe('game fullscreen and Escape lifecycle', () => {
  it('enters desktop fullscreen before capturing only Escape', async () => {
    const t = setup();
    await t.fullscreen.enter();
    expect(t.document.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(t.keyboard.lock).toHaveBeenCalledExactlyOnceWith(['Escape']);
    expect(t.keyboard.lock.mock.invocationCallOrder[0]).toBeGreaterThan(
      t.document.documentElement.requestFullscreen.mock.invocationCallOrder[0]!,
    );
    expect(t.orientation.lock).not.toHaveBeenCalled();
    t.fullscreen.dispose();
  });

  it('retains mobile landscape controls without capturing the physical Escape key', async () => {
    const t = setup(true);
    await t.fullscreen.enter();
    expect(t.document.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(t.orientation.lock).toHaveBeenCalledWith('landscape');
    expect(t.keyboard.lock).not.toHaveBeenCalled();
    t.fullscreen.dispose();
  });

  it('can lock Escape again for a new raid while already fullscreen', async () => {
    const t = setup();
    await t.fullscreen.enter();
    t.fullscreen.release();
    expect(t.document.fullscreenElement).toBe(t.document.documentElement);
    expect(t.keyboard.unlock).toHaveBeenCalledOnce();
    await t.fullscreen.enter();
    expect(t.document.documentElement.requestFullscreen).toHaveBeenCalledOnce();
    expect(t.keyboard.lock).toHaveBeenCalledTimes(2);
    t.fullscreen.dispose();
  });

  it('returns Escape and pauses once when the player leaves fullscreen', async () => {
    const t = setup();
    await t.fullscreen.enter();
    t.document.fullscreenElement = null;
    t.document.dispatchEvent(new Event('fullscreenchange'));
    t.document.dispatchEvent(new Event('fullscreenchange'));
    expect(t.keyboard.unlock).toHaveBeenCalledOnce();
    expect(t.onExit).toHaveBeenCalledOnce();
    t.fullscreen.dispose();
  });

  it('keeps normal controls available when fullscreen or keyboard permission is denied', async () => {
    const t = setup();
    t.document.documentElement.requestFullscreen.mockRejectedValueOnce(new Error('Denied'));
    await expect(t.fullscreen.enter()).resolves.toBeUndefined();
    expect(t.keyboard.lock).not.toHaveBeenCalled();
    t.keyboard.lock.mockRejectedValueOnce(new Error('Keyboard lock denied'));
    await expect(t.fullscreen.enter()).resolves.toBeUndefined();
    expect(t.document.fullscreenElement).toBe(t.document.documentElement);
    expect(t.onExit).not.toHaveBeenCalled();
    t.fullscreen.dispose();
  });

  it('supports browsers without keyboard lock or fullscreen APIs', async () => {
    const t = setup();
    vi.stubGlobal('navigator', {});
    await expect(t.fullscreen.enter()).resolves.toBeUndefined();
    expect(t.keyboard.lock).not.toHaveBeenCalled();
    t.fullscreen.dispose();
    t.document.fullscreenElement = null;
    Object.assign(t.document.documentElement, { requestFullscreen: undefined });
    const unsupported = new GameFullscreen(t.onExit);
    await expect(unsupported.enter()).resolves.toBeUndefined();
    unsupported.dispose();
  });

  it('does not capture Escape if the raid ends while fullscreen is pending', async () => {
    const t = setup();
    let finish!: () => void;
    t.document.documentElement.requestFullscreen.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const entering = t.fullscreen.enter();
    t.fullscreen.release();
    t.document.fullscreenElement = t.document.documentElement;
    finish();
    await entering;
    expect(t.keyboard.lock).not.toHaveBeenCalled();
    t.fullscreen.dispose();
  });

  it('releases permission that finishes after leaving fullscreen', async () => {
    const t = setup();
    let finish!: () => void;
    t.keyboard.lock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const entering = t.fullscreen.enter();
    await Promise.resolve();
    expect(t.keyboard.lock).toHaveBeenCalledOnce();
    t.document.fullscreenElement = null;
    t.document.dispatchEvent(new Event('fullscreenchange'));
    finish();
    await entering;
    expect(t.keyboard.unlock).toHaveBeenCalledTimes(2);
    t.fullscreen.dispose();
    t.document.dispatchEvent(new Event('fullscreenchange'));
    expect(t.onExit).toHaveBeenCalledOnce();
  });
});
