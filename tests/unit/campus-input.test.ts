import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrialControls } from '../../src/campus-3d/input';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const document = new EventTarget();
  vi.stubGlobal('document', document);
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLSelectElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  const canvas = new EventTarget() as EventTarget & HTMLCanvasElement;
  const captures = new Set<number>();
  Object.assign(canvas, {
    focus: vi.fn(),
    clientHeight: 900,
    classList: { add: vi.fn(), remove: vi.fn() },
    setPointerCapture: (id: number) => captures.add(id),
    hasPointerCapture: (id: number) => captures.has(id),
    releasePointerCapture: (id: number) => captures.delete(id),
  });
  const shortcut = vi.fn();
  let cameraOffset = 0;
  const ground = vi.fn((x: number, y: number) => ({ x: x + cameraOffset, y }));
  const camera = {
    enabled: () => true,
    orbit: vi.fn(),
    zoom: vi.fn(),
    reset: vi.fn(),
    move: (point: { x: number; y: number }) => point,
    unlocked: vi.fn(),
  };
  const controls = new TrialControls(canvas, ground, shortcut, camera);
  const send = (target: EventTarget, type: string, values: Record<string, unknown>) => {
    const event = Object.assign(new Event(type, { cancelable: true }), values);
    target.dispatchEvent(event);
    return event;
  };
  return {
    document,
    canvas,
    controls,
    send,
    captures,
    shortcut,
    camera,
    offset: (n: number) => {
      cameraOffset = n;
    },
  };
}

describe('campus camera input lifecycle', () => {
  it('turns on mouse movement without a button and ignores UI, pause and re-entry jumps', () => {
    const t = setup();
    t.send(t.canvas, 'pointermove', { pointerType: 'mouse', clientX: 100, clientY: 100 });
    t.send(t.canvas, 'pointermove', { pointerType: 'mouse', clientX: 130, clientY: 120 });
    expect(t.camera.orbit).toHaveBeenLastCalledWith(30, 20);
    t.camera.enabled = () => false;
    t.send(t.canvas, 'pointermove', { pointerType: 'mouse', clientX: 300, clientY: 200 });
    expect(t.camera.orbit).toHaveBeenCalledOnce();
    t.camera.enabled = () => true;
    t.send(t.canvas, 'pointermove', { pointerType: 'mouse', clientX: 350, clientY: 200 });
    t.send(t.canvas, 'pointermove', { pointerType: 'mouse', clientX: 360, clientY: 200 });
    expect(t.camera.orbit).toHaveBeenLastCalledWith(10, 0);
    t.send(t.canvas, 'pointerleave', {});
    t.send(t.canvas, 'pointermove', { pointerType: 'mouse', clientX: 700, clientY: 500 });
    expect(t.camera.orbit).toHaveBeenCalledTimes(2);
    t.controls.dispose();
  });

  it('uses captured relative movement, pauses on browser release and releases safely for menus', () => {
    const t = setup();
    const doc = t.document as EventTarget & {
      pointerLockElement: unknown;
      exitPointerLock: () => void;
    };
    doc.pointerLockElement = null;
    Object.assign(t.canvas, {
      requestPointerLock: vi.fn(() => {
        doc.pointerLockElement = t.canvas;
        doc.dispatchEvent(new Event('pointerlockchange'));
        return Promise.resolve();
      }),
    });
    doc.exitPointerLock = () => {
      doc.pointerLockElement = null;
      doc.dispatchEvent(new Event('pointerlockchange'));
    };
    t.controls.captureMouse();
    t.send(t.canvas, 'pointermove', {
      pointerType: 'mouse',
      clientX: 400,
      clientY: 400,
      movementX: 526,
      movementY: -378,
    });
    expect(t.camera.orbit).not.toHaveBeenCalled();
    t.send(t.canvas, 'pointermove', {
      pointerType: 'mouse',
      clientX: 400,
      clientY: 400,
      movementX: 12,
      movementY: -7,
    });
    expect(t.camera.orbit).toHaveBeenLastCalledWith(12, -7);
    t.send(t.canvas, 'pointerdown', {
      pointerType: 'mouse',
      button: 0,
      clientX: 400,
      clientY: 400,
    });
    expect(t.controls.read().attack).toBe(true);
    t.send(t.canvas, 'pointerup', { pointerType: 'mouse', button: 0 });
    expect(t.controls.read().attack).toBe(false);
    t.send(t.document, 'keydown', { key: 'q', repeat: false });
    expect(t.controls.read().hug).toBe(true);
    t.controls.clear();
    expect(t.controls.read().hug).toBe(false);
    doc.exitPointerLock();
    expect(t.camera.unlocked).toHaveBeenCalledOnce();
    t.controls.captureMouse();
    t.controls.releaseMouse();
    expect(doc.pointerLockElement).toBeNull();
    expect(t.camera.unlocked).toHaveBeenCalledOnce();
    t.controls.dispose();
  });

  it('dispatches night equipment once per keypress without taking the camera reset key', () => {
    const t = setup();
    for (const key of ['f', 't', 'g']) {
      t.send(t.document, 'keydown', { key, repeat: false });
      t.send(t.document, 'keydown', { key, repeat: true });
    }
    expect(t.shortcut.mock.calls.map(([key]) => key)).toEqual(['f', 't', 'g']);
    t.send(t.document, 'keydown', { key: 'r', repeat: false });
    expect(t.camera.reset).toHaveBeenCalledOnce();
    t.controls.dispose();
  });

  it('prevents Escape from immediately dismissing the pause modal it opens', () => {
    const t = setup();
    const escape = t.send(t.document, 'keydown', { key: 'Escape', repeat: false });
    expect(escape.defaultPrevented).toBe(true);
    expect(t.shortcut).toHaveBeenCalledOnce();
    t.controls.dispose();
    t.send(t.document, 'keydown', { key: 'Escape', repeat: false });
    expect(t.shortcut).toHaveBeenCalledOnce();
  });

  it('reprojects a stationary pointer after camera movement and clears capture on pause', () => {
    const t = setup();
    t.send(t.canvas, 'pointermove', { pointerId: 1, clientX: 100, clientY: 200 });
    expect(t.controls.read().aim).toEqual({ x: 100, y: 200 });
    t.offset(25);
    expect(t.controls.read().aim).toEqual({ x: 125, y: 200 });
    t.send(t.canvas, 'pointerdown', {
      pointerType: 'touch',
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 200,
    });
    expect(t.captures.has(1)).toBe(true);
    t.send(t.canvas, 'pointermove', {
      pointerType: 'touch',
      pointerId: 1,
      clientX: 130,
      clientY: 220,
    });
    expect(t.camera.orbit).toHaveBeenCalledWith(30, 20);
    expect(t.controls.read().aim).toBeUndefined();
    t.controls.clear();
    expect(t.captures.size).toBe(0);
    t.send(t.canvas, 'pointermove', { pointerId: 1, clientX: 200, clientY: 220 });
    expect(t.camera.orbit).toHaveBeenCalledOnce();
    t.controls.dispose();
  });
});
