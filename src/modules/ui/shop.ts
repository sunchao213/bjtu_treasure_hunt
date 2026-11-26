import { ITEM_DEFINITIONS, PURCHASE_ITEM_IDS } from '../../config/game-config';
import type { ItemInstance } from '../../shared/types/game';
import { DEFAULT_SKIN_ID, SKIN_DEFINITIONS, type SkinId } from '../save/persistent-save';
import { assetUrl } from '../../app/asset-url';

const wardrobeAssetUrl = (path: string): string => {
  const source = assetUrl(path);
  return typeof document === 'undefined' ? source : new URL(source, document.baseURI).href;
};

export const SHOP_EFFECTS: Readonly<Record<string, string>> = {
  bandage: '恢复 10 点生命；满血时不会消耗。',
  'yellow-bike': '本局移动速度提升 20%；每局使用一次即可。',
  'thick-down-jacket': '获得 5 秒无敌，适合遭遇敌人时使用。',
};

export function shopMarkup(): string {
  const defaultPreview = wardrobeAssetUrl('assets/characters/player/player-idle.png');
  return `<section class="lobby-panel lobby-panel-wide" data-lobby-panel="shop" hidden aria-labelledby="shop-title">
    <div class="lobby-panel-heading shop-heading"><h2 id="shop-title">道具与时装</h2>
      <span class="shop-wallet"><span class="shop-coin" aria-hidden="true"></span><b id="shop-balance">0</b> 交子</span></div>
    <p id="shop-status" class="shop-status" role="status" aria-live="polite"></p>
    <section class="skin-store" aria-labelledby="skin-store-title">
      <div class="skin-store-heading"><h3 id="skin-store-title">时装</h3><p>仅改变外观</p></div>
      <div class="skin-grid">${SKIN_DEFINITIONS.map((skin) => {
        const preview =
          skin.id === DEFAULT_SKIN_ID
            ? defaultPreview
            : wardrobeAssetUrl(`assets/characters/skins/${skin.id}-preview.png`);
        return `<article class="skin-card" data-skin-card="${skin.id}">
          <div class="skin-display"><div class="skin-preview${skin.id === DEFAULT_SKIN_ID ? ' skin-preview-uniform' : ''}" aria-hidden="true" style="--skin-sheet: url('${preview}')"></div></div>
          <div class="skin-card-info"><h4>${skin.name}</h4><span class="skin-price">${skin.price === 0 ? '免费拥有' : `<span class="shop-coin" aria-hidden="true"></span>${skin.price} 交子`}</span>
            <span class="skin-card-state" data-skin-state></span><button class="skin-action" type="button" data-skin-action="${skin.id}"></button></div>
        </article>`;
      }).join('')}</div>
    </section>
    <h3 class="shop-supplies-title">行动补给</h3>
    <p class="lobby-panel-intro">重复收藏在成功撤离后自动兑换为交子。购买的道具先存入仓库，在出发准备中勾选带入，再从局内背包使用。</p>
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

export function renderSkins(
  root: HTMLElement,
  ownedSkinIds: readonly SkinId[],
  equippedSkinId: SkinId,
  buyingSkinId: SkinId | null,
  currency: number,
  available: boolean,
): void {
  for (const skin of SKIN_DEFINITIONS) {
    const card = root.querySelector<HTMLElement>(`[data-skin-card="${skin.id}"]`)!;
    const button = card.querySelector<HTMLButtonElement>('[data-skin-action]')!;
    const state = card.querySelector<HTMLElement>('[data-skin-state]')!;
    const owned = ownedSkinIds.includes(skin.id);
    const equipped = equippedSkinId === skin.id;
    const affordable = currency >= skin.price;
    card.classList.toggle('is-equipped', equipped);
    state.textContent = equipped ? '当前穿着' : owned ? '已拥有' : '';
    button.textContent =
      buyingSkinId === skin.id
        ? '保存中…'
        : equipped
          ? '已穿着'
          : !available
            ? '准备时操作'
            : owned
              ? '装备'
              : affordable
                ? '购买'
                : `还差 ${skin.price - currency} 交子`;
    button.setAttribute('aria-label', `${skin.name} · ${button.textContent}`);
    button.dataset.skinOwned = String(owned);
    button.disabled = buyingSkinId !== null || !available || equipped || (!owned && !affordable);
  }
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
