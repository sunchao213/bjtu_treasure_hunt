import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { mountShell } from '../../src/modules/ui/reference-shell';

/**
 * 顶部第七格从「帮助」换成「邮件」，三个点必须同时成立：
 *   1. 邮件键有独立热区 + nav-mail.png，样式和相邻六个图标同一配方；
 *   2. 原来挂在 #open-rules 上的规则弹窗不能失联（局内 HUD 还靠它点开）；
 *   3. 未读角标默认隐藏，等邮件模块写入数字后再显示。
 */
const shell = { innerHTML: '' } as unknown as HTMLElement;
mountShell(shell);
const html = shell.innerHTML;
const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8');
const png = readFileSync(
  fileURLToPath(new URL('../../public/assets/ui/nav-mail.png', import.meta.url)),
);

const buttonOf = (needle: string): string => {
  const start = html.indexOf(needle);
  expect(start).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<button', start);
  return html.slice(open, html.indexOf('>', open));
};

describe('大厅顶部 · 邮件键', () => {
  it('第七格是邮件，落到 mail 面板', () => {
    const button = buttonOf('v19-nav-mail');
    expect(button).toContain('data-lobby-tab="mail"');
    expect(button).toContain('aria-label="邮件"');
    expect(html).toContain('data-lobby-panel="mail"');
  });

  it('帮助图标已让位，不再有 v19-nav-help', () => {
    expect(html).not.toContain('v19-nav-help');
  });

  it('规则入口挪进设置页，局内 HUD 仍点得到 #open-rules', () => {
    expect(html).toContain('id="open-rules"');
    expect(html).toContain('data-lobby-panel="settings"');
  });

  it('未读角标默认隐藏', () => {
    expect(html).toContain('id="mail-unread-badge"');
    expect(html).toMatch(/id="mail-unread-badge"[^>]*hidden/);
  });

  it('热区尺寸与相邻图标一致，用位图铺满', () => {
    const block = css.match(/\.v19-nav-mail\s*\{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('nav-mail.png');
    expect(block).toContain('background-size: 100% 100%');
    expect(block).toContain('width: 84px');
    expect(block).toContain('height: 94px');
  });

  it('位图是 84x94，和热区 1:1', () => {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect([width, height]).toEqual([84, 94]);
  });
});
