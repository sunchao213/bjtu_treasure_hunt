import { ITEM_DEFINITIONS, itemValueFor } from '../../config/game-config';
import {
  inventorySection,
  occupiedSlots,
  RAID_INVENTORY_CAPACITIES,
  type InventorySection,
} from '../inventory/inventory-sections';
import type { ItemInstance } from '../../shared/types/game';
import { itemIconSvg } from './codex';

export function raidInventoryMarkup(): string {
  return `<button id="toggle-inventory" class="backpack-button" type="button" aria-label="背包 · Tab" aria-controls="inventory-panel" aria-expanded="false"><img src="/assets/ui/backpack.png" alt="" draggable="false"><kbd>Tab</kbd></button>
    <section id="inventory-panel" class="raid-inventory" aria-label="背包与道具" hidden>
      <div class="inventory-scroll"><div class="inventory-art">
        <img class="inventory-skin" src="/assets/ui/inventory-panel.png" alt="" draggable="false">
        <span id="bag-count" class="slot-count bag-slots"></span><div id="bag-grid" class="item-grid bag-grid" role="group" aria-label="背包 6 格"></div>
        <span id="tools-count" class="slot-count tools-slots"></span><div id="tools-grid" class="item-grid tools-grid" role="group" aria-label="道具 6 格"></div>
      </div></div>
      <div class="inventory-details"><p id="inventory-help">点击物品查看 · 探索继续进行</p><ul id="inventory" class="inventory"></ul></div>
    </section>`;
}

/** Grids are a view of the existing instances; the detail list owns the action handlers. */
export function bindRaidInventory() {
  const panel = document.getElementById('inventory-panel')!;
  const toggle = document.getElementById('toggle-inventory')!;
  let selected: string | null = null;
  const select = (id: string | null) => {
    selected = id;
    panel.querySelectorAll<HTMLElement>('#inventory > li').forEach((li) => {
      li.hidden = li.dataset.instanceId !== id;
    });
    panel.querySelectorAll<HTMLButtonElement>('[data-item-id]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.itemId === id));
    });
    document.getElementById('inventory-help')!.hidden = id !== null;
  };
  const setOpen = (open: boolean) => {
    panel.hidden = !open;
    document.getElementById('app')!.dataset.bagOpen = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) panel.querySelector<HTMLButtonElement>('.item-slot')?.focus({ preventScroll: true });
    if (!open && panel.contains(document.activeElement))
      (toggle as HTMLButtonElement).focus({ preventScroll: true });
  };
  panel.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const actions = [
      ...panel.querySelectorAll<HTMLButtonElement>('#inventory > li:not([hidden]) button'),
    ];
    const actionIndex = actions.indexOf(event.target as HTMLButtonElement);
    if (actionIndex >= 0) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'ArrowUp')
        panel.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
      else
        actions[
          (actionIndex + (event.key === 'ArrowLeft' ? actions.length - 1 : 1)) % actions.length
        ]?.focus();
      return;
    }
    const slots = [...panel.querySelectorAll<HTMLButtonElement>('.item-slot')];
    const index = slots.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const offset =
      event.key === 'ArrowLeft'
        ? -1
        : event.key === 'ArrowRight'
          ? 1
          : event.key === 'ArrowUp'
            ? -3
            : 3;
    slots[(index + offset + slots.length) % slots.length]?.focus();
  });
  return {
    setOpen,
    isOpen: () => !panel.hidden,
    render(items: readonly ItemInstance[]) {
      const focused =
        document.activeElement instanceof HTMLElement
          ? document.activeElement.dataset.itemId
          : undefined;
      for (const section of ['bag', 'tools'] as InventorySection[]) {
        const grid = document.getElementById(`${section}-grid`)!;
        grid.replaceChildren();
        const entries = items.filter((item) => inventorySection(item) === section);
        let used = 0;
        for (const item of entries) {
          const def = ITEM_DEFINITIONS[item.itemId]!;
          const size = def.bagSlots ?? 1;
          for (let part = 0; part < size; part++) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = `item-slot rarity-${def.rarity}${part ? ' slot-continuation' : ''}`;
            button.dataset.itemId = item.instanceId;
            button.setAttribute(
              'aria-label',
              `${def.name}${size > 1 ? ` · 占 ${size} 格` : ''} · ${section === 'tools' ? '带入物，不计分' : `${itemValueFor(def) ?? '待定'} 价值`}`,
            );
            button.title = button.getAttribute('aria-label')!;
            button.innerHTML = part
              ? '<span>占格</span>'
              : `${itemIconSvg(item.itemId)}<small>${def.name}</small>`;
            button.onclick = (event) => {
              select(item.instanceId);
              if (event.detail === 0)
                panel
                  .querySelector<HTMLButtonElement>('#inventory > li:not([hidden]) button')
                  ?.focus({ preventScroll: true });
            };
            grid.append(button);
            used++;
          }
        }
        while (used++ < RAID_INVENTORY_CAPACITIES[section]) {
          const empty = document.createElement('button');
          empty.type = 'button';
          empty.className = 'item-slot empty-slot';
          empty.setAttribute('aria-label', '空格');
          empty.onclick = () => select(null);
          grid.append(empty);
        }
        document.getElementById(section === 'bag' ? 'bag-count' : 'tools-count')!.textContent =
          `${occupiedSlots(items, ITEM_DEFINITIONS, section)} / 6`;
      }
      if (selected && !items.some((item) => item.instanceId === selected)) selected = null;
      select(selected);
      if (focused)
        [...panel.querySelectorAll<HTMLButtonElement>('[data-item-id]')]
          .find((button) => button.dataset.itemId === focused)
          ?.focus({ preventScroll: true });
    },
  };
}
