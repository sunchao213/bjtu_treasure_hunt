import { describe, expect, it } from 'vitest';
import { codexMarkup } from '../../src/modules/ui/codex';
import { gameRulesMarkup } from '../../src/modules/ui/game-rules';
import { mountShell } from '../../src/modules/ui/reference-shell';

/**
 * 三处关闭按钮已从字符 `×` 换成 `iconSvg('close')`（CHG-26）。
 *
 * 这组断言堵两条常见回退路：
 *   1. 有人觉得「一个叉号而已」，又写回字符 `×`——基线、粗细、光学大小全跟着字体走；
 *   2. 换图标时把 `aria-label` 删了，或给 SVG 也加 `aria-label`，
 *      导致屏幕阅读器把同一个按钮念两遍。
 *
 * 校园图弹窗在 `mountShell` 里。该函数目前只做 `root.innerHTML = ...`，
 * 所以不必开 jsdom 环境，给个只带 innerHTML 的壳就能取到那段 HTML；
 * 若将来它开始绑定事件，这里会报错，正好提醒重写这段。
 */
const shell = { innerHTML: '' } as unknown as HTMLElement;
mountShell(shell);
const campusMap = (() => {
  const html = shell.innerHTML;
  const start = html.indexOf('<dialog id="campus-map-dialog"');
  const end = html.indexOf('</dialog>', start);
  return start === -1 || end === -1 ? '' : html.slice(start, end + '</dialog>'.length);
})();

const markupCases = [
  { name: '游戏规则弹窗', html: gameRulesMarkup(), label: '关闭游戏规则' },
  { name: '物品图鉴弹窗', html: codexMarkup(), label: '关闭图鉴' },
  { name: '校园图弹窗', html: campusMap, label: '关闭校园图' },
] as const;

describe('关闭按钮 · 图标接入', () => {
  it('校园图弹窗能被抓取到，否则下面的断言会空过', () => {
    expect(campusMap).toContain('close-campus-map');
  });

  it.each(markupCases)('$name 用的是 SVG 图标而不是字符', ({ html }) => {
    expect(html).toContain('<svg');
    expect(html).not.toContain('>×<');
  });

  it.each(markupCases)('$name 的按钮保留 aria-label', ({ html, label }) => {
    expect(html).toContain(`aria-label="${label}"`);
  });

  it.each(markupCases)('$name 的图标对辅助技术隐藏，语义由按钮承担', ({ html }) => {
    expect(html).toContain('aria-hidden="true"');
    // 不允许「按钮 aria-label + svg role=img 自带标题」这种念两遍的组合
    expect(html).not.toMatch(/aria-label="关闭[^"]*"[^>]*>\s*<svg[^>]*role="img"/);
  });

  it('渲染尺寸落在规范允许的档位里', () => {
    for (const { html } of markupCases) {
      // 只认图标自己的 width，别把 canvas width="1200" 或 stroke-width="2" 算进来
      const sizes = [...html.matchAll(/<svg viewBox="0 0 24 24" width="(\d+)"/g)].map((m) =>
        Number(m[1]),
      );
      expect(sizes.length).toBeGreaterThan(0);
      for (const size of sizes) {
        expect([16, 20, 24, 32]).toContain(size);
      }
    }
  });

  it('关闭按钮的尺寸交给样式表，模板里不写内联宽高或字号', () => {
    const buttons = [gameRulesMarkup(), codexMarkup(), campusMap].flatMap((html) => [
      ...html.matchAll(/<button id="close-[^"]*"[^>]*>/g),
    ]);

    expect(buttons.map((m) => m[0])).toHaveLength(3);
    for (const tag of buttons.map((m) => m[0])) {
      // 原来两个 rules-close 靠 font-size:24px + line-height:1 硬凑居中，这类写法不许回来
      expect(tag).not.toMatch(/style="[^"]*(?:width|height|font-size|line-height)/);
    }
    // 规则弹窗与图鉴共用 rules-close；校园图用自己的 dialog 配色，不套这个类
    expect(buttons[0]?.[0]).toContain('class="rules-close"');
    expect(buttons[1]?.[0]).toContain('class="rules-close"');
    expect(buttons[2]?.[0]).toContain('id="close-campus-map"');
  });
});
