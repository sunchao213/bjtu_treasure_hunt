import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CANVAS, FONT_FAMILY, SEMANTIC, UI_TOKENS, hex } from '../../src/shared/tokens';

const css = readFileSync(new URL('../../src/tokens.css', import.meta.url), 'utf8');

/** kebab-case → camelCase，与 tokens.ts 的键名规则保持一致（`--space-1` → `space1`）。 */
const toCamel = (name: string): string =>
  name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** camelCase → kebab-case。数字前也补横线，否则 `space1` 无法还原成 `space-1`。 */
const toKebab = (key: string): string => key.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase();

/** 去掉引号、压缩空白，让 'A', 'B' 与 "A","B" 视为同一串。 */
const normalizeText = (value: string): string =>
  value.replace(/['"]/g, '').replace(/\s+/g, ' ').trim();

/** 把 CSS 声明值解析成可比较的形态：色值转整数，带 px 转数字，纯数字转数字，其余按文本比。 */
const parseCssValue = (raw: string): number | string => {
  const value = raw.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) {
    const body = value.slice(1);
    // #rgb → #rrggbb，长度 6 直接转，长度 8 取前 6 位忽略 alpha（令牌未使用 alpha）。
    if (body.length === 3) {
      return parseInt(
        body
          .split('')
          .map((c) => c + c)
          .join(''),
        16,
      );
    }
    return parseInt(body.slice(0, 6), 16);
  }
  if (/^-?\d+(\.\d+)?(px)?$/.test(value)) {
    return Number.parseFloat(value);
  }
  return normalizeText(value);
};

const cssVars = new Map<string, string>();
for (const match of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
  const name = match[1];
  const value = match[2];
  if (name !== undefined && value !== undefined) {
    cssVars.set(name, value.trim());
  }
}

const numericTokens = UI_TOKENS as unknown as Record<string, number>;
const textTokens = FONT_FAMILY as unknown as Record<string, string>;

/**
 * 只在 CSS 侧成立、canvas 无法表达的令牌：复合阴影值（box-shadow 无整数形态）。
 * 新增这类令牌时请同步这份清单，否则「遗漏检查」会报出来——这是有意的。
 */
const CSS_ONLY = new Set(['shadow-raised', 'shadow-modal', 'glow-gold']);

const resolveCanvas = (path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], CANVAS);

describe('tokens.ts 与 tokens.css 对齐（V1.0 冻结）', () => {
  it('tokens.css 能被解析出变量', () => {
    expect(cssVars.size).toBeGreaterThan(60);
  });

  it('每个 TS 令牌都能在 tokens.css 找到同名变量，且取值完全相等', () => {
    const mismatches: string[] = [];

    for (const [key, expected] of Object.entries(numericTokens)) {
      const cssName = toKebab(key);
      const raw = cssVars.get(cssName);
      if (raw === undefined) {
        mismatches.push(`--${cssName} 在 tokens.css 中不存在（TS 键 ${key}）`);
        continue;
      }
      const actual = parseCssValue(raw);
      if (actual !== expected) {
        mismatches.push(`--${cssName}: CSS=${String(actual)} / TS=${String(expected)}`);
      }
    }

    for (const [key, expected] of Object.entries(textTokens)) {
      const cssName = toKebab(key);
      const raw = cssVars.get(cssName);
      if (raw === undefined) {
        mismatches.push(`--${cssName} 在 tokens.css 中不存在（TS 键 ${key}）`);
        continue;
      }
      if (normalizeText(raw) !== normalizeText(expected)) {
        mismatches.push(`--${cssName}: CSS=${normalizeText(raw)} / TS=${normalizeText(expected)}`);
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('tokens.css 里的变量没有一个是 TS 侧遗漏的', () => {
    const declared = new Set<string>();
    for (const key of Object.keys(numericTokens)) declared.add(toKebab(key));
    for (const key of Object.keys(textTokens)) declared.add(toKebab(key));

    const orphans = [...cssVars.keys()].filter(
      (name) => !declared.has(name) && !CSS_ONLY.has(name),
    );
    expect(orphans).toEqual([]);
  });

  it('CSS_ONLY 白名单里没有已经失效的条目', () => {
    const stale = [...CSS_ONLY].filter((name) => !cssVars.has(name));
    expect(stale).toEqual([]);
  });

  it('键名双向可逆：camelCase 与 kebab-case 互转不丢字符', () => {
    for (const key of [...Object.keys(numericTokens), ...Object.keys(textTokens)]) {
      expect(toKebab(toCamel(toKebab(key)))).toBe(toKebab(key));
    }
  });
});

describe('hex() · 整数色转 Phaser Text 字符串', () => {
  it('补足 6 位并保持小写', () => {
    expect(hex(0xe6ac48)).toBe('#e6ac48');
    expect(hex(0x0b0f0e)).toBe('#0b0f0e');
    expect(hex(0x000000)).toBe('#000000');
  });

  it('丢弃超出 24 位的高位，不产生 7 位色号', () => {
    expect(hex(0xffe6ac48)).toBe('#e6ac48');
    expect(hex(0xe6ac48)).toHaveLength(7);
  });
});

describe('SEMANTIC 对照表自洽', () => {
  it('声明的 uiToken 名与实测色值一致', () => {
    const problems: string[] = [];
    for (const entry of SEMANTIC) {
      if (entry.uiToken === null) {
        if (entry.ui !== null) problems.push(`${entry.intent}: 没有 uiToken 却给了 ui 色值`);
        continue;
      }
      const value = numericTokens[entry.uiToken];
      if (value === undefined) {
        problems.push(`${entry.intent}: uiToken "${entry.uiToken}" 在 UI_TOKENS 中不存在`);
      } else if (value !== entry.ui) {
        problems.push(
          `${entry.intent}: uiToken "${entry.uiToken}" 实测 ${String(value)} ≠ 表中 ${String(entry.ui)}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('声明的 canvasName 路径与实测色值一致', () => {
    const problems: string[] = [];
    for (const entry of SEMANTIC) {
      if (entry.canvasName === null) {
        if (entry.canvas !== null)
          problems.push(`${entry.intent}: 没有 canvasName 却给了 canvas 色值`);
        continue;
      }
      const value = resolveCanvas(entry.canvasName);
      if (typeof value !== 'number') {
        problems.push(`${entry.intent}: canvasName "${entry.canvasName}" 解析不到数字`);
      } else if (value !== entry.canvas) {
        problems.push(
          `${entry.intent}: canvasName "${entry.canvasName}" 实测 ${String(value)} ≠ 表中 ${String(entry.canvas)}`,
        );
      }
    }
    expect(problems).toEqual([]);
  });

  it('意图名不重复', () => {
    const intents = SEMANTIC.map((entry) => entry.intent);
    expect(new Set(intents).size).toBe(intents.length);
  });
});
