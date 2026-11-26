import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { mountShell } from '../../src/modules/ui/reference-shell';

/**
 * 三个队友位的金圈和圈内「+」都已经烘进背景图（11/12/13 队友槽）。
 * 之前 CSS 里还有一段 `.v19-teammate::before { content: '+' }` 用 52px 字符再画一遍，
 * 字符是行内盒、不居中，在最右侧那个 85×84 的大按钮上偏出好几个像素，
 * 看起来就是「加号重影」。这条断言防止有人又把字符加号加回来。
 */
const shell = { innerHTML: '' } as unknown as HTMLElement;
mountShell(shell);
const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8');

describe('大厅队友位 · 加号只由背景图提供', () => {
  it('三个队友位都在，且仍是可点击热区', () => {
    for (const slot of ['one', 'two', 'three']) {
      expect(shell.innerHTML).toContain(`v19-teammate v19-teammate-${slot}`);
    }
  });

  it('不再用 ::before 字符画加号', () => {
    const teammateBlock = css.match(/\.v19-teammate[^{]*\{[^}]*\}/g) ?? [];
    for (const block of teammateBlock) {
      expect(block).not.toContain("content: '+'");
    }
  });
});
