import { ITEM_DEFINITIONS, PURCHASE_ITEM_IDS, WAREHOUSE_CAPACITY } from '../../config/game-config';
import type { ItemInstance } from '../../shared/types/game';
import { assetUrl } from '../../app/asset-url';
import { warehouseItemIconAssetPath } from './warehouse-items';

export const SHOP_EFFECTS: Readonly<Record<string, string>> = {
  bandage: '恢复 10 点生命；满血时不会消耗。',
  'yellow-bike': '移动速度提升 30%，持续 5 秒。',
  'thick-down-jacket': '获得 30 点护盾，持续 5 秒。',
  'folding-ruler': '伤害 20；攻击间隔 0.3 秒；攻击范围较宽；耐久无限。',
  'long-broom': '伤害 22；攻击距离 105；攻击间隔 0.65 秒；耐久无限。',
  'window-breaker': '伤害 55；攻击间隔 0.85 秒；攻击范围较窄；耐久无限。',
  'night-watch-spear': '伤害 70；攻击距离 150；攻击间隔 0.95 秒；耐久无限。',
  'roller-skates': '移动速度提升 15%，持续 5 秒。',
  'electric-bike-helmet': '获得 15 点护盾，持续 5 秒。',
  'quick-note-card': '下一次搜索读条时间缩短 1 秒，使用后消耗。',
  'simple-detector': '显示最近一个未调查物资箱的方向，持续 8 秒，使用后消耗。',
  'star-compass': '同时指向最近主线调查点与南侧撤离点，持续 30 秒，使用后消耗。',
  'silent-cloak': '降低敌人发现范围，持续 8 秒；攻击或受伤会提前结束，使用后消耗。',
  'reflective-filter': '手电照射范围提升 20%，持续本局，使用后消耗。',
};

export function shopMarkup(): string {
  return `<section class="lobby-panel lobby-panel-wide v19-subpage shop-panel" data-lobby-panel="shop" hidden aria-labelledby="shop-title">
    <button class="v19-back-button" type="button" data-lobby-tab="prepare">返回大厅</button>
    <div class="lobby-panel-heading"><div><p class="prep-kicker">行动补给</p><h2 id="shop-title">道具商店</h2></div>
      <span class="shop-wallet">余额 <span class="currency-display"><img src="${assetUrl('assets/ui/jiaozi.png')}" alt="" /><b id="shop-balance">0</b></span></span></div>
    <p class="lobby-panel-intro">重复收藏在成功撤离后自动兑换为交子。购买的道具先存入仓库，在出发准备中勾选带入，再从局内背包使用。</p>
    <p id="shop-status" class="shop-status" role="status" aria-live="polite">选择需要的行动补给。</p>
    <div class="shop-grid">${PURCHASE_ITEM_IDS.map((itemId) => {
      const item = ITEM_DEFINITIONS[itemId]!;
      const iconPath = warehouseItemIconAssetPath(itemId);
      return `<article class="shop-card" data-shop-item="${itemId}">
        <div class="shop-card-meta"><span class="shop-category">${item.kind === 'healing' ? '恢复道具' : item.kind === 'weapon' ? '武器装备' : '辅助道具'}</span><span class="shop-slots">占 ${item.bagSlots ?? 1} 格</span></div>
        <div class="shop-item-art" aria-hidden="true">${iconPath ? `<img src="${assetUrl(iconPath.slice(1))}" alt="" decoding="async" draggable="false" />` : ''}</div>
        <h3>${item.name}</h3><p>${SHOP_EFFECTS[itemId]}</p>
        <div class="shop-stock">仓库持有 <b data-shop-stock>0</b> 件</div>
        <div class="shop-card-footer"><strong class="shop-price"><img src="${assetUrl('assets/ui/jiaozi.png')}" alt="" />${item.price} <small>交子</small></strong>
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
  const full = warehouse.length >= WAREHOUSE_CAPACITY;
  for (const card of root.querySelectorAll<HTMLElement>('[data-shop-item]')) {
    const itemId = card.dataset.shopItem!;
    const price = ITEM_DEFINITIONS[itemId]!.price!;
    card.querySelector('[data-shop-stock]')!.textContent = String(
      warehouse.filter((item) => item.itemId === itemId).length,
    );
    const button = card.querySelector<HTMLButtonElement>('[data-shop-buy]')!;
    button.disabled = buying !== null || !available || currency < price || full;
    button.textContent =
      buying === itemId
        ? '正在购买…'
        : !available
          ? '准备时购买'
          : full
            ? '仓库已满'
            : currency < price
              ? `还差 ${price - currency} 交子`
              : '购买';
  }
}
