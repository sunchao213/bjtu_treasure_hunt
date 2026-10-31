import { describe, expect, it } from 'vitest';
import {
  ICON_GRID,
  ICON_STROKE,
  UI_ICONS,
  iconSvg,
  type IconName,
} from '../../src/modules/ui/icons';

/** 单条 path 只允许这些大写指令，不认相对指令（相对指令在 ±24 边界上容易画错）。 */
const ALLOWED_COMMANDS = /^[MLHV CQASTZmlhv cqastz0-9.\-, ]+$/;

const numbersIn = (d: string): number[] =>
  (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map((value) => Number.parseFloat(value));

describe('UI 图标集 · 几何约束', () => {
  it('网格与描边是 24 / 2，改动需重新核对全部几何', () => {
    expect(ICON_GRID).toBe(24);
    expect(ICON_STROKE).toBe(2);
  });

  it('14 个图标，键名唯一且为小写短横线', () => {
    expect(UI_ICONS).toHaveLength(14);
    const names = UI_ICONS.map((icon) => icon.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('每个 d 以 M 开头，只用绝对指令，不出现小写相对指令', () => {
    for (const icon of UI_ICONS) {
      expect(icon.d.startsWith('M'), `${icon.name} 未以 M 开头`).toBe(true);
      expect(ALLOWED_COMMANDS.test(icon.d), `${icon.name} 含非法字符`).toBe(true);
      expect(
        /[mlhv cqastz]/.test(icon.d.replace(/[MLHV CQASTZ]/g, '')),
        `${icon.name} 含相对指令`,
      ).toBe(false);
    }
  });

  it('所有坐标落在 0–24 之内（画到网格外的图标在 16px 下会被裁掉）', () => {
    for (const icon of UI_ICONS) {
      const out = numbersIn(icon.d).filter((value) => value < 0 || value > ICON_GRID);
      expect(out, `${icon.name} 越界：${out.join(', ')}`).toEqual([]);
    }
  });

  it('路径里没有填色、没有颜色值、没有内联样式', () => {
    for (const icon of UI_ICONS) {
      expect(icon.d, `${icon.name} 出现 #`).not.toContain('#');
      expect(icon.d).not.toMatch(/fill|stroke|rgb|hsl|style/i);
    }
  });

  it('中文名不为空，预览页与无障碍标题都用它', () => {
    for (const icon of UI_ICONS) {
      expect(icon.label.trim().length, `${icon.name} 缺中文名`).toBeGreaterThan(0);
    }
  });
});

describe('iconSvg · 输出结构', () => {
  it('默认 20px、装饰性图标（aria-hidden），结构与规范一致', () => {
    const svg = iconSvg('search');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('width="20"');
    expect(svg).toContain('height="20"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).not.toContain('<title>');
  });

  it('传 title 时转为有意义图标：role=img + aria-label + title 元素', () => {
    const svg = iconSvg('extract', { size: 24, title: '撤离' });
    expect(svg).toContain('width="24"');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="撤离"');
    expect(svg).toContain('<title>撤离</title>');
    expect(svg).not.toContain('aria-hidden');
  });

  it('不认识的键名返回空串，不抛错也不输出半个 svg', () => {
    expect(iconSvg('not-exist' as IconName)).toBe('');
  });

  it('svg 标签成对闭合', () => {
    for (const icon of UI_ICONS) {
      const svg = iconSvg(icon.name);
      expect((svg.match(/<svg/g) ?? []).length).toBe(1);
      expect((svg.match(/<\/svg>/g) ?? []).length).toBe(1);
      expect((svg.match(/<path/g) ?? []).length).toBe(1);
    }
  });
});
