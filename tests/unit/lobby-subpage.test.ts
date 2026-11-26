import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { mountShell } from '../../src/modules/ui/reference-shell';

/**
 * 两个容易回退的点：
 *   1. 顶部「商城」和图鉴/档案一样是**独立子页**，以前误接到道具商店（shop），
 *      点商城出来的却是补给商店；现在必须落到自己的 mall 面板。
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
  it('顶部商城进的是 mall 面板，不是道具商店', () => {
    expect(buttonOf('v19-nav-shop')).toContain('data-lobby-tab="mall"');
    expect(html).toContain('data-lobby-panel="mall"');
  });

  it('底部商店仍然是道具商店', () => {
    expect(buttonOf('v19-shop-bottom')).toContain('data-lobby-tab="shop"');
  });

  it('子页用实色底，不再复用大厅背景图', () => {
    const block = css.match(/\.v19-subpage\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block).not.toBe('');
    expect(block).not.toContain('lobby-v19-background.png');
    expect(block).toContain('linear-gradient');
  });
});
