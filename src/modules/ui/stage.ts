/**
 * 桌面端固定画框：按 1280×720 的设计基准整框等比缩放。
 *
 * 端游的做法是「固定设计基准 + 整框缩放」，而不是「窗口变小就重排版」：
 * 任何窗口下看到的都是同一张画面，只是大小不同，页面永不产生滚动条。
 * 触屏端本来就是整屏横屏、且已有一套独立的 `data-touch` 布局，保持原样不进入这套。
 *
 * 尺寸计算与 DOM 操作分开，方便单测直接覆盖边界值。
 */

export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

/** 取宽高两个方向里较小的比例，保证整框完整可见、不裁切。 */
export function fitStage(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  return Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
}

/** 把窗口尺寸换算成 `--stage-scale` 写进根节点；视口为 0 时回落到 1，避免缩小到不可见。 */
export function applyStage(viewportWidth: number, viewportHeight: number): number {
  const scale = fitStage(viewportWidth, viewportHeight);
  document.documentElement.style.setProperty('--stage-scale', String(scale));
  return scale;
}

export function bindStage(onChange: () => void): () => void {
  const sync = () => {
    // 触屏端沿用原有容器自适应，不写死比例。
    if (document.documentElement.dataset.touch === 'true') {
      document.documentElement.style.removeProperty('--stage-scale');
    } else {
      applyStage(innerWidth, innerHeight);
    }
    onChange();
  };
  window.addEventListener('resize', sync);
  window.visualViewport?.addEventListener('resize', sync);
  sync();
  return () => {
    window.removeEventListener('resize', sync);
    window.visualViewport?.removeEventListener('resize', sync);
  };
}
