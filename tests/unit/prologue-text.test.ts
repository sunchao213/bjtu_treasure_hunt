import { describe, expect, it } from 'vitest';
import {
  PROLOGUE_AFTER_PAPER,
  PROLOGUE_OPENING,
  PROLOGUE_SEGMENTS,
} from '../../src/modules/ui/prologue-text';

/** 剧情稿 v1.1 第 6.2 节原文（引号统一为「」）。 */
const ORIGINAL =
  '那天你只是因为忘记带校园卡，回宿舍比平时晚了一点。图书馆外的路灯忽明忽暗，风把一张草稿纸吹到你的脚边。' +
  '纸上写着一串看不懂的公式，最下面却多了一句话：「别走地图上没有的路。」' +
  '你抬起头，发现图书馆外原本空着的旧书架旁，多出了一盏从没见过的灯。' +
  '灯下夹着半本被水浸过的手记，扉页写着两个字：「思源」。';

describe('序章 · 剧情稿 6.2 原文对齐', () => {
  it('前后两段拼起来就是 6.2 的完整原文，不增删内容', () => {
    expect(PROLOGUE_SEGMENTS.map((segment) => segment.text).join('')).toBe(ORIGINAL);
  });

  it('调查草稿纸之前只讲晚归与那张纸', () => {
    const opening = PROLOGUE_OPENING.map((segment) => segment.text).join('');
    expect(opening).toContain('忘记带校园卡');
    expect(opening).toContain('草稿纸吹到你的脚边');
    expect(opening).not.toContain('思源');
  });

  it('调查之后揭示纸上的字、旧书架的灯与手记署名', () => {
    const after = PROLOGUE_AFTER_PAPER.map((segment) => segment.text).join('');
    expect(after).toContain('别走地图上没有的路');
    expect(after).toContain('一盏从没见过的灯');
    expect(after).toContain('「思源」');
  });

  it('收尾引号不会掉到下一段开头（「别走地图上没有的路。」要完整）', () => {
    for (const segment of PROLOGUE_SEGMENTS) {
      expect(segment.text.startsWith('」')).toBe(false);
    }
    const quoted = PROLOGUE_SEGMENTS.find((segment) => segment.text.includes('别走地图上没有的路'));
    expect(quoted?.text).toContain('别走地图上没有的路。」');
  });

  it('每段都带序章标签与旁白说话人', () => {
    for (const segment of PROLOGUE_SEGMENTS) {
      expect(segment.label.startsWith('序章 · ')).toBe(true);
      expect(segment.speaker).toBe('旁白');
      expect(segment.text.trim().length).toBeGreaterThan(0);
    }
  });
});
