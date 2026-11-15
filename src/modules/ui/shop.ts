import { ITEM_DEFINITIONS, PURCHASE_ITEM_IDS } from '../../config/game-config';
import type { ItemInstance } from '../../shared/types/game';

export const SHOP_EFFECTS: Readonly<Record<string, string>> = {
  bandage: '恢复 10 点生命；满血时不会消耗。',
  'yellow-bike': '本局移动速度提升 20%；每局使用一次即可。',
  'thick-down-jacket': '获得 5 秒无敌，适合遭遇敌人时使用。',
};

export function shopMarkup(): string {
  return `<section class="lobby-panel lobby-panel-wide" data-lobby-panel="shop" hidden aria-labelledby="shop-title">
    <div class="lobby-panel-heading"><div><p class="prep-kicker">行动补给</p><h2 id="shop-title">道具商店</h2></div>
      <span class="shop-wallet">余额 <b id="shop-balance">0</b> 交子</span></div>
    <p class="lobby-panel-intro">重复收藏在成功撤离后自动兑换为交子。购买的道具先存入仓库，在出发准备中勾选带入，再从局内背包使用。</p>
    <p id="shop-status" class="shop-status" role="status" aria-live="polite">选择需要的行动补给。</p>
    <div class="shop-grid">${PURCHASE_ITEM_IDS.map((itemId) => {
      const item = ITEM_DEFINITIONS[itemId]!;
      return `<article class="shop-card" data-shop-item="${itemId}">
        <span class="shop-category">${item.kind === 'healing' ? '恢复道具' : '辅助道具'} · 占 ${item.bagSlots ?? 1} 格</span>
        <h3>${item.name}</h3><p>${SHOP_EFFECTS[itemId]}</p>
        <div class="shop-stock">仓库持有 <b data-shop-stock>0</b> 件</div>
        <div class="shop-card-footer"><strong>${item.price} <small>交子</small></strong>
          <button type="button" class="primary" data-shop-buy="${itemId}">购买</button></div>
      </article>`;
    }).join('')}</div>
    <button id="shop-prepare" type="button" class="secondary">前往出发准备 · 选择带入道具</button>
  </section>`;
}

export function renderShop(
  root: HTMLElement,
  warehouse: readonly ItemInstance[],
  currency: number,
  buying: string | null,
  available: boolean,
): void {
  root.querySelector('#shop-balance')!.textContent = String(currency);
  for (const card of root.querySelectorAll<HTMLElement>('[data-shop-item]')) {
    const itemId = card.dataset.shopItem!;
    const price = ITEM_DEFINITIONS[itemId]!.price!;
    card.querySelector('[data-shop-stock]')!.textContent = String(
      warehouse.filter((item) => item.itemId === itemId).length,
    );
    const button = card.querySelector<HTMLButtonElement>('[data-shop-buy]')!;
    button.disabled = buying !== null || !available || currency < price;
    button.textContent =
      buying === itemId
        ? '正在购买…'
        : !available
          ? '准备时购买'
          : currency < price
            ? `还差 ${price - currency} 交子`
            : '购买';
  }
}
