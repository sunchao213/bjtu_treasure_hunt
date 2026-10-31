/**
 * 交大摸金录 · 视觉令牌（TS 侧，草稿 v0 / 对应 CSS 版 V1.0 冻结）
 *
 * 为什么需要这份文件：
 *   Phaser 读不到 CSS 自定义属性。canvas 里画的所有东西（Graphics / Text / tint）
 *   只能拿 24-bit 整数或 '#rrggbb' 字符串，所以 DOM 那套 `var(--gold)` 在局内是失效的。
 *
 * 本文件的定位：
 *   1. `UI_TOKENS` 是 src/tokens.css 的**逐值镜像**，键名 = CSS 变量名的驼峰写法
 *      （`--bg-void` ↔ `bgVoid`，`--space-1` ↔ `space1`）。**不允许手改出偏差**，
 *      tests/unit/tokens.test.ts 会逐条比对，改一处就红。
 *   2. `CANVAS` 是**现有画面色值的命名化**。取值与当前代码完全一致，
 *      把魔法数字换成令牌**不会改变任何一个像素**——这是可以用肉眼回归验证的。
 *   3. `SEMANTIC` 是两端语义的对照与差异清单，不是调色板，用来回答
 *      「这个红到底该用 UI 的 #D65A4A 还是 canvas 的 #FF5668」。
 *
 * 当前状态：**只定义、未被任何模块 import**。合并方式见
 * docs/delivery/d-visual-tokens.md 第 6 节，替换顺序按「零视觉变化」优先。
 */

/** 24-bit RGB。Phaser 的 fillStyle / setTint / lineStyle 接受这种形态。 */
export type ColorInt = number;

/** '#rrggbb'。Phaser 的 Text style.color 只认字符串，不认整数。 */
export type ColorHex = `#${string}`;

/** 整数色 → Phaser Text 可用的字符串色。等价于 CSS 里的 #RRGGBB。 */
export const hex = (value: ColorInt): ColorHex =>
  `#${(value & 0xffffff).toString(16).padStart(6, '0')}`;

/**
 * src/tokens.css 的逐值镜像（V1.0 冻结版 / 2026-10-31）。
 * 键名规则：kebab-case → camelCase，数字前缀保留（`--space-1` → `space1`）。
 * 颜色存 24-bit 整数，尺寸/字重/层级存纯数字（28 表示 28px）。
 */
export const UI_TOKENS = {
  // ── 底色 6 级 ──
  bgVoid: 0x0b0f0e,
  bgBase: 0x111313,
  bgPanel: 0x171b19,
  bgPanelSoft: 0x1d2320,
  bgPanelDeep: 0x121514,
  bgWarm: 0x241f14,

  // ── 描边 3 级 ──
  lineSubtle: 0x2b322f,
  line: 0x3b403d,
  lineStrong: 0x56625b,

  // ── 文字 5 级 + 禁用 ──
  textStrong: 0xf5f0d3,
  textPrimary: 0xe5e7e6,
  textBody: 0xb7c0b6,
  textSecondary: 0x9da79f,
  textTertiary: 0x8a9a8d,
  textQuiet: 0x7f8c82,
  textDisabled: 0x56625b,

  // ── 主强调：金 ──
  gold: 0xe6ac48,
  goldSoft: 0xeed28e,
  goldWarm: 0xf5e7b3,
  goldDeep: 0xb28c55,

  // ── 次强调：青绿 ──
  jade: 0x9bb967,
  jadeSoft: 0xcfe0c0,
  jadeDeep: 0x234d3e,
  jadeHover: 0x32644d,

  // ── 状态色 ──
  stateWarning: 0xe6ac48,
  stateWarningBg: 0x241f14,
  stateDanger: 0xd65a4a,
  stateDangerBg: 0x2a1613,
  stateSuccess: 0x9bb967,
  stateSuccessBg: 0x16231a,

  // ── 字号 9 档 ──
  fsDisplay: 28,
  fsHeadline: 24,
  fsTitle: 20,
  fsHeading: 16,
  fsBody: 14,
  fsBodySm: 13,
  fsLabel: 12,
  fsCaption: 11,
  fsMicro: 10,

  // ── 行高 4 档 ──
  lhTight: 1.35,
  lhNormal: 1.6,
  lhRelaxed: 1.8,
  lhLoose: 1.9,

  // ── 字重 4 档 ──
  fwRegular: 400,
  fwMedium: 500,
  fwSemibold: 600,
  fwBold: 700,

  // ── 间距 4pt 栅格 9 档 ──
  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 20,
  space6: 24,
  space8: 32,
  space10: 40,
  space12: 48,

  // ── 圆角 4 档 ──
  radiusSm: 4,
  radiusMd: 6,
  radiusLg: 10,
  radiusPill: 999,

  // ── 层级 7 层 ──
  zCanvas: 0,
  zHud: 4,
  zToast: 5,
  zPanel: 10,
  zDrawer: 41,
  zOverlay: 100,
  zModal: 1000,
} as const;

