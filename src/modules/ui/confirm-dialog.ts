/**
 * D · 操作确认弹窗：替代浏览器原生 confirm()。
 *
 * 原生 confirm 会在标题显示「127.0.0.1:5173 显示」，样式完全由浏览器决定，
 * 弹出瞬间和「固定画框 + 夜巡界面」割裂；这里改用与剧情、规则同一套 <dialog>，
 * 在画框内居中，样式跟随 --stage-scale 一起缩放。
 *
 * 使用约定：
 * - 只有「不可逆、会造成损失」的操作才需要确认，普通点击不要滥用；
 * - 默认焦点落在「取消」上，危险操作不给回车误确认的机会；
 * - 关闭途径（Esc / 点遮罩 / 取消）统一走 settle(false)，不会留下未决的 Promise。
 */

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmText?: string;
  readonly cancelText?: string;
  /** danger：确认后会丢物品或清存档，确认键转为警示配色。 */
  readonly tone?: 'normal' | 'danger';
}

export interface ConfirmHandle {
  /** 弹出确认，确定返回 true，取消 / Esc / 点遮罩返回 false。 */
  ask(options: ConfirmOptions): Promise<boolean>;
}

export function confirmMarkup(): string {
  return `
    <dialog id="confirm-dialog" class="confirm-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <div class="confirm-body">
        <p class="confirm-kicker">操作确认</p>
        <h2 id="confirm-title" class="confirm-title"></h2>
        <p id="confirm-message" class="confirm-message"></p>
      </div>
      <div class="confirm-actions">
        <button id="confirm-cancel" class="confirm-cancel" type="button">取消</button>
        <button id="confirm-ok" class="confirm-ok" type="button">确定</button>
      </div>
    </dialog>`;
}

function require<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing element: ${id}`);
  }
  return node as T;
}

export function bindConfirmDialog(): ConfirmHandle {
  const dialog = require<HTMLDialogElement>('confirm-dialog');
  const title = require<HTMLElement>('confirm-title');
  const message = require<HTMLElement>('confirm-message');
  const ok = require<HTMLButtonElement>('confirm-ok');
  const cancel = require<HTMLButtonElement>('confirm-cancel');
  let pending: ((value: boolean) => void) | null = null;

  const settle = (value: boolean): void => {
    if (dialog.open) {
      dialog.close();
    }
    const resolve = pending;
    pending = null;
    resolve?.(value);
  };

  ok.addEventListener('click', () => settle(true));
  cancel.addEventListener('click', () => settle(false));
  // Esc 默认只关弹窗不回话，这里接管成「取消」，避免调用方一直等。
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    settle(false);
  });
  // 点遮罩等于取消；点卡片内部不触发（event.target 是 dialog 本身才算遮罩）。
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      settle(false);
    }
  });

  return {
    ask(options) {
      // 上一个还没答完又弹一次：旧的按取消结束，不留悬挂的 Promise。
      pending?.(false);
      pending = null;
      title.textContent = options.title;
      message.textContent = options.message;
      ok.textContent = options.confirmText ?? '确定';
      cancel.textContent = options.cancelText ?? '取消';
      dialog.dataset.tone = options.tone ?? 'normal';
      if (!dialog.open) {
        dialog.showModal();
      }
      cancel.focus();
      return new Promise<boolean>((resolve) => {
        pending = resolve;
      });
    },
  };
}
