import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { mountShell } from '../../src/modules/ui/reference-shell';

/**
 * 两个容易回退的点：
 *   1. 顶部导航不再提供「商城」入口（按钮已从大厅移除），底部商店仍是道具商店。
 *   2. 子页曾经拿大厅背景图当底，等于半透明地叠在大厅上，设置/商店看着像浮层。
 */
const shell = { innerHTML: '' } as unknown as HTMLElement;
mountShell(shell);
const html = shell.innerHTML;
const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8');

const buttonOf = (needle: string): string => {
  const start = html.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<button', start);
  return html.slice(open, html.indexOf('>', open));
};

describe('大厅子页 · 商城入口与实底', () => {
  it('顶部不再有商城入口', () => {
    expect(html).not.toContain('v19-nav-shop');
    expect(html).not.toContain('data-lobby-tab="mall"');
  });

  it('底部商店仍然是道具商店', () => {
    expect(buttonOf('v19-shop-bottom')).toContain('data-lobby-tab="shop"');
  });

  it('购买和出售共用商店页面', () => {
    expect(html).not.toContain('data-lobby-panel="mall"');
    const shop = html.slice(html.indexOf('data-lobby-panel="shop"'));
    expect(shop).toContain('data-shop-mode="buy" aria-pressed="true"');
    expect(shop).toContain('data-shop-mode="sell" aria-pressed="false"');
    expect(shop).toContain('data-shop-view="sell" hidden');
    expect(buttonOf('data-bp-nav="sell"')).toContain('aria-label="出售"');
  });

  it('子页用实色底，不再复用大厅背景图', () => {
    const block = css.match(/\.v19-subpage\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block).not.toBe('');
    expect(block).not.toContain('lobby-v19-background.png');
    expect(block).toContain('linear-gradient');
  });
});
