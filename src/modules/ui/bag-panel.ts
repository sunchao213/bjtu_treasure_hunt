/**
 * 左侧「随身背包」：仓库界面的另一半，对应 v4 底图 (176,60) 那块 625×820 面板。
 *
 * 数据来源是 `carriedInstances`（本次带入下一局的装备），最多 6 格。
 * 它和仓库面板共用同一份 ItemInstance，所以这里只做展示与点击，
 * 拖拽与「一键放入」的写盘由 game.ts 统一处理。
 */
import { BAG_CAPACITY } from '../../config/game-config';
import type { ItemInstance } from '../../shared/types/game';
import { warehouseItemDetails, warehouseItemIconAssetPath } from './warehouse-items';

const RARITY_KEYS = new Set(['common', 'uncommon', 'epic', 'legendary']);

export function renderBagPanel(root: ParentNode, items: readonly ItemInstance[]): void {
  const grid = root.querySelector<HTMLElement>('[data-bp-bag-grid]');
  if (!grid) return;

  while (grid.children.length < BAG_CAPACITY) {
    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'bp-slot';
    slot.dataset.empty = 'true';
    grid.append(slot);
  }
  while (grid.children.length > BAG_CAPACITY) grid.lastElementChild?.remove();

  for (let index = 0; index < BAG_CAPACITY; index += 1) {
    const slot = grid.children[index] as HTMLButtonElement;
    const item = items[index];
    slot.replaceChildren();
    slot.dataset.bpInstance = item?.instanceId ?? '';
    if (!item) {
      slot.dataset.empty = 'true';
      delete slot.dataset.rarity;
      slot.setAttribute('aria-label', '背包空格');
      slot.disabled = true;
      continue;
    }
    const details = warehouseItemDetails(item.itemId);
    slot.dataset.empty = 'false';
    slot.disabled = false;
    slot.setAttribute('aria-label', details?.name ?? item.itemId);
    if (details && RARITY_KEYS.has(details.rarityKey)) {
      slot.dataset.rarity = details.rarityKey;
    } else {
      delete slot.dataset.rarity;
    }
    const icon = warehouseItemIconAssetPath(item.itemId);
    if (icon) {
      const image = document.createElement('img');
      image.src = icon;
      image.alt = '';
      image.draggable = false;
      slot.append(image);
    }
    const name = document.createElement('span');
    name.className = 'bp-slot-name';
    name.textContent = details?.name ?? item.itemId;
    slot.append(name);
  }

  const load = root.querySelector<HTMLElement>('[data-bp-load]');
  if (load) load.textContent = String(Math.min(items.length, BAG_CAPACITY));

  const putAll = root.querySelector<HTMLButtonElement>('[data-bp-put-all]');
  if (putAll) putAll.disabled = items.length === 0;
}
