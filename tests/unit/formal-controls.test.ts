import { afterEach, describe, expect, it, vi } from 'vitest';
import { FormalControls } from '../../src/modules/world/formal-controls';
import type { CampusView } from '../../src/campus-3d/view';
import type { TouchControls } from '../../src/modules/world/touch-controls';

afterEach(() => vi.unstubAllGlobals());
function setup() {
  const document = Object.assign(new EventTarget(), {
    activeElement: null as null | { closest: () => object | null },
    documentElement: { dataset: { rotated: 'false' } },
    pointerLockElement: null as null | EventTarget,
    exitPointerLock: () => {
      document.pointerLockElement = null;
      document.dispatchEvent(new Event('pointerlockchange'));
    },
  });
  const canvas = Object.assign(new EventTarget(), {
    focus: vi.fn(),
    setPointerCapture: vi.fn(),
    requestPointerLock: () => {
      document.pointerLockElement = canvas;
      document.dispatchEvent(new Event('pointerlockchange'));
      return Promise.resolve();
    },
  });
  vi.stubGlobal('document', document);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const view = {
    renderer: { domElement: canvas },
    canOrbit: () => true,
    movementDirection: (p: { x: number; y: number }) => ({ x: -p.y, y: p.x }),
    cameraAim: () => ({ x: 100, y: 0 }),
    groundPoint: (): { x: number; y: number } | undefined => undefined,
    orbitCamera: vi.fn(),
    zoomCamera: vi.fn(),
    stopCameraLook: vi.fn(),
  };
  let enabled = true;
  const unlocked = vi.fn();
  const touch = { held: () => false, movement: { x: 0, y: 0 }, reset: vi.fn() };
  const controls = new FormalControls(
    view as unknown as CampusView,
    touch as unknown as TouchControls,
    () => enabled,
    unlocked,
  );
  const send = (target: EventTarget, type: string, data: Record<string, unknown>) =>
    target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), data));
  const read = () => controls.read({ x: 0, y: 0 }, 0);
  return {
    document,
    canvas,
    view,
    controls,
    unlocked,
    send,
    read,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
  };
}
describe('formal game controls', () => {
  it('keeps a quick action tap until the next animation frame', () => {
    const t = setup();
    t.send(t.document, 'keydown', { key: ' ' });
    t.send(t.document, 'keyup', { key: ' ' });
    expect(t.read().attack).toBe(true);
    expect(t.read().attack).toBe(false);
    t.controls.dispose();
  });
  it('looks on hover without a click, including server-driven entry, and resets re-entry deltas', () => {
    const t = setup();
    const move = (x: number, y: number) =>
      t.send(t.canvas, 'pointermove', { pointerType: 'mouse', clientX: x, clientY: y });
    move(100, 100);
    move(120, 110);
    expect(t.view.orbitCamera).toHaveBeenLastCalledWith(20, 10);
    t.setEnabled(false);
    move(400, 500);
    t.setEnabled(true);
    move(700, 600);
    expect(t.view.orbitCamera).toHaveBeenCalledOnce();
    move(710, 605);
    expect(t.view.orbitCamera).toHaveBeenLastCalledWith(10, 5);
    t.send(t.canvas, 'pointerleave', {});
    move(30, 40);
    expect(t.view.orbitCamera).toHaveBeenCalledTimes(2);
    t.controls.clear();
    move(500, 600);
    expect(t.view.orbitCamera).toHaveBeenCalledTimes(2);
    t.controls.dispose();
  });
  it('retains hover orbit when the browser denies pointer lock', () => {
    const t = setup();
    vi.spyOn(t.canvas, 'requestPointerLock').mockImplementation(() => {
      throw new Error('Browser capture cooldown');
    });
    t.send(t.canvas, 'pointerdown', {
      pointerType: 'mouse',
      pointerId: 1,
      clientX: 100,
      clientY: 100,
    });
    t.send(t.canvas, 'pointermove', { pointerType: 'mouse', clientX: 100, clientY: 100 });
    t.send(t.canvas, 'pointermove', { pointerId: 1, clientX: 120, clientY: 110 });
    expect(t.view.orbitCamera).toHaveBeenLastCalledWith(20, 10);
    t.send(t.document, 'pointerup', { pointerId: 1 });
    t.send(t.canvas, 'pointermove', { pointerId: 1, clientX: 140, clientY: 120 });
    expect(t.view.orbitCamera).toHaveBeenLastCalledWith(20, 10);
    expect(t.view.orbitCamera).toHaveBeenCalledTimes(2);
    t.controls.dispose();
  });
  it('converts portrait drag into the rotated landscape camera axes', () => {
    const t = setup();
    t.document.documentElement.dataset.rotated = 'true';
    t.send(t.canvas, 'pointerdown', {
      pointerType: 'touch',
      pointerId: 7,
      clientX: 100,
      clientY: 100,
    });
    t.send(t.canvas, 'pointermove', {
      pointerType: 'touch',
      pointerId: 7,
      clientX: 112,
      clientY: 140,
    });
    expect(t.view.orbitCamera).toHaveBeenLastCalledWith(40, -12);
    t.send(t.canvas, 'pointerup', { pointerId: 7 });
    t.send(t.canvas, 'pointermove', {
      pointerType: 'touch',
      pointerId: 7,
      clientX: 140,
      clientY: 170,
    });
    expect(t.view.orbitCamera).toHaveBeenCalledOnce();
    t.controls.dispose();
  });
  it('keeps L/R/G equipment and delegates Tab/Esc exclusively to the shell', () => {
    const t = setup();
    for (const key of ['Tab', 'Escape', 'l', 'r', 'g', 'w']) t.send(t.document, 'keydown', { key });
    expect(t.read()).toMatchObject({
      flashlight: true,
      refill: true,
      flare: true,
      move: { x: 1, y: 0 },
    });
    t.controls.clear();
    expect(t.read().refill).toBe(false);
    t.controls.dispose();
  });
  it('captures at start before input is enabled, preserves capture through raid reset and releases on failure/menu', () => {
    const t = setup();
    t.setEnabled(false);
    t.controls.captureMouse();
    expect(t.document.pointerLockElement).toBe(t.canvas);
    t.controls.clear(true);
    expect(t.document.pointerLockElement).toBe(t.canvas);
    t.setEnabled(true);
    t.controls.clear();
    expect(t.document.pointerLockElement).toBeNull();
    expect(t.unlocked).not.toHaveBeenCalled();
    t.controls.captureMouse();
    expect(t.document.pointerLockElement).toBe(t.canvas);
    t.controls.releaseMouse();
    expect(t.document.pointerLockElement).toBeNull();
    t.controls.dispose();
  });
  it('cancels delayed capture when a menu opens or the controller is disposed', async () => {
    const t = setup();
    let finish!: () => void;
    vi.spyOn(t.canvas, 'requestPointerLock').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            t.document.pointerLockElement = t.canvas;
            t.document.dispatchEvent(new Event('pointerlockchange'));
            resolve();
          };
        }),
    );
    t.controls.captureMouse();
    t.controls.clear();
    finish();
    await Promise.resolve();
    expect(t.document.pointerLockElement).toBeNull();
    t.controls.captureMouse();
    t.controls.dispose();
    finish();
    await Promise.resolve();
    expect(t.document.pointerLockElement).toBeNull();
    expect(t.unlocked).not.toHaveBeenCalled();
  });
  it('uses the camera direction for desktop aim even when capture is denied', async () => {
    const t = setup();
    vi.spyOn(t.canvas, 'requestPointerLock').mockRejectedValue(new Error('Capture denied'));
    t.controls.captureMouse();
    await Promise.resolve();
    t.view.groundPoint = () => ({ x: 0, y: 100 });
    t.send(t.canvas, 'pointermove', { pointerType: 'mouse', clientX: 200, clientY: 150 });
    expect(t.read().aim).toBe(0);
    t.controls.dispose();
  });
  it('ignores typing and hidden/pause surfaces without leaving held movement', () => {
    const t = setup();
    t.document.activeElement = { closest: () => ({}) };
    t.send(t.document, 'keydown', { key: 'w' });
    expect(t.read().move).toEqual({ x: -0, y: 0 });
    t.document.activeElement = null;
    t.send(t.document, 'keydown', { key: 'w' });
    t.setEnabled(false);
    expect(t.read().move).toEqual({ x: -0, y: 0 });
    t.controls.clear();
    t.setEnabled(true);
    expect(t.read().move).toEqual({ x: -0, y: 0 });
    t.controls.dispose();
  });
  it('avoids the first locked delta and opens settings only for an unsuppressed release', async () => {
    const t = setup();
    t.send(t.canvas, 'pointerdown', { pointerType: 'mouse' });
    t.send(t.canvas, 'pointermove', { movementX: 900, movementY: -400 });
    expect(t.view.orbitCamera).not.toHaveBeenCalled();
    t.send(t.canvas, 'pointermove', { movementX: 8, movementY: -3 });
    expect(t.view.orbitCamera).toHaveBeenLastCalledWith(8, -3);
    t.controls.clear();
    expect(t.unlocked).not.toHaveBeenCalled();
    t.send(t.canvas, 'pointerdown', { pointerType: 'mouse' });
    t.document.exitPointerLock();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(t.unlocked).toHaveBeenCalledOnce();
    t.controls.dispose();
  });
  it('lets the shell consume Esc even when the browser releases capture first', async () => {
    const t = setup();
    t.send(t.canvas, 'pointerdown', { pointerType: 'mouse' });
    t.document.exitPointerLock();
    // Same Esc closes the backpack. Shell clears controls for that action.
    t.controls.clear();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(t.unlocked).not.toHaveBeenCalled();
    t.controls.dispose();
  });
  it('clears held movement and attacks when typing begins', () => {
    const t = setup();
    t.send(t.document, 'keydown', { key: 'w' });
    t.send(t.document, 'keydown', { key: ' ' });
    t.document.activeElement = { closest: () => ({}) };
    t.send(t.document, 'focusin', {});
    t.document.activeElement = null;
    expect(t.read()).toMatchObject({ move: { x: -0, y: 0 }, attack: false });
    t.controls.dispose();
  });
});
