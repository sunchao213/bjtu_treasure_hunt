import type { ItemInstance } from '../../shared/types/game';
import { ITEM_DEFINITIONS } from '../../config/game-config';
import { HOTBAR_SIZE, type RaidHotbar } from '../inventory/raid-hotbar';
import { itemIconSvg } from './codex';
import { renderWeaponDurability, weaponDurabilityMarkup } from './weapon-durability';
import { isTouchLayout } from './mobile-layout';

export function raidHotbarMarkup(): string {
  return (
    '<section id="raid-hotbar" class="raid-hotbar" aria-label="道具快捷栏" hidden>' +
    weaponDurabilityMarkup('hotbar-weapon-durability') +
    '<p id="hotbar-hint" class="hotbar-hint" role="status" aria-live="polite"></p>' +
    '<div class="hotbar-slots" role="group" aria-label="按 1 到 4 切换道具">' +
    Array.from(
      { length: HOTBAR_SIZE },
      (_, i) =>
        '<button type="button" class="hotbar-slot" data-hotbar-slot="' +
        i +
        '" aria-keyshortcuts="' +
        (i + 1) +
        '" aria-pressed="false">' +
        '<kbd>' +
        (i + 1) +
        '</kbd><span class="hotbar-icon" aria-hidden="true"></span>' +
        '<span class="hotbar-empty">空</span></button>',
    ).join('') +
    '</div></section>'
  );
}

export function bindRaidHotbar(select: (index: number) => void) {
  const panel = document.getElementById('raid-hotbar')!;
  const hint = document.getElementById('hotbar-hint')!;
  const durability = document.getElementById('hotbar-weapon-durability')!;
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[data-hotbar-slot]')];
  for (const [index, button] of buttons.entries()) button.onclick = () => select(index);
  return {
    render(
      hotbar: RaidHotbar,
      active: boolean,
      blocked: boolean,
      assigningItem: ItemInstance | null = null,
      stunBatonUses: number | null = null,
    ): void {
      panel.hidden = !active;
      panel.dataset.assigning = String(assigningItem !== null);
      const slots = hotbar.slots();
      renderWeaponDurability(
        durability,
        active && slots.some((slot) => slot.itemId === 'stun-baton'),
        stunBatonUses,
      );
      for (const [index, slot] of slots.entries()) {
        const button = buttons[index]!;
        const definition = slot.itemId ? ITEM_DEFINITIONS[slot.itemId] : undefined;
        const name = definition?.name ?? '空手';
        if (button.dataset.itemId !== (slot.itemId ?? '')) {
          button.dataset.itemId = slot.itemId ?? '';
          button.querySelector('.hotbar-icon')!.innerHTML = slot.itemId
            ? itemIconSvg(slot.itemId)
            : '';
        }
        button.dataset.instanceId = slot.instanceId ?? '';
        button.disabled = blocked || !active;
        button.setAttribute('aria-pressed', String(index === hotbar.selectedIndex));
        button.setAttribute('aria-label', index + 1 + ' 号格：' + name);
        if (assigningItem) {
          const assigningName =
            ITEM_DEFINITIONS[assigningItem.itemId]?.name ?? assigningItem.itemId;
          button.setAttribute(
            'aria-label',
            '将' + assigningName + '放入 ' + (index + 1) + ' 号格，替换' + name,
          );
          button.title = '将' + assigningName + '放入 ' + (index + 1) + ' 号格';
        } else button.title = index + 1 + ' · ' + name;
        button.querySelector<HTMLElement>('.hotbar-empty')!.hidden = slot.itemId !== null;
      }
      const selected = slots[hotbar.selectedIndex]!;
      const definition = selected.itemId ? ITEM_DEFINITIONS[selected.itemId] : undefined;
      const text = !selected.itemId
        ? '空手 · 1–4 切换道具'
        : selected.itemId === 'stun-baton' && stunBatonUses === 0
          ? '电击器 · 次数已耗尽，请切换道具'
          : (definition?.name ?? '') +
            ' · ' +
            (isTouchLayout()
              ? '点击右侧使用按钮'
              : definition?.kind === 'weapon'
                ? '左键 / 空格 攻击'
                : '左键 / 空格 使用');
      const hintText = assigningItem
        ? '放入' + (ITEM_DEFINITIONS[assigningItem.itemId]?.name ?? '') + '：点击格子 / 按数字'
        : text;
      if (hint.textContent !== hintText) hint.textContent = hintText;
    },
  };
}
