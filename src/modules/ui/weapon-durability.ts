import { ITEM_DEFINITIONS } from '../../config/game-config';
import { combatWeaponConfig, type CombatWeaponId } from '../world/night-systems';
import './weapon-durability.css';

export function weaponDurabilityMarkup(id: string): string {
  return `<div id="${id}" class="weapon-durability" hidden>
    <span class="weapon-durability-label" role="status" aria-live="polite"></span>
    <progress max="100" value="100" aria-label="武器剩余耐久"></progress>
  </div>`;
}

export function renderWeaponDurability(
  panel: HTMLElement,
  visible: boolean,
  weaponId: CombatWeaponId | null,
  uses: number | null,
): void {
  const weapon = weaponId ? combatWeaponConfig(weaponId) : null;
  const maxUses = weapon?.maxUses ?? null;
  panel.hidden = !visible || !weaponId || maxUses === null;
  if (panel.hidden || !weaponId || maxUses === null) return;
  const remaining = Math.max(0, Math.min(maxUses, uses ?? maxUses));
  const lowThreshold = Math.max(3, Math.ceil(maxUses * 0.2));
  const name = ITEM_DEFINITIONS[weaponId]!.name;
  panel.dataset.state = remaining === 0 ? 'empty' : remaining <= lowThreshold ? 'low' : 'ready';
  const label = panel.querySelector<HTMLElement>('.weapon-durability-label')!;
  const text =
    remaining === 0 ? `${name} · 次数已耗尽` : `${name} · 剩余 ${remaining} / ${maxUses} 次`;
  if (label.textContent !== text) label.textContent = text;
  const progress = panel.querySelector('progress')!;
  progress.max = maxUses;
  progress.value = remaining;
  progress.setAttribute(
    'aria-valuetext',
    remaining === 0 ? '次数已耗尽' : `剩余 ${remaining} 次，共 ${maxUses} 次`,
  );
}
