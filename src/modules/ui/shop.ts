import { ITEM_DEFINITIONS, PURCHASE_ITEM_IDS, WAREHOUSE_CAPACITY } from '../../config/game-config';
import type { ItemInstance } from '../../shared/types/game';
import { assetUrl } from '../../app/asset-url';
import { COMBAT_RULES } from '../../config/combat-config';
import { warehouseItemIconAssetPath } from './warehouse-items';
import { shopSaleMarkup } from './shop-sale';
import { DEFAULT_SKIN_ID, SKIN_DEFINITIONS, type SkinId } from '../save/persistent-save';

export function wardrobeMarkup(inShop = false): string {
  return `<div class="skin-grid">${SKIN_DEFINITIONS.filter((skin) => !inShop || skin.price > 0)
    .map((skin) => {
      const uniform = skin.id === DEFAULT_SKIN_ID;
      const image = assetUrl(
        uniform
          ? 'assets/characters/player/player-idle.png'
          : `assets/characters/skins/${skin.id}-preview.png`,
      );
      return `<article class="skin-card">
      <div class="skin-art${uniform ? ' skin-art-uniform' : ''}"><img src="${image}" alt="" loading="lazy"></div>
      <strong>${skin.name}</strong><small>${uniform ? '免费拥有' : `${skin.price} 交子`}</small>
      <button type="button" class="shop-action" data-skin-action="${skin.id}"${inShop ? ' data-skin-shop' : ''}>购买</button>
    </article>`;
    })
    .join('')}</div>`;
}

export function renderWardrobe(
  root: ParentNode,
  owned: readonly SkinId[],
  equipped: SkinId,
  currency: number,
  available: boolean,
): void {
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-skin-action]')) {
    const skin = SKIN_DEFINITIONS.find((entry) => entry.id === button.dataset.skinAction)!;
    const unlocked = owned.includes(skin.id);
    const wearing = equipped === skin.id;
    const inShop = button.hasAttribute('data-skin-shop');
    button.disabled =
      !available || wearing || (inShop && unlocked) || (!unlocked && currency < skin.price);
    button.textContent = wearing
      ? '已穿着'
      : unlocked
        ? inShop
          ? '已拥有'
          : '穿戴'
        : currency < skin.price
          ? `还差 ${skin.price - currency} 交子`
          : '购买';
    button.setAttribute('aria-label', `${skin.name} · ${button.textContent}`);
  }
}

const { trainingBat, stunBaton, foldingRuler, longBroom, windowBreaker, nightWatchSpear } =
  COMBAT_RULES.player.attack.weapons;

function weaponDurability(maxUses: number | null): string {
  return maxUses === null ? '耐久无限' : `耐久 ${maxUses} 次后报废`;
}

export const SHOP_EFFECTS: Readonly<Record<string, string>> = {
  bandage: '恢复 10 点生命；满血时不会消耗。',
  'portable-medkit': '恢复 15 点生命；满血时不会消耗。',
  'morning-coffee': '恢复 25 点生命；满血时不会消耗。',
  'yellow-bike': '移动速度提升 30%，持续 5 秒。',
  'thick-down-jacket': '获得 30 点护盾，持续 5 秒。',
  'training-bat': `近身攻击，伤害 ${trainingBat.damage}，${weaponDurability(trainingBat.maxUses)}；带入本局不计价值。`,
  'stun-baton': `伤害 ${stunBaton.damage}；命中可短暂眩晕；${weaponDurability(stunBaton.maxUses)}；带入本局不计价值。`,
  'folding-ruler': `伤害 ${foldingRuler.damage}；攻击间隔 ${foldingRuler.cooldownMs / 1000} 秒；攻击范围较宽；${weaponDurability(foldingRuler.maxUses)}；带入本局不计价值。`,
  'long-broom': `伤害 ${longBroom.damage}；攻击距离 ${longBroom.range}；攻击间隔 ${longBroom.cooldownMs / 1000} 秒；${weaponDurability(longBroom.maxUses)}；带入本局不计价值。`,
  'window-breaker': `伤害 ${windowBreaker.damage}；攻击间隔 ${windowBreaker.cooldownMs / 1000} 秒；攻击范围较窄；${weaponDurability(windowBreaker.maxUses)}；带入本局不计价值。`,
  'night-watch-spear': `伤害 ${nightWatchSpear.damage}；攻击距离 ${nightWatchSpear.range}；攻击间隔 ${nightWatchSpear.cooldownMs / 1000} 秒；${weaponDurability(nightWatchSpear.maxUses)}；带入本局不计价值。`,
  'roller-skates': '移动速度提升 15%，持续 5 秒。',
  'electric-bike-helmet': '获得 15 点护盾，持续 5 秒。',
  'quick-note-card': '下一次搜索读条时间缩短 1 秒，使用后消耗。',
  'simple-detector': '显示最近一个未调查物资箱的方向，持续 8 秒，使用后消耗。',
  'star-compass': '同时指向最近主线调查点与南侧撤离点，持续 30 秒，使用后消耗。',
  'silent-cloak': '降低敌人发现范围，持续 8 秒；攻击或受伤会提前结束，使用后消耗。',
  'reflective-filter': '手电照射范围提升 20%，持续本局，使用后消耗。',
};

