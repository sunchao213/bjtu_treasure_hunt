/**
 * 键盘焦点守卫：判断玩家是否正在输入，供 Phaser 与全局快捷键避让。
 *
 * 背景：WorldScene 用 `keyboard.addKey()` 注册了 W/A/S/D/E/Q/L/R/G 等键，Phaser 默认给这些键
 * 开启 capture 并在 window 上 `preventDefault()`，导致这些字母即使焦点在输入框里也打不出来。
 * 所以除了「不响应操作」，还必须在输入期间临时 `clearCaptures()`，失焦后再 `addCapture()`。
 *
 * 实现上用 tagName 做判断而不是 `instanceof`：单元测试跑在 node 环境，没有 DOM 构造器，
 * 而且这样也方便用普通对象构造测试替身。
 */

const NON_TEXT_INPUT_TYPES = new Set([
  'range',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'color',
  'file',
  'image',
  'hidden',
]);

function tagOf(target: Element | null): string {
  const tag = (target as { tagName?: unknown } | null)?.tagName;
  return typeof tag === 'string' ? tag.toUpperCase() : '';
}

/** 文本类输入：可输入文字的 input、textarea 与 contenteditable。 */
export function isTextEntry(target: Element | null): boolean {
  if (!target) return false;
  const tag = tagOf(target);
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type;
    return !NON_TEXT_INPUT_TYPES.has(typeof type === 'string' ? type.toLowerCase() : 'text');
  }
  return (target as HTMLElement).isContentEditable === true;
}

/** 正在填写表单（含下拉选择）：此时游戏的 WASD/E/Q/空格都不应生效。 */
export function isFormFocused(target?: Element | null): boolean {
  const element =
    target !== undefined ? target : typeof document === 'undefined' ? null : document.activeElement;
  if (!element) return false;
  return isTextEntry(element) || tagOf(element) === 'SELECT';
}

export interface TypingGuardHooks {
  /** 焦点进入表单：关闭按键捕获，让字符正常输入。 */
  onStart(): void;
  /** 焦点离开表单：恢复按键捕获。 */
  onEnd(): void;
}

/** 绑定焦点守卫，返回取消订阅函数（场景关闭时调用）。 */
export function createTypingGuard(hooks: TypingGuardHooks): () => void {
  if (typeof document === 'undefined') return () => {};
  let active = isFormFocused();
  const sync = (): void => {
    const next = isFormFocused();
    if (next === active) return;
    active = next;
    if (next) hooks.onStart();
    else hooks.onEnd();
  };
  document.addEventListener('focusin', sync);
  document.addEventListener('focusout', sync);
  if (active) hooks.onStart();
  return () => {
    document.removeEventListener('focusin', sync);
    document.removeEventListener('focusout', sync);
  };
}
