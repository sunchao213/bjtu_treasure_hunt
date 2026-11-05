import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorldScene } from '../../src/scenes/world-scene';
import { createGame } from '../../src/app/create-game';

const fake = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  const scale = {
    canvas: undefined as object | undefined,
    width: 800,
    height: 400,
    resize: vi.fn(),
  };
  const game = {
    scale,
    events: {
      once: (event: string, callback: () => void) => listeners.set(event, callback),
      off: (event: string) => listeners.delete(event),
    },
  };
  return { game, listeners, configurations: [] as { scale: { width: number; height: number } }[] };
});
vi.mock('phaser', () => ({
  default: {
    AUTO: 0,
    Scale: { NONE: 0 },
    Core: { Events: { READY: 'ready', DESTROY: 'destroy' } },
    Game: class {
      constructor(configuration: { scale: { width: number; height: number } }) {
        fake.configurations.push(configuration);
        return fake.game;
      }
    },
  },
}));
afterEach(() => {
  fake.listeners.clear();
  fake.configurations.length = 0;
  fake.game.scale.canvas = undefined;
  fake.game.scale.resize.mockClear();
  vi.unstubAllGlobals();
});

describe('canvas sizing across game boot', () => {
  it('boots a nonzero renderer even while the lobby hides the map', () => {
    vi.stubGlobal('document', { getElementById: () => ({ clientWidth: 0, clientHeight: 0 }) });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    createGame({} as WorldScene);
    expect(fake.configurations[0]!.scale.width).toBeGreaterThan(0);
    expect(fake.configurations[0]!.scale.height).toBeGreaterThan(0);
  });
  it('defers early observer delivery until the canvas exists, then applies the latest layout', () => {
    const parent = { clientWidth: 844, clientHeight: 210 };
    let notifyResize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('document', { getElementById: () => parent });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notifyResize = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    createGame({} as WorldScene);
    notifyResize();
    expect(fake.game.scale.resize).not.toHaveBeenCalled();
    fake.game.scale.canvas = {};
    fake.listeners.get('ready')?.();
    expect(fake.game.scale.resize).toHaveBeenLastCalledWith(844, 210);
    parent.clientWidth = 568;
    parent.clientHeight = 160;
    notifyResize();
    expect(fake.game.scale.resize).toHaveBeenLastCalledWith(568, 160);
    parent.clientHeight = 0;
    notifyResize();
    expect(fake.game.scale.resize).toHaveBeenCalledTimes(2);
    fake.listeners.get('destroy')?.();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(fake.listeners.has('ready')).toBe(false);
  });
});
