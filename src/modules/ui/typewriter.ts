/**
 * D · 视觉小说式台词的公共实现：逐字输出 + 长文本自动分段。
 *
 * 序章与剧情弹窗共用同一套「旁白」台词卡（段落标签 + 说话人 + 逐字正文 + 进度），
 * 这里只负责「把台词一段一段打出来」，不关心外面的排版。
 */

export interface StorySegment {
  /** 段落小标签（章节 / 线索名），让玩家知道当前读到哪一段。 */
  readonly label: string;
  /** 说话人；本章为学生第一人称记录，默认旁白。 */
  readonly speaker: string;
  readonly text: string;
}

export const NARRATOR = '旁白';

/** 单段台词的最长字数：超出则按句子继续拆段。 */
const MAX_SEGMENT_CHARS = 56;
/** 打字机逐字输出间隔（毫秒）。 */
const TYPE_INTERVAL = 45;

/** 按中文句末标点切句，保留标点。 */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^。！？]*[。！？]?/g) ?? [];
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** 句末的引号 / 括号：必须跟上一句留在同一段，不能翻到下一段开头。 */
const CLOSING_MARKS = /^[」』）】》〉”’]+/;

/** 把被句号切开的收尾引号并回上一句。 */
function attachClosingMarks(sentences: readonly string[]): string[] {
  const merged: string[] = [];
  for (const sentence of sentences) {
    const marks = sentence.match(CLOSING_MARKS);
    if (merged.length && marks) {
      merged[merged.length - 1] += marks[0];
      const rest = sentence.slice(marks[0].length).trim();
      if (rest) {
        merged.push(rest);
      }
      continue;
    }
    merged.push(sentence);
  }
  return merged;
}

/** 把一段正文按句子聚合成若干不超长的台词段；纯函数，便于测试。 */
export function splitStoryText(text: string, maxChars = MAX_SEGMENT_CHARS): readonly string[] {
  const segments: string[] = [];
  let current = '';
  for (const sentence of attachClosingMarks(splitSentences(text))) {
    if (current && current.length + sentence.length > maxChars) {
      segments.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current) {
    segments.push(current);
  }
  return segments;
}

export function toSegments(label: string, body: string, speaker = NARRATOR): StorySegment[] {
  return splitStoryText(body).map((text) => ({ label, speaker, text }));
}

export interface TypewriterSlots {
  /** 段落小标签（章节 / 线索名）。 */
  readonly label?: HTMLElement | null;
  /** 说话人，渲染为「旁白」。 */
  readonly speaker?: HTMLElement | null;
  /** 逐字打出的正文。 */
  readonly line?: HTMLElement | null;
  /** 进度编号，形如 1 / 4。 */
  readonly progress?: HTMLElement | null;
  /** 右下角提示：点击显示全文 / 点击继续 / 点击结束。 */
  readonly hint?: HTMLElement | null;
}

export interface TypewriterPlayOptions {
  /** 进度编号的起点：序章分两段播放时保持连续编号。 */
  readonly progressOffset?: number;
  /** 进度编号的总数；缺省为 offset + 本段数量。 */
  readonly progressTotal?: number;
  /** 本次播放最后一段的提示文案（序章用它说明点击后是「调查」还是「准备」）。 */
  readonly lastHint?: string;
}

export interface Typewriter {
  /** 从头播放一段台词序列。 */
  play(segments: readonly StorySegment[], options?: TypewriterPlayOptions): void;
  /** 未打完先补全，打完翻段，末段触发 onFinish。 */
  advance(): void;
  /** 停止计时器（切场景 / 暂停时调用）。 */
  stop(): void;
  isTyping(): boolean;
}

export function createTypewriter(slots: TypewriterSlots, onFinish: () => void): Typewriter {
  let segments: readonly StorySegment[] = [];
  let index = 0;
  let typed = 0;
  let progressOffset = 0;
  let progressTotal = 0;
  let lastHint = '点击结束 ▸';
  let timer: number | undefined;

  const chars = (): string[] => Array.from(segments[index]?.text ?? '');

  const stop = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const paint = (): void => {
    if (slots.line) {
      slots.line.textContent = chars().slice(0, typed).join('');
    }
    if (slots.hint) {
      slots.hint.textContent =
        typed < chars().length
          ? '点击显示全文'
          : index + 1 < segments.length
            ? '点击继续 ▸'
            : lastHint;
    }
  };

  const startSegment = (): void => {
    const segment = segments[index];
    if (!segment) {
      return;
    }
    if (slots.label) {
      slots.label.textContent = segment.label;
    }
    if (slots.speaker) {
      slots.speaker.textContent = `「${segment.speaker}」`;
    }
    if (slots.progress) {
      slots.progress.textContent = `${progressOffset + index + 1} / ${progressTotal}`;
    }
    stop();
    typed = 0;
    paint();
    timer = window.setInterval(() => {
      typed += 1;
      paint();
      if (typed >= chars().length) {
        stop();
      }
    }, TYPE_INTERVAL);
  };

  return {
    play(next, options = {}) {
      segments = next;
      index = 0;
      progressOffset = options.progressOffset ?? 0;
      progressTotal = options.progressTotal ?? progressOffset + next.length;
      lastHint = options.lastHint ?? '点击结束 ▸';
      startSegment();
    },
    advance() {
      const total = chars().length;
      if (typed < total) {
        stop();
        typed = total;
        paint();
        return;
      }
      if (index + 1 < segments.length) {
        index += 1;
        startSegment();
        return;
      }
      stop();
      onFinish();
    },
    stop,
    isTyping() {
      return timer !== undefined;
    },
  };
}
