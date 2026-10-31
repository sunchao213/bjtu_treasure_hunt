/**
 * 交大摸金录 · UI 图标集（草稿 v0，未被任何模块 import）
 *
 * 为什么另起一套，而不复用图鉴那 11 个：
 *   图鉴图标是 64×64 网格 + 3px 描边，缩放到 20px 渲染时描边只剩 0.94px——
 *   在暗底上会发灰、边缘糊成一团。图标不是「画好一个尺寸再缩放」，
 *   每个渲染尺寸都要重算描边，行业做法就是分成两类：
 *
 *     图鉴/illustrative 类：64 网格 / 3 描边，渲染 56–96px（保持现状，不动）
 *     UI/functional 类：  24 网格 / 2 描边，渲染 16–32px（本文件新建）
 *
 * 本文件只做第二类。取值规矩：
 *   1. 画布 24×24，可视区域控制在 2–22，四周留 2px 安全边（避免与容器描边相切）。
 *   2. 描边 2px，不缩放描边值；圆头圆角（stroke-linecap/linejoin = round）。
 *   3. 只用 currentColor，禁止写死颜色——图标跟随文字色，不改 CSS 也能适配状态色。
 *   4. 只有描边、没有填充（fill = none）。需要「实心」状态时改 opacity，不另做一套。
 *   5. 一个图标只表达一个动作；表达不了就补文字，不做多义图标。
 *
 * 预览：docs/visual/icon-spec.html（16/20/24/32 四档实渲染对比）。
 */

/** 设计网格边长。所有坐标都在这个坐标系里画。 */
export const ICON_GRID = 24;

/** 描边宽度。与网格绑定：24 格配 2px，视觉重量约等于 64 格配 5.3px。 */
export const ICON_STROKE = 2;

export interface IconDef {
  /** 代码里用的键名，小写短横线。 */
  readonly name: string;
  /** 中文名，用于预览页与无障碍标题。 */
  readonly label: string;
  /** 单条 path 的 d 属性。多段用空格分隔（M… M…），不允许出现 fill。 */
  readonly d: string;
}

/**
 * UI 图标集。14 个，覆盖当前界面需要的动作：
 * 导航（返回/关闭/地图）、状态（手电/声音/全屏）、玩法（移动/搜索/价值/撤离/仓库）、
 * 信息（规则/图鉴/设置）。
 */
export const UI_ICONS: readonly IconDef[] = [
  {
    name: 'close',
    label: '关闭',
    d: 'M7 7L17 17 M17 7L7 17',
  },
  {
    name: 'back',
    label: '返回',
    d: 'M14 5L7 12L14 19 M7 12H20',
  },
  {
    name: 'settings',
    label: '设置',
    d: 'M3 8H21 M3 16H21 M7 5.5H11V10.5H7Z M13 13.5H17V18.5H13Z',
  },
  {
    name: 'help',
    label: '规则与帮助',
    d: 'M3 12A9 9 0 1 0 21 12A9 9 0 1 0 3 12 M9 9A3 3 0 1 1 12 12.2V13.8 M12 17.2V17.6',
  },
  {
    name: 'map',
    label: '校园地图',
    d: 'M3 6L9 4L15 6L21 4V18L15 20L9 18L3 20Z M9 4V18 M15 6V20',
  },
  {
    name: 'warehouse',
    label: '仓库',
    d: 'M4 8L12 4L20 8V16L12 20L4 16Z M4 8L12 12L20 8 M12 12V20',
  },
  {
    name: 'flashlight',
    label: '手电',
    d: 'M8 4H16V9L14 11V20H10V11L8 9Z M10 15H14',
  },
  {
    name: 'search',
    label: '搜索',
    d: 'M4 10.5A6.5 6.5 0 1 0 17 10.5A6.5 6.5 0 1 0 4 10.5 M15.5 15.5L20 20',
  },
  {
    name: 'extract',
    label: '撤离',
    d: 'M14 4H6V20H14 M13 12H21 M18 9L21 12L18 15',
  },
  {
    name: 'move',
    label: '移动',
    d: 'M12 3V21 M3 12H21 M9 6L12 3L15 6 M9 18L12 21L15 18 M6 9L3 12L6 15 M18 9L21 12L18 15',
  },
  {
    name: 'value',
    label: '价值',
    d: 'M12 3L20 9L12 21L4 9Z M4 9H20 M12 3L8 9L12 21 M12 3L16 9L12 21',
  },
  {
    name: 'codex',
    label: '图鉴',
    d: 'M12 6C10 4 6 4 4 5V19C6 18 10 18 12 20 M12 6C14 4 18 4 20 5V19C18 18 14 18 12 20 M12 6V20',
  },
  {
    name: 'sound',
    label: '声音',
    d: 'M4 9H8L13 5V19L8 15H4Z M16 9A4 4 0 0 1 16 15',
  },
  {
    name: 'fullscreen',
    label: '全屏',
    d: 'M4 9V4H9 M15 4H20V9 M20 15V20H15 M9 20H4V15',
  },
];

/** 合法键名。写错名字时在编译期就报，不用等运行时发现少了个图标。 */
export type IconName = (typeof UI_ICONS)[number]['name'];

const BY_NAME = new Map<string, IconDef>(UI_ICONS.map((icon) => [icon.name, icon]));

export interface IconSvgOptions {
  /** 渲染边长（px）。建议落在 16 / 20 / 24 / 32 四档，别用 18、22 这种中间值。 */
  readonly size?: number;
  /**
   * 无障碍标题。传了就输出 role="img" + <title>，作为有意义图标；
   * 不传则视为装饰（aria-hidden），由旁边的文字承担语义。
   */
  readonly title?: string;
}

/**
 * 生成内联 SVG 字符串。
 *
 * 用字符串而不是 DOM API，是因为现有 UI 都是拼 innerHTML（reference-shell / quest-view），
 * 保持一致能直接嵌进去；后续若改成组件化，这个函数可以整体替换，调用点不用动。
 */
export const iconSvg = (name: IconName, options: IconSvgOptions = {}): string => {
  const icon = BY_NAME.get(name);
  if (!icon) {
    return '';
  }
  const size = options.size ?? 20;
  const a11y = options.title ? ` role="img" aria-label="${options.title}"` : ' aria-hidden="true"';
  const title = options.title ? `<title>${options.title}</title>` : '';
  return (
    `<svg viewBox="0 0 ${ICON_GRID} ${ICON_GRID}" width="${size}" height="${size}"` +
    ` fill="none" stroke="currentColor" stroke-width="${ICON_STROKE}"` +
    ` stroke-linecap="round" stroke-linejoin="round"${a11y}>${title}` +
    `<path d="${icon.d}"/></svg>`
  );
};
