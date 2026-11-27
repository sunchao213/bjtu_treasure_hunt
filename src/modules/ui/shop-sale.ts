import { assetUrl } from '../../app/asset-url';
import { warehouseSalePrice } from '../../config/game-config';
import type { ItemInstance } from '../../shared/types/game';
import { warehouseItemDetails, warehouseItemIconSvg } from './warehouse-items';

export function shopSaleMarkup(): string {
  return `<section id="shop-sell-panel" class="shop-content shop-sale" data-shop-view="sell" hidden aria-label="出售仓库物品">
      <p class="shop-sale-hint" id="shop-sell-hint">按物品价值兑换交子。武器不可出售。</p>
      <div id="shop-sell-list" class="shop-grid shop-sell-list" role="group" aria-label="可出售的仓库物品" aria-describedby="shop-sell-hint"></div>
      <footer class="shop-footer shop-sale-footer">
        <p id="shop-sell-status" class="shop-status" role="status"></p>
        <div class="shop-sell-controls">
          <output id="shop-sell-quote" aria-live="polite"></output>
          <button id="shop-sell" class="shop-action" type="button" disabled>确认出售</button>
        </div>
      </footer>
  </section>`;
}

export function bindShopSale(
  root: HTMLElement,
  onSell: (instanceIds: readonly string[], proceeds: number) => void,
) {
  const list = root.querySelector<HTMLElement>('#shop-sell-list')!;
  const quote = root.querySelector<HTMLOutputElement>('#shop-sell-quote')!;
  const sell = root.querySelector<HTMLButtonElement>('#shop-sell')!;
  const selected = new Set<string>();
  let prices = new Map<string, number>();
  let signature = '';
  let available = false;
  let busy = false;

  function proceeds(): number {
    return [...selected].reduce((total, id) => total + (prices.get(id) ?? 0), 0);
  }

  function refreshQuote(): void {
    const label = `已选 ${selected.size} 件 · 可得 ${proceeds()} 交子`;
    if (quote.textContent !== label) quote.textContent = label;
    sell.disabled = !available || busy || selected.size === 0;
    sell.textContent = busy ? '出售处理中…' : '确认出售';
  }

  list.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (!prices.has(input.value)) return;
    if (input.checked) selected.add(input.value);
    else selected.delete(input.value);
    refreshQuote();
  });
  sell.onclick = () => {
    if (!sell.disabled) onSell([...selected], proceeds());
  };

  return {
    render(warehouse: readonly ItemInstance[], canSell: boolean, pending: boolean) {
      available = canSell;
      busy = pending;
      const nextSignature = JSON.stringify(
        warehouse.map(({ instanceId, itemId }) => [instanceId, itemId]),
      );
      if (signature !== nextSignature) {
        signature = nextSignature;
        prices = new Map();
        const rows = document.createDocumentFragment();
        for (const item of warehouse) {
          const price = warehouseSalePrice(item.itemId);
          const details = warehouseItemDetails(item.itemId);
          if (price === null || !details) continue;
          prices.set(item.instanceId, price);
          const card = document.createElement('label');
          card.className = 'shop-card shop-sell-card';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.value = item.instanceId;
          checkbox.checked = selected.has(item.instanceId);
          const art = document.createElement('span');
          art.className = 'shop-item-art wh-slot';
          art.dataset.rarity = details.rarityKey;
          art.innerHTML = warehouseItemIconSvg(item.itemId);
          const name = document.createElement('span');
          name.className = 'wh-slot-name';
          name.textContent = details.name;
          art.append(name);
          const amount = document.createElement('strong');
          amount.className = 'shop-price';
          const coin = document.createElement('img');
          coin.src = assetUrl('assets/ui/jiaozi.png');
          coin.alt = '';
          amount.append(coin, `${price} 交子`);
          card.append(checkbox, art, amount);
          rows.append(card);
        }
        for (const id of selected) if (!prices.has(id)) selected.delete(id);
        if (!prices.size) {
          const empty = document.createElement('p');
          empty.className = 'shop-sale-empty';
          empty.textContent = '仓库暂无可出售的物品。';
          rows.append(empty);
        }
        list.replaceChildren(rows);
      }
      for (const input of list.querySelectorAll('input')) input.disabled = !available || busy;
      refreshQuote();
    },
  };
}
