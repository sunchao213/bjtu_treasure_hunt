import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { mountShell } from '../../src/modules/ui/reference-shell';

/**
 * 大厅左下角「麦克风 / 听筒」只做状态与图标切换（B 方案），不接真实音频。
 * 这组断言堵三条回退路：
 *   1. 把听筒键又接回 `data-lobby-tab="settings"`，点一下图标变了还顺带开设置页；
 *   2. 斜杠素材换成 `background` 简写，被 hover 的底色重置掉，点了没反应；
 *   3. 素材文件被删/改名，CSS 里指向一个 404。
 */
const shell = { innerHTML: '' } as unknown as HTMLElement;
mountShell(shell);
const html = shell.innerHTML;
const css = readFileSync(fileURLToPath(new URL('../../src/style.css', import.meta.url)), 'utf8');
const buttonOf = (id: string): string => {
  const start = html.indexOf(`id="${id}"`);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf('>', start));
};

describe('大厅语音键 · 闭麦/关听筒', () => {
  it('两个按键都带独立 id，默认是开麦、开听筒', () => {
    expect(buttonOf('mobile-sound')).toContain('aria-pressed="true"');
    expect(buttonOf('v19-earpiece')).toContain('aria-pressed="true"');
  });

  it('听筒键不再兼职打开设置页', () => {
    expect(buttonOf('v19-earpiece')).not.toContain('data-lobby-tab');
    expect(html).toContain('data-lobby-tab="settings"'); // 顶部齿轮仍是设置入口
  });

  it('闭麦样式用 background-image，不被 hover 的底色简写覆盖', () => {
    expect(css).toMatch(/\.v19-microphone\.is-off\s*\{[^}]*background-image/);
    expect(css).toMatch(/\.v19-volume\.is-off\s*\{[^}]*background-image/);
  });

  it('两个奶白斜杠素材存在且尺寸与按键一致', () => {
    for (const name of ['mic-off-cream.png', 'volume-off-cream.png']) {
      const url = fileURLToPath(new URL(`../../public/assets/ui/audio/${name}`, import.meta.url));
      expect(existsSync(url), `${name} 缺失`).toBe(true);
      const png = readFileSync(url);
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      expect([width, height], `${name} 尺寸`).toEqual(name.startsWith('mic') ? [73, 87] : [72, 87]);
    }
  });
});