/** 字体族。不引网络字体，只用系统字体，避免首帧抖动。取值须与 tokens.css 一致。 */
export const FONT_FAMILY = {
  fontUi: "'Microsoft YaHei', 'PingFang SC', system-ui, sans-serif",
  fontSerif: "'Songti SC', 'SimSun', serif",
  fontNumeral: "Georgia, 'Songti SC', serif",
} as const;

/**
 * canvas 侧已命名的画面色值。
 *
 * 取值 = 当前 src/config/world-config.ts 与 src/scenes/world-scene.ts 里的真实数字，
 * 一个都没有调整。换成这里的常量是**纯重命名**，画面不会变。
 *
 * 注意：这一组的明度整体高于 UI_TOKENS，是刻意的。canvas 上叠着半透明夜色、
 * 手电光锥和阴影，若直接搬 UI 的深色会糊成一团。所以两端共用「意图」，
 * 不共用「色值」——对照关系见下面的 SEMANTIC。
 */
export const CANVAS = {
  /** 地形：草地、道路、水面、绿化。 */
  terrain: {
    ground: 0x68716d,
    borderLine: 0x72816e,
    track: 0x75685d,
    field: 0x345844,
    fieldLine: 0xb3c0a5,
    treeDeep: 0x335a4c,
    treeLight: 0x53775a,
    garden: 0x3e6148,
    lakeBank: 0x365b57,
    lakeWater: 0x326b70,
    lakeRipple: 0x82b3a3,
    stone: 0x9fa89b,
    buildingShadow: 0x0d2e32,
  },

  /** 建筑立面：按校园功能分族，同一族共用一个色，不做逐楼微调。 */
  building: {
    landmark: 0xa4b3bc,
    library: 0xb1bec4,
    lab: 0xb1b3a1,
    teachingWarm: 0xbb9c87,
    teachingSand: 0xbaab91,
    faculty: 0xb99f90,
    roofBand: 0xb9bf9b,
  },

  /** 角色：玩家与追猎者。玩家偏青，敌人常态偏橙、异变转红。 */
  actor: {
    playerRing: 0x74d2b1,
    playerAura: 0xa9e9d0,
    playerShadow: 0x061f23,
    playerBody: 0xf3e2a7,
    playerOutline: 0xffffff,
    playerHead: 0xffedd2,
    playerBag: 0xc18a48,
    enemyBody: 0xe4ae6b,
    enemyMutated: 0xff4e68,
    enemyShadow: 0x40202b,
  },

  /** 信号：光源、警戒、受击、撤离点、战利品。局内一切「此刻要你看这里」的颜色。 */
  signal: {
    lamp: 0xffd27b,
    torchIdle: 0xf2edbc,
    torchOn: 0xfff3b0,
    torchHurt: 0xfff8c2,
    warn: 0xffb347,
    alertLine: 0xff5269,
    hurtFlash: 0xff5668,
    extractionReadyFill: 0x77d4a8,
    extractionReadyLine: 0x97ecc6,
    extractionIdleFill: 0x667a77,
    extractionIdleLine: 0x738984,
    gateExtraction: 0x8cdeb2,
    gateLandmark: 0xd3c08d,
    gateOutline: 0x17251e,
    lootCommon: 0xffcc7c,
    lootArtifact: 0xc792ff,
    lootPoolCommon: 0x453d2d,
    lootPoolArtifact: 0x4c237c,
    chestHalo: 0xe3bf79,
    chestBody: 0xc99f60,
    chestEdge: 0xffdc96,
    chestSeam: 0x594523,
  },

  /**
   * canvas 内文字。必须是字符串，Phaser Text 不接受整数。
   * 这一组是「画在画布上的 UI」，不受 CSS 令牌控制，所以单独命名。
   *
   * 取值范围仅限 src/scenes/world-scene.ts。codex.ts 与 campus-overview.ts 另有一套
   * '#f4f1df' / '#c4cfc6' 一族，属于待对齐的灰绿缺口，未纳入本组。
   */
  label: {
    worldLabel: '#f2f6ef',
    worldPlate: '#14221e',
    focusLabel: '#ffe3a0',
    monumentText: '#e0d8b9',
    monumentPlate: '#29352f',
    extractionText: '#baf4d4',
    extractionPlate: '#173f32',
    monsterText: '#f4ead6',
    monsterMutatedText: '#ff9d9d',
    monsterHugText: '#b9edba',
    monsterOutline: '#10221b',
    footnote: '#97b1a1',
  },
} as const;

