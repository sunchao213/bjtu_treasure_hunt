import { describe, expect, it } from 'vitest';
import {
  renderWeaponDurability,
  weaponDurabilityMarkup,
} from '../../src/modules/ui/weapon-durability';

function durabilityPanel() {
  const label = { textContent: '' };
  const progress = {
    max: 100,
    value: 100,
    attributes: new Map<string, string>(),
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    },
  };
  const panel = {
    hidden: true,
    dataset: {} as Record<string, string>,
    querySelector(selector: string) {
      return selector === 'progress' ? progress : label;
    },
  } as unknown as HTMLElement;
  return { panel, label, progress };
}

describe('weapon durability display', () => {
  it('renders remaining uses and low or empty states for finite weapons', () => {
    const { panel, label, progress } = durabilityPanel();

    renderWeaponDurability(panel, true, 'window-breaker', 19);
    expect(panel.hidden).toBe(false);
    expect(panel.dataset.state).toBe('low');
    expect(label.textContent).toBe('破窗锤 · 剩余 19 / 100 次');
    expect(progress.max).toBe(100);
    expect(progress.value).toBe(19);

    renderWeaponDurability(panel, true, 'window-breaker', 0);
    expect(panel.dataset.state).toBe('empty');
    expect(label.textContent).toBe('破窗锤 · 次数已耗尽');
  });

  it('shows broom durability and hides the bar when no weapon is selected', () => {
    const { panel } = durabilityPanel();

    renderWeaponDurability(panel, true, 'long-broom', null);
    expect(panel.hidden).toBe(false);
    renderWeaponDurability(panel, true, null, null);
    expect(panel.hidden).toBe(true);
    expect(weaponDurabilityMarkup('weapon-test')).toContain('aria-label="武器剩余耐久"');
  });
});
