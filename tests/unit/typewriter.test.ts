import { describe, expect, it } from 'vitest';
import { FIRST_CHAPTER } from '../../src/modules/quests/chapter-content';
import { splitStoryText, toSegments } from '../../src/modules/ui/typewriter';

describe('台词打字机 · splitStoryText 长文本分段', () => {
  it('按句子聚合，且每段不超过上限', () => {
    const segments = splitStoryText(FIRST_CHAPTER.prologue, 56);
    expect(segments.length).toBeGreaterThan(1);
    for (const segment of segments) {
      expect(segment.length).toBeGreaterThan(0);
      expect(segment.length).toBeLessThanOrEqual(56);
    }
  });

  it('分段不丢字：拼回后与原正文一致', () => {
    const text = FIRST_CHAPTER.steps[0]!.stepBody;
    expect(splitStoryText(text, 40).join('')).toBe(text);
  });

  it('单句超长时独占一段，不会被截断', () => {
    const long = `${'字'.repeat(80)}。`;
    expect(splitStoryText(long, 10)).toEqual([long]);
  });

  it('空文本不产生空段', () => {
    expect(splitStoryText('', 20)).toEqual([]);
  });

  it('句末的收尾引号留在上一段，不会单独翻页', () => {
    const segments = splitStoryText('他说：「别走地图上没有的路。」你抬起头，看见了灯。', 20);
    expect(segments.some((segment) => segment.startsWith('」'))).toBe(false);
    expect(segments.some((segment) => segment.endsWith('。」'))).toBe(true);
    expect(segments.join('')).toBe('他说：「别走地图上没有的路。」你抬起头，看见了灯。');
  });
});

describe('台词打字机 · toSegments', () => {
  it('默认说话人为旁白，并带上段落标签', () => {
    const segments = toSegments('线索一 · 测试', '第一句。第二句。');
    expect(segments).toEqual([
      { label: '线索一 · 测试', speaker: '旁白', text: '第一句。第二句。' },
    ]);
  });

  it('可指定说话人', () => {
    const [segment] = toSegments('测试', '内容。', '思源记录册');
    expect(segment!.speaker).toBe('思源记录册');
  });
});
