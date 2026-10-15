/** Use the primary input device, not desktop window width, to enable touch UI. */
export const isTouchLayout = (): boolean => matchMedia('(pointer: coarse)').matches;

export function landscapeSize(width: number, height: number, touch: boolean) {
  const rotated = touch && height > width;
  return { width: rotated ? height : width, height: rotated ? width : height, rotated };
}

/** Inverse of the clockwise CSS rotation, shared by both touch joysticks. */
export function localTouchDelta(x: number, y: number, rotated: boolean) {
  return rotated ? { x: y, y: -x } : { x, y };
}

export function bindMobileLayout(app: HTMLElement, onChange: () => void): () => void {
  const root = document.documentElement;
  const query = matchMedia('(pointer: coarse)');
  let previous = '';
  const sync = () => {
    const viewport = window.visualViewport;
    const width = viewport?.width ?? innerWidth;
    const height = viewport?.height ?? innerHeight;
    const size = landscapeSize(width, height, query.matches);
    const signature = `${width}:${height}:${query.matches}:${viewport?.offsetTop}:${viewport?.offsetLeft}`;
    if (signature === previous) return;
    previous = signature;
    root.dataset.touch = String(query.matches);
    root.dataset.rotated = String(size.rotated);
    root.dataset.compact = String(size.height < 350);
    app.dataset.mobile = String(query.matches);
    for (const [name, value] of Object.entries({
      'game-width': size.width,
      'game-height': size.height,
      'view-x': viewport?.offsetLeft ?? 0,
      'view-y': viewport?.offsetTop ?? 0,
    }))
      root.style.setProperty(`--${name}`, `${value}px`);
    onChange();
  };
  window.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('scroll', sync);
  screen.orientation?.addEventListener('change', sync);
  document.addEventListener('fullscreenchange', sync);
  query.addEventListener('change', sync);
  sync();
  return () => {
    window.removeEventListener('resize', sync);
    window.visualViewport?.removeEventListener('resize', sync);
    window.visualViewport?.removeEventListener('scroll', sync);
    screen.orientation?.removeEventListener('change', sync);
    document.removeEventListener('fullscreenchange', sync);
    query.removeEventListener('change', sync);
  };
}

export async function requestLandscape(): Promise<void> {
  if (!isTouchLayout()) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  } catch {
    // iOS and embedded browsers keep using the CSS landscape layout.
  }
  try {
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (direction: string) => Promise<void>;
    };
    await orientation?.lock?.('landscape');
  } catch {
    // Orientation lock is optional; neither failure blocks starting a raid.
  }
}