/**
 * 语义对照表：同一个「意思」在 DOM 与 canvas 上分别长什么样。
 *
 * 写法是刻意做成表的——`ui` 一律引用 UI_TOKENS 的实测值，`canvas` 一律引用
 * CANVAS 的实测值，`gap` 写明两端差多少。新增任何交互反馈前先查这张表，
 * 查不到就先补表，不要临时调一个新色号出来。
 *
 * `gap` 为 true 表示两端色值不同（属于设计意图，不是 bug）；
 * `missing` 非 null 表示有一端根本没有这个语义，需要补。
 */
export interface SemanticEntry {
  /** 语义名，用英文，便于在代码里检索。 */
  readonly intent: string;
  /** DOM 侧令牌名（不含 --），没有则为 null。 */
  readonly uiToken: string | null;
  /** DOM 侧实测色值，没有则为 null。 */
  readonly ui: ColorInt | null;
  /** canvas 侧命名，没有则为 null。 */
  readonly canvasName: string | null;
  /** canvas 侧实测色值，没有则为 null。 */
  readonly canvas: ColorInt | null;
  /** 给 C 看的一句话结论。 */
  readonly note: string;
}

export const SEMANTIC: readonly SemanticEntry[] = [
  {
    intent: 'interactable',
    uiToken: 'gold',
    ui: UI_TOKENS.gold,
    canvasName: 'signal.warn',
    canvas: CANVAS.signal.warn,
    note: '可交互/当前焦点。canvas 更亮一档，因为要压过夜色底。',
  },
  {
    intent: 'safe',
    uiToken: 'jade',
    ui: UI_TOKENS.jade,
    canvasName: 'signal.extractionReadyLine',
    canvas: CANVAS.signal.extractionReadyLine,
    note: '安全/达标。canvas 偏薄荷，UI 偏草绿，同一意图的两个明度层。',
  },
  {
    intent: 'danger',
    uiToken: 'stateDanger',
    ui: UI_TOKENS.stateDanger,
    canvasName: 'signal.hurtFlash',
    canvas: CANVAS.signal.hurtFlash,
    note: '受伤/被追/失败。UI 是砖红（4.9:1），canvas 是荧光红（要能穿透光照）。',
  },
  {
    intent: 'artifact',
    uiToken: null,
    ui: null,
    canvasName: 'signal.lootArtifact',
    canvas: CANVAS.signal.lootArtifact,
    note: '秘宝紫。UI 侧没有对应色——战利品品质色仍是硬编码，待补 rarity 语义。',
  },
  {
    intent: 'bodyText',
    uiToken: 'textBody',
    ui: UI_TOKENS.textBody,
    canvasName: null,
    canvas: null,
    note: '长句正文。canvas 手绘 UI（codex / campus-overview）各自用了 #C4CFC6 等近似值，需对齐。',
  },
] as const;
