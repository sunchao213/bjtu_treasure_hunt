import { describe, expect, it } from 'vitest';
import { isFormFocused, isTextEntry } from '../../src/modules/ui/typing-guard';

/** 用普通对象充当元素：node 环境没有 DOM 构造器，isTextEntry 按 tagName 判断。 */
const element = (tagName: string, extra: Record<string, unknown> = {}): Element =>
  ({ tagName, ...extra }) as unknown as Element;

describe('键盘焦点判断', () => {
  it('文本输入框、文本域与 contenteditable 视为正在输入', () => {
    expect(isTextEntry(element('INPUT', { type: 'text' }))).toBe(true);
    expect(isTextEntry(element('INPUT', { type: 'search' }))).toBe(true);
    expect(isTextEntry(element('TEXTAREA'))).toBe(true);
    expect(isTextEntry(element('DIV', { isContentEditable: true }))).toBe(true);
  });

  it('滑块、勾选框、按钮不算文本输入，局内按键仍然生效', () => {
    expect(isTextEntry(element('INPUT', { type: 'range' }))).toBe(false);
    expect(isTextEntry(element('INPUT', { type: 'checkbox' }))).toBe(false);
    expect(isTextEntry(element('INPUT', { type: 'button' }))).toBe(false);
    expect(isTextEntry(element('BUTTON'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });

  it('下拉框不算文本输入，但仍应让游戏避让', () => {
    const select = element('SELECT');
    expect(isTextEntry(select)).toBe(false);
    expect(isFormFocused(select)).toBe(true);
  });

  it('没有聚焦元素时视为未在输入', () => {
    expect(isFormFocused(null)).toBe(false);
    expect(isFormFocused(element('BODY'))).toBe(false);
  });

  it('聊天与好友 UID 输入框会阻止局内按键', () => {
    expect(isFormFocused(element('INPUT', { type: 'text' }))).toBe(true);
    expect(isFormFocused(element('TEXTAREA'))).toBe(true);
  });
});