export const SHOP_WEAPON_ITEM_IDS = PURCHASE_ITEM_IDS.filter(
  (itemId) => ITEM_DEFINITIONS[itemId]!.kind === 'weapon',
).sort((left, right) => ITEM_DEFINITIONS[right]!.price! - ITEM_DEFINITIONS[left]!.price!);

export const SHOP_SUPPORT_ITEM_IDS = PURCHASE_ITEM_IDS.filter(
  (itemId) => ITEM_DEFINITIONS[itemId]!.kind !== 'weapon',
);

function shopItemMarkup(itemId: (typeof PURCHASE_ITEM_IDS)[number]): string {
  const item = ITEM_DEFINITIONS[itemId]!;
  const iconPath = warehouseItemIconAssetPath(itemId);
  const category =
    item.kind === 'weapon' ? '武器装备' : item.kind === 'healing' ? '恢复道具' : '辅助道具';
  return `<article class="shop-card" data-shop-item="${itemId}">
        <div class="shop-item-art wh-slot" data-rarity="${item.rarity}">
          ${iconPath ? `<img src="${assetUrl(iconPath.slice(1))}" alt="" decoding="async" draggable="false" />` : ''}
          <h3 class="wh-slot-name">${item.name}</h3>
        </div>
        <div class="shop-card-meta"><span class="shop-category">${category}</span><span class="shop-slots">占 ${item.bagSlots ?? 1} 格</span></div>
        <p class="shop-effect">${SHOP_EFFECTS[itemId]}</p>
        <div class="shop-stock">仓库持有 <b data-shop-stock>0</b> 件</div>
        <div class="shop-card-footer"><strong class="shop-price"><img src="${assetUrl('assets/ui/jiaozi.png')}" alt="" />${item.price}<span class="sr-only"> 交子</span></strong>
          <button type="button" class="shop-action" data-shop-buy="${itemId}">购买</button></div>
      </article>`;
}

export function shopMarkup(): string {
  return `<section class="lobby-panel lobby-panel-wide v19-subpage shop-panel" data-lobby-panel="shop" hidden aria-labelledby="shop-title">
    <div class="shop-frame">
      <header class="shop-heading">
        <button class="shop-back" type="button" data-lobby-tab="prepare" aria-label="返回大厅" title="返回大厅"></button>
        <h2 id="shop-title">商店</h2>
        <span class="shop-wallet"><span class="sr-only">交子余额</span><b id="shop-balance">0</b></span>
      </header>
      <nav class="shop-mode" aria-label="商店操作">
        <button type="button" data-shop-mode="buy" aria-pressed="true" aria-controls="shop-buy-panel">购买</button>
        <button type="button" data-shop-mode="sell" aria-pressed="false" aria-controls="shop-sell-panel">出售</button>
      </nav>
      <section id="shop-buy-panel" class="shop-content" data-shop-view="buy" aria-label="购买商品">
        <nav class="shop-categories" aria-label="购买分类">
          <button type="button" data-shop-category="weapons" aria-pressed="true" aria-controls="shop-weapons">武器</button>
          <button type="button" data-shop-category="support" aria-pressed="false" aria-controls="shop-support">辅助</button>
          <button type="button" data-shop-category="skins" aria-pressed="false" aria-controls="shop-skins">时装</button>
        </nav>
        <div id="shop-weapons" class="shop-grid" data-shop-section="weapons">${SHOP_WEAPON_ITEM_IDS.map(shopItemMarkup).join('')}</div>
        <div id="shop-support" class="shop-grid" data-shop-section="support" hidden>${SHOP_SUPPORT_ITEM_IDS.map(shopItemMarkup).join('')}</div>
        <section id="shop-skins" class="shop-skins" data-shop-section="skins" aria-label="时装商品" hidden>${wardrobeMarkup(true)}</section>
        <footer class="shop-footer">
          <p id="shop-status" class="shop-status" role="status" aria-live="polite"></p>
          <button id="shop-prepare" type="button" class="shop-action">前往出发准备</button>
        </footer>
      </section>
      ${shopSaleMarkup()}
    </div>
  </section>`;
}

export function bindShopModes(root: HTMLElement): (mode: 'buy' | 'sell') => void {
  const buttons = root.querySelectorAll<HTMLButtonElement>('[data-shop-mode]');
  const views = root.querySelectorAll<HTMLElement>('[data-shop-view]');
  function selectMode(mode: 'buy' | 'sell'): void {
    for (const button of buttons)
      button.setAttribute('aria-pressed', String(button.dataset.shopMode === mode));
    for (const view of views) view.hidden = view.dataset.shopView !== mode;
  }
  for (const button of buttons)
    button.onclick = () => selectMode(button.dataset.shopMode === 'sell' ? 'sell' : 'buy');
  return selectMode;
}

export function bindShopCategories(root: HTMLElement): void {
  const categories = root.querySelectorAll<HTMLButtonElement>('[data-shop-category]');
  const sections = root.querySelectorAll<HTMLElement>('[data-shop-section]');
  for (const category of categories) {
    category.onclick = () => {
      for (const button of categories)
        button.setAttribute('aria-pressed', String(button === category));
      for (const section of sections)
        section.hidden = section.dataset.shopSection !== category.dataset.shopCategory;
      root.querySelector('#shop-status')!.textContent = '';
    };
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
