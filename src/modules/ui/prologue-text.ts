import { toSegments, type StorySegment } from './typewriter';

/**
 * D · 序章文本：剧情稿 v1.1 第 6.2 节「开场任务文本」原文。
 *
 * 原文是一整段，这里按玩法节奏拆成两段：
 * - 草稿纸吹到脚边（调查之前，引导玩家按 E 调查）；
 * - 纸上的字、旧书架的灯与「思源」手记（调查之后，接准备页）。
 * 只是分段，不增删内容；引号统一为「」以匹配其余界面文案。
 */
export const PROLOGUE_OPENING: readonly StorySegment[] = toSegments(
  '序章 · 晚归的路上',
  '那天你只是因为忘记带校园卡，回宿舍比平时晚了一点。图书馆外的路灯忽明忽暗，风把一张草稿纸吹到你的脚边。',
);

export const PROLOGUE_AFTER_PAPER: readonly StorySegment[] = toSegments(
  '序章 · 地图之外',
  '纸上写着一串看不懂的公式，最下面却多了一句话：「别走地图上没有的路。」' +
    '你抬起头，发现图书馆外原本空着的旧书架旁，多出了一盏从没见过的灯。' +
    '灯下夹着半本被水浸过的手记，扉页写着两个字：「思源」。',
);

/** 序章全部旁白，用于进度编号（1 / N）。 */
export const PROLOGUE_SEGMENTS: readonly StorySegment[] = [
  ...PROLOGUE_OPENING,
  ...PROLOGUE_AFTER_PAPER,
];
