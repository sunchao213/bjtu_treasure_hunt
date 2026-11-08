import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { confirmMarkup } from '../../src/modules/ui/confirm-dialog';
import { mountShell } from '../../src/modules/ui/reference-shell';

/**
 * 原生 `confirm()` 会在弹窗标题上显示「127.0.0.1:5173 显示」，
 * 样式完全由浏览器决定，和「固定画框 + 夜巡界面」割裂（用户实测反馈）。
 *
 * 这组断言堵两条回退路：
 *   1. 新写一段逻辑又图省事用回原生 `confirm()` / `alert()`；
 *   2. 弹窗标记被挪出画框或被删掉 id，`bindConfirmDialog()` 直接抛 Missing element。
 */
const shell = { innerHTML: '' } as unknown as HTMLElement;
mountShell(shell);

describe('操作确认弹窗 · markup', () => {
  it('挂在 shell 里，紧挨其他 dialog，能跟着画框一起缩放', () => {
    expect(shell.innerHTML).toContain('<dialog id="confirm-dialog"');
    expect(confirmMarkup()).toContain('class="confirm-dialog"');
  });

  it('标题、正文、两个按钮的 id 齐全，绑定端不会抛 Missing element', () => {
    for (const id of ['confirm-title', 'confirm-message', 'confirm-ok', 'confirm-cancel']) {
      expect(confirmMarkup()).toContain(`id="${id}"`);
    }
  });

  it('用 aria-labelledby / aria-describedby 关联内容，读屏能念出确认内容', () => {
    const html = confirmMarkup();
    expect(html).toContain('aria-labelledby="confirm-title"');
    expect(html).toContain('aria-describedby="confirm-message"');
  });

  it('不预设 danger 配色，语气由调用方按操作风险决定', () => {
    // data-tone 只在 ask() 运行时写入，模板里不该出现固定值
    expect(confirmMarkup()).not.toContain('data-tone=');
  });
});

describe('操作确认弹窗 · 源码里不再用原生 confirm', () => {
  const sources = ['main.ts', 'game.ts', 'modules/ui/confirm-dialog.ts'].map((file) => ({
    file,
    code: readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8'),
  }));

  it.each(sources)('$file 没有裸 confirm() / alert() 调用', ({ code }) => {
    // 去掉注释再查，避免把说明文字里的 confirm() 当成调用
    const withoutComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(withoutComments).not.toMatch(/(^|[^.\w])(?:window\.)?confirm\s*\(/);
    expect(withoutComments).not.toMatch(/(^|[^.\w])(?:window\.)?alert\s*\(/);
  });

  it('游戏入口的四类破坏性操作都改走 ask()', () => {
    const main = sources.find((source) => source.file === 'game.ts')!.code;
    // 清损坏存档、迁移旧存档、退出登录、丢任务物品、放弃探索、清云端存档
    expect(main.match(/confirmDialog\s*\n?\s*\.ask\(/g)?.length).toBe(6);
  });
});
