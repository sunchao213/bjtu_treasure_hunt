import { COMBAT_RULES } from '../../config/combat-config';
import './weapon-durability.css';

const MAX_USES = COMBAT_RULES.player.attack.weapons.stunBaton.maxUses;

export function weaponDurabilityMarkup(id: string): string {
  return `<div id="${id}" class="weapon-durability" hidden>
    <span class="weapon-durability-label" role="status" aria-live="polite"></span>
    <progress max="${MAX_USES}" value="${MAX_USES}" aria-label="电击器剩余使用次数"></progress>
  </div>`;
}

export function renderWeaponDurability(
  panel: HTMLElement,
  visible: boolean,
  uses: number | null,
): void {
  panel.hidden = !visible;
  if (!visible) return;
  const remaining = Math.max(0, Math.min(MAX_USES, uses ?? MAX_USES));
  panel.dataset.state = remaining === 0 ? 'empty' : remaining <= 3 ? 'low' : 'ready';
  const label = panel.querySelector<HTMLElement>('.weapon-durability-label')!;
  const text =
    remaining === 0 ? '电击器 · 次数已耗尽' : `电击器 · 剩余 ${remaining} / ${MAX_USES} 次`;
  if (label.textContent !== text) label.textContent = text;
  const progress = panel.querySelector('progress')!;
  progress.value = remaining;
  progress.setAttribute(
    'aria-valuetext',
    remaining === 0 ? '次数已耗尽' : `剩余 ${remaining} 次，共 ${MAX_USES} 次`,
  );
}
