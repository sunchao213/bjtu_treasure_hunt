import {
  ITEM_DEFINITIONS,
  isCarryInAllowed,
  itemValueFor,
  WAREHOUSE_CAPACITY,
} from '../../config/game-config';
import type { ItemInstance } from '../../shared/types/game';
import { VALUE_COLLECTION_IDS } from './archive-browser';
import { warehouseItemIconAssetPath, warehouseItemDetails } from './warehouse-items';

/** 仓库面板的分类：全部 / 道具（非收藏）/ 藏品（纯价值收藏物） */
export type WarehouseFilter = 'all' | 'props' | 'collection';

/** 一屏 3 行 × 5 列 */
const COLUMNS = 5;
/** 指针移动超过这个距离才算拖拽，否则当点击 */
const DRAG_THRESHOLD = 6;
const collectionIds = new Set<string>(VALUE_COLLECTION_IDS);
/** 有专属底色的稀有度；其余（如 pending）用原始木色格子 */
const RARITY_TINTS = new Set(['common', 'uncommon', 'epic', 'legendary']);

interface PanelState {
  filter: WarehouseFilter;
  items: readonly ItemInstance[];
  currency: number;
  /** 全仓库的实例顺序（instanceId），与存档 warehouse 数组一一对应；拖拽互换和一键整理都落在这里 */
  order: string[];
  /** 当前打开详情的 instanceId */
  selected: string | null;
  signature: string;
}

const states = new WeakMap<HTMLElement, PanelState>();

/** 一格一件：每个 ItemInstance 独占一个格子，不再按 itemId 合并计数 */
interface Entry {
  instanceId: string;
  itemId: string;
}

export function warehousePanelMarkup(): string {
  return `<div class="wh-panel" data-filter="all" data-scrollable="false">
    <div class="wh-scroll" data-wh-scroll>
      <div class="wh-grid" data-wh-grid role="group" aria-label="仓库物品"></div>
    </div>
    <!-- 三个签的文字画在 panel-{all,props,collection}.png 里（按选中态切图），
         这里只留透明热区。改文案要重出素材，见 text-gen/build_panels_v5.py -->
    <div class="wh-tabs" role="group" aria-label="物品分类">
      <button type="button" data-wh-filter="all" aria-label="全部物品"></button>
      <button type="button" data-wh-filter="props" aria-label="道具"></button>
      <button type="button" data-wh-filter="collection" aria-label="藏品"></button>
    </div>
    <span class="wh-capacity"><b data-wh-capacity>0</b><i>/ ${WAREHOUSE_CAPACITY}</i></span>
    <span class="wh-value" data-wh-value>0</span>
    <button class="wh-sort" type="button" data-wh-sort aria-label="一键整理"></button>
    <span class="wh-bar" data-wh-bar aria-hidden="true"><i></i></span>
    <div class="wh-detail" data-wh-detail hidden>
      <div class="wh-detail-card" role="group" aria-label="物品详情">
        <button class="wh-detail-close" type="button" data-wh-detail-close aria-label="关闭详情"></button>
        <div class="wh-detail-top">
          <img class="wh-detail-art" alt="" data-wh-detail-art draggable="false" />
          <div class="wh-detail-head">
            <h3 class="wh-detail-name" data-wh-detail-name></h3>
            <p class="wh-detail-meta" data-wh-detail-meta></p>
            <div class="wh-detail-stats">
              <span><b data-wh-detail-value>0</b><i>价值</i></span>
              <span><b data-wh-detail-slots>1</b><i>占格</i></span>
              <span><b data-wh-detail-count>1</b><i>数量</i></span>
            </div>
          </div>
        </div>
        <p class="wh-detail-desc" data-wh-detail-desc></p>
        <div class="wh-detail-carry" data-wh-carry-bar>
          <button class="wh-carry-btn" type="button" data-wh-carry></button>
          <span class="wh-carry-note" data-wh-carry-note></span>
          <button class="wh-carry-clear" type="button" data-wh-uncarry hidden>取消带入</button>
        </div>
        <p class="wh-detail-tip">按住格子拖动，可与另一格物品交换位置</p>
      </div>
    </div>
  </div>`;
}

function createSlot(): HTMLButtonElement {
  const slot = document.createElement('button');
  slot.className = 'wh-slot';
  slot.type = 'button';
  slot.dataset.whSlot = '';
  slot.dataset.empty = 'true';
  return slot;
}

/** 已带入本局的一件仓库物品（面板只读这份快照，真正的勾选状态由存档侧持有） */
export interface WarehouseCarryEntry {
  instanceId: string;
  itemId: string;
  bagSlots: number;
}

/** 面板与「行前准备」共用的带入能力，状态由 game.ts 统一持有，两边互相同步 */
export interface WarehouseCarryApi {
  list(): readonly WarehouseCarryEntry[];
  capacity(): number;
  /** 联机准备期间锁定，与旧勾选列表的 disabled 保持一致 */
  locked(): boolean;
  /** 该 itemId 还有没有没带上的实例 */
  hasSpare(itemId: string): boolean;
  /** 带一件；false 表示带不了（容量满了或没库存），提示由调用方负责 */
  carry(itemId: string): boolean;
  /** 取消该 itemId 的全部带入 */
  uncarry(itemId: string): void;
}

/** 跨面板拖拽：仓库 ⇄ 随身背包（带入/放回只改标记，物品实例始终留在仓库数组里） */
export interface WarehouseCrossDragApi {
  /** 仓库→背包：带入该实例；false 表示失败（背包满/联机锁定等），提示由调用方负责 */
  carryInstance(instanceId: string): boolean;
  /** 背包→仓库：放回 */
  uncarryInstance(instanceId: string): void;
  /** 背包内两格互换位置 */
  swapBag(a: string, b: string): void;
}

export interface WarehousePanelOptions {
  onSort?: () => void;
  /** 拖拽互换或一键整理后，把全仓库新的 itemId 顺序交出去落盘 */
  onReorder?: (itemIds: readonly string[]) => void;
  /** 带入装备：与旧「行前准备」里的勾选列表共享同一份状态 */
  carry?: WarehouseCarryApi;
  /** 跨面板拖拽回调（与 bagGrid 一起提供才启用仓库⇄背包拖拽） */
  crossDrag?: WarehouseCrossDragApi;
  /** 随身背包格子容器：背包格起拖与投放目标的查询根 */
  bagGrid?: () => HTMLElement | null;
  /** 拖影挂载层：跨面板拖拽要盖住左右两块面板，传两面板的共同祖先（默认仓库面板） */
  ghostLayer?: () => HTMLElement | null;
  /** 打开「行前准备」（旧那套初始武器 + 勾选列表，保留可用） */
  onOpenPrepare?: () => void;
}

const optionStore = new WeakMap<HTMLElement, WarehousePanelOptions>();

export function mountWarehousePanel(root: HTMLElement, options: WarehousePanelOptions = {}): void {
  const panel = root.querySelector<HTMLElement>('.wh-panel');
  if (!panel) return;
  optionStore.set(panel, options);
  const scroller = panel.querySelector<HTMLElement>('[data-wh-scroll]');
  const detail = panel.querySelector<HTMLElement>('[data-wh-detail]');
  scroller?.addEventListener('scroll', () => syncScrollBar(panel), { passive: true });
  // 弹窗打开前 .wh-scroll 尺寸为 0，paint 算不出可滚状态；尺寸一变就重算
  if (scroller && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => syncScrollBar(panel)).observe(scroller);
  }

  root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (suppressClick) {
      // 拖拽结束时浏览器还会补一次 click，这里吃掉，避免顺手打开详情
      suppressClick = false;
      return;
    }
    const filterButton = target.closest<HTMLElement>('[data-wh-filter]');
    if (filterButton) {
      const state = states.get(panel);
      if (!state) return;
      const next = filterButton.dataset.whFilter as WarehouseFilter;
      if (next !== state.filter) {
        state.filter = next;
        state.selected = null;
        paint(panel);
        scroller?.scrollTo({ top: 0 });
      }
      return;
    }
    if (target.closest('[data-wh-sort]')) {
      const state = states.get(panel);
      if (!state) return;
      sortByValue(state);
      state.selected = null;
      paint(panel);
      scroller?.scrollTo({ top: 0 });
      options.onSort?.();
      options.onReorder?.(state.order);
      return;
    }
    if (target.closest('[data-wh-prep]')) {
      options.onOpenPrepare?.();
      return;
    }
    if (target.closest('[data-wh-carry]') || target.closest('[data-wh-uncarry]')) {
      const state = states.get(panel);
      const api = options.carry;
      const itemId = state?.selected;
      if (!state || !api || !itemId) return;
      if (target.closest('[data-wh-uncarry]')) api.uncarry(itemId);
      else api.carry(itemId);
      // 带入/取消带入会改变仓库格子内容（物品消失/重现），整体重绘
      paint(panel);
      return;
    }
    if (target.closest('[data-wh-detail-close]') || target === detail) {
      closeDetail(panel);
      return;
    }
    const slot = target.closest<HTMLElement>('[data-wh-slot]');
    if (slot?.dataset.item) {
      toggleDetail(panel, slot.dataset.item);
    }
  });

  // 详情开着时 Esc 只关详情，不要把整个背包弹窗关掉；用 document 捕获阶段抢在 <dialog> 之前
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || !states.get(panel)?.selected) return;
      event.preventDefault();
      event.stopPropagation();
      closeDetail(panel);
    },
    true,
  );
  mountDrag(panel, root, options);
}

/* ------------------------------- 拖拽互换 ------------------------------- */

interface DragState {
  pointerId: number;
  fromId: string;
  /** 起拖的面板：仓库格还是随身背包格 */
  source: 'warehouse' | 'bag';
  slot: HTMLElement;
  panel: HTMLElement;
  /** 拖影挂载层（跨面板拖拽用两面板的共同祖先，否则拖影会被仓库面板裁掉） */
  layer: HTMLElement;
  startX: number;
  startY: number;
  /** 面板所在的缩放比（大厅画框会整体 scale），屏幕像素 ÷ scale = 面板内逻辑像素 */
  scale: number;
  sizeW: number;
  sizeH: number;
  active: boolean;
  ghost?: HTMLElement;
  hover?: HTMLElement | null;
}

let dragState: DragState | null = null;
let suppressClick = false;

function mountDrag(panel: HTMLElement, root: HTMLElement, options: WarehousePanelOptions): void {
  const beginDrag = (
    event: PointerEvent,
    slot: HTMLElement,
    source: 'warehouse' | 'bag',
  ): void => {
    const fromId = source === 'warehouse' ? slot.dataset.item : slot.dataset.bpInstance;
    if (event.button !== 0 || !fromId) return;
    dragState = {
      pointerId: event.pointerId,
      fromId,
      source,
      slot,
      panel,
      layer: options.ghostLayer?.() ?? panel,
      startX: event.clientX,
      startY: event.clientY,
      scale: 1,
      sizeW: 0,
      sizeH: 0,
      active: false,
    };
  };

  root.addEventListener('pointerdown', (event) => {
    // 上一次跨面板拖拽后 click 落在背包里、没人消费 suppressClick，这里兜底清掉
    suppressClick = false;
    const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-wh-slot]');
    if (slot?.dataset.item) beginDrag(event, slot, 'warehouse');
  });

  // 随身背包格也能起拖：拖去仓库 = 放回，拖去另一格 = 互换顺序
  options.bagGrid?.()?.addEventListener('pointerdown', (event) => {
    const slot = (event.target as HTMLElement).closest<HTMLElement>('[data-bp-instance]');
    if (slot?.dataset.bpInstance) beginDrag(event, slot, 'bag');
  });

  window.addEventListener(
    'pointermove',
    (event) => {
      const drag = dragState;
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.active) {
        const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
        if (moved < DRAG_THRESHOLD) return;
        drag.active = true;
        beginGhost(drag, event.clientX, event.clientY);
      }
      if (drag.ghost) {
        const base = drag.layer.getBoundingClientRect();
        drag.ghost.style.left = `${(event.clientX - base.left) / drag.scale - drag.sizeW / 2}px`;
        drag.ghost.style.top = `${(event.clientY - base.top) / drag.scale - drag.sizeH / 2}px`;
      }
      const hover = dropTargetAt(event.clientX, event.clientY, drag)?.el ?? null;
      if (hover !== drag.hover) {
        drag.hover?.removeAttribute('data-drop');
        hover?.setAttribute('data-drop', 'true');
        drag.hover = hover;
      }
    },
    { passive: true },
  );

  window.addEventListener('pointerup', (event) => {
    const drag = dragState;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragState = null;
    if (!drag.active) return; // 没拖动 → 交给 click 开详情
    suppressClick = true;
    drag.hover?.removeAttribute('data-drop');
    drag.slot.removeAttribute('data-dragging');
    drag.ghost?.remove();
    const target = dropTargetAt(event.clientX, event.clientY, drag);
    const cross = options.crossDrag;
    if (drag.source === 'warehouse') {
      if (target?.kind === 'warehouse-slot') {
        // 仓库内互换位置
        swapItems(panel, drag.fromId, target.el.dataset.item!, options);
      } else if (target?.kind === 'bag-slot' || target?.kind === 'bag-grid') {
        // 拖去随身背包 = 带入本局（失败时调用方负责提示，拖影原样弹回）
        cross?.carryInstance(drag.fromId);
      }
    } else if (target?.kind === 'warehouse-slot' || target?.kind === 'warehouse-panel') {
      // 从背包拖回仓库任意位置 = 放回
      cross?.uncarryInstance(drag.fromId);
    } else if (target?.kind === 'bag-slot' && target.el.dataset.bpInstance) {
      // 背包内互换顺序
      cross?.swapBag(drag.fromId, target.el.dataset.bpInstance);
    }
  });

  window.addEventListener('pointercancel', () => {
    dragState?.hover?.removeAttribute('data-drop');
    dragState?.slot.removeAttribute('data-dragging');
    dragState?.ghost?.remove();
    dragState = null;
  });
}

function beginGhost(drag: DragState, x: number, y: number): void {
  const rect = drag.slot.getBoundingClientRect();
  const base = drag.layer.getBoundingClientRect();
  // 大厅是缩放画框：rect 是屏幕像素，拖影挂在画框层里要用逻辑像素，否则会被再放大一次
  const scale = base.width > 0 ? base.width / drag.layer.offsetWidth : 1;
  drag.scale = scale || 1;
  drag.sizeW = rect.width / drag.scale;
  drag.sizeH = rect.height / drag.scale;
  const ghost = document.createElement('div');
  ghost.className = 'wh-ghost';
  ghost.style.width = `${drag.sizeW}px`;
  ghost.style.height = `${drag.sizeH}px`;
  ghost.style.left = `${(x - base.left) / drag.scale - drag.sizeW / 2}px`;
  ghost.style.top = `${(y - base.top) / drag.scale - drag.sizeH / 2}px`;
  // 拖影要连稀有度底色、图标、名称一起带走，否则抓起来像个空洞
  if (drag.slot.dataset.rarity) ghost.dataset.rarity = drag.slot.dataset.rarity;
  for (const child of Array.from(drag.slot.children)) {
    ghost.append(child.cloneNode(true));
  }
  // 拖影挂两面板的共同祖先（.bp-stage，也在 <dialog> top layer 内）：
  // 挂 body 会被 backdrop 盖住；挂仓库面板又会在拖去背包时被面板边界裁掉
  drag.layer.append(ghost);
  drag.ghost = ghost;
  drag.slot.dataset.dragging = 'true';
}

/** 指针下面能接受投放的目标；无效目标和自己都返回 null */
function dropTargetAt(
  x: number,
  y: number,
  drag: DragState,
): { el: HTMLElement; kind: 'warehouse-slot' | 'bag-slot' | 'bag-grid' | 'warehouse-panel' } | null {
  const node = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!node) return null;
  if (drag.source === 'warehouse') {
    // 拖去随身背包：任意背包格（空的整格被 disabled 挡住时命中格子区）都算「带入」
    const bagSlot = node.closest<HTMLElement>('[data-bp-instance]');
    if (bagSlot) return { el: bagSlot, kind: 'bag-slot' };
    const bagGrid = node.closest<HTMLElement>('[data-bp-bag-grid]');
    if (bagGrid) return { el: bagGrid, kind: 'bag-grid' };
    const slot = node.closest<HTMLElement>('[data-wh-slot]');
    if (slot?.dataset.item && slot.dataset.item !== drag.fromId) {
      return { el: slot, kind: 'warehouse-slot' };
    }
    return null;
  }
  // 从背包拖出：落到仓库格子或仓库面板任意位置都算「放回」
  const slot = node.closest<HTMLElement>('[data-wh-slot]');
  if (slot?.dataset.item && slot.dataset.item !== drag.fromId) {
    return { el: slot, kind: 'warehouse-slot' };
  }
  const whPanel = node.closest<HTMLElement>('.wh-panel');
  if (whPanel) return { el: whPanel, kind: 'warehouse-panel' };
  // 背包内互换顺序
  const bagSlot = node.closest<HTMLElement>('[data-bp-instance]');
  if (bagSlot?.dataset.bpInstance && bagSlot.dataset.bpInstance !== drag.fromId) {
    return { el: bagSlot, kind: 'bag-slot' };
  }
  return null;
}

function swapItems(
  panel: HTMLElement,
  fromId: string,
  toId: string,
  options: WarehousePanelOptions,
): void {
  const state = states.get(panel);
  if (!state) return;
  const a = state.order.indexOf(fromId);
  const b = state.order.indexOf(toId);
  if (a < 0 || b < 0) return;
  const next = [...state.order];
  next[a] = toId;
  next[b] = fromId;
  state.order = next;
  paint(panel);
  options.onReorder?.(next);
}

/* --------------------------------- 详情 --------------------------------- */

/** 格子上存的是 instanceId，详情/带入需要 itemId 时用它换回 */
function itemIdOfInstance(state: PanelState, instanceId: string): string | null {
  return state.items.find((item) => item.instanceId === instanceId)?.itemId ?? null;
}

function toggleDetail(panel: HTMLElement, instanceId: string): void {
  const state = states.get(panel);
  if (!state) return;
  state.selected = state.selected === instanceId ? null : instanceId;
  paintDetail(panel);
}

function closeDetail(panel: HTMLElement): void {
  const state = states.get(panel);
  if (!state) return;
  const previous = state.selected;
  state.selected = null;
  paintDetail(panel);
  if (previous) {
    panel
      .querySelector<HTMLElement>(`[data-wh-slot][data-item="${CSS.escape(previous)}"]`)
      ?.focus();
  }
}

function paintDetail(panel: HTMLElement): void {
  const state = states.get(panel);
  const layer = panel.querySelector<HTMLElement>('[data-wh-detail]');
  if (!state || !layer) return;
  const instanceId = state.selected;
  if (!instanceId) {
    layer.hidden = true;
    return;
  }
  const itemId = itemIdOfInstance(state, instanceId);
  const details = itemId ? warehouseItemDetails(itemId) : undefined;
  const definition = itemId ? ITEM_DEFINITIONS[itemId] : undefined;
  if (!itemId || !details || !definition) {
    layer.hidden = true;
    return;
  }
  const count = state.items.filter((item) => item.itemId === itemId).length;
  const set = (name: string, text: string) => {
    const node = layer.querySelector<HTMLElement>(`[data-wh-detail-${name}]`);
    if (node) node.textContent = text;
  };
  const art = layer.querySelector<HTMLImageElement>('[data-wh-detail-art]');
  const icon = warehouseItemIconAssetPath(itemId);
  if (art) {
    if (icon) {
      art.src = icon;
      art.hidden = false;
    } else {
      art.removeAttribute('src');
      art.hidden = true;
    }
  }
  set('name', details.name);
  set('meta', `${details.category} · ${details.rarity}`);
  set('value', String(details.value ?? 0));
  set('slots', String(details.bagSlots));
  set('count', String(count));
  set('desc', details.description);
  paintCarryBar(panel, layer, itemId, count);
  const wasOpen = !layer.hidden;
  layer.hidden = false;
  if (!wasOpen) {
    layer.querySelector<HTMLElement>('[data-wh-detail-close]')?.focus({ preventScroll: true });
  }
}

/* -------------------------------- 带入装备 ------------------------------- */

/** 带入集合变化后由外部调用：带入的物品要从仓库格子中消失（或放回后重现），整体重绘 */
export function refreshWarehouseCarry(root: HTMLElement): void {
  const panel = root.querySelector<HTMLElement>('.wh-panel');
  if (panel) paint(panel);
}

/** 当前已带入背包的实例 id 集合：这些物品不再渲染进仓库格子，原位空出来 */
function carriedInstanceIds(panel: HTMLElement): Set<string> {
  const ids = new Set<string>();
  for (const entry of optionStore.get(panel)?.carry?.list() ?? []) ids.add(entry.instanceId);
  return ids;
}

/** 兜底清理：带入的实例已不渲染进格子，理论上不会有角标；防止旧 DOM 残留「带」标记 */
function syncCarry(panel: HTMLElement): void {
  const carried = carriedInstanceIds(panel);
  for (const slot of panel.querySelectorAll<HTMLElement>('[data-wh-slot]')) {
    const instanceId = slot.dataset.item;
    if (instanceId && carried.has(instanceId)) continue;
    slot.removeAttribute('data-carry');
    slot.querySelector<HTMLElement>('.wh-slot-carry')?.remove();
  }
}

function paintCarryBar(
  panel: HTMLElement,
  layer: HTMLElement,
  itemId: string,
  count: number,
): void {
  const bar = layer.querySelector<HTMLElement>('[data-wh-carry-bar]');
  const button = layer.querySelector<HTMLButtonElement>('[data-wh-carry]');
  const note = layer.querySelector<HTMLElement>('[data-wh-carry-note]');
  const clear = layer.querySelector<HTMLButtonElement>('[data-wh-uncarry]');
  const api = optionStore.get(panel)?.carry;
  if (!bar || !button || !note || !clear) return;
  if (!api) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  if (!isCarryInAllowed(itemId)) {
    const kind = ITEM_DEFINITIONS[itemId]?.kind;
    button.hidden = true;
    clear.hidden = true;
    note.hidden = false;
    note.textContent =
      kind === 'collectible' ? '藏品只计价值，无法带入本局' : '任务物品无法带入本局';
    return;
  }
  const carried = api.list().filter((entry) => entry.itemId === itemId);
  const used = api.list().reduce((sum, entry) => sum + entry.bagSlots, 0);
  const capacity = api.capacity();
  const spare = api.hasSpare(itemId);
  button.hidden = false;
  clear.hidden = carried.length === 0;
  note.hidden = false;
  note.textContent = carried.length
    ? `已带入 ${carried.length} / ${count} 件 · 背包 ${used} / ${capacity} 格`
    : `未带入 · 背包 ${used} / ${capacity} 格`;
  if (api.locked()) {
    button.disabled = true;
    button.textContent = '联机准备中';
    clear.hidden = true;
    note.textContent = '房间准备期间不能调整带入';
    return;
  }
  if (!spare) {
    button.disabled = true;
    button.textContent = '已全部带入';
  } else if (used >= capacity) {
    button.disabled = true;
    button.textContent = '背包已满';
  } else {
    button.disabled = false;
    button.textContent = carried.length > 0 ? '再带一件' : '带入本局';
  }
}

/* --------------------------------- 排序 --------------------------------- */

/** 一键整理：整个仓库按价值从高到低，同类物品相邻（价值相同再按 itemId 稳定排序） */
function sortByValue(state: PanelState): void {
  const all = aggregate(state.items);
  all.sort((a, b) => valueOf(b.itemId) - valueOf(a.itemId) || a.itemId.localeCompare(b.itemId));
  state.order = all.map((entry) => entry.instanceId);
}

/** 每件实例一格，不合并计数；未注册进 ITEM_DEFINITIONS 的物品不显示 */
function aggregate(items: readonly ItemInstance[]): Entry[] {
  return items
    .filter((item) => ITEM_DEFINITIONS[item.itemId])
    .map((item) => ({ instanceId: item.instanceId, itemId: item.itemId }));
}

function valueOf(itemId: string): number {
  const definition = ITEM_DEFINITIONS[itemId];
  return definition ? (itemValueFor(definition) ?? 0) : 0;
}

/** 全仓库条目按 state.order 排好；已带入背包的实例不占格子（原位空出来）；order 里没有的新实例接在末尾 */
function orderedEntries(state: PanelState, carried: ReadonlySet<string>): Entry[] {
  const all = aggregate(state.items);
  const visible = all.filter((entry) => {
    if (carried.has(entry.instanceId)) return false;
    if (state.filter === 'collection') return collectionIds.has(entry.itemId);
    if (state.filter === 'props') return !collectionIds.has(entry.itemId);
    return true;
  });
  const rank = new Map(state.order.map((id, index) => [id, index]));
  return [...visible].sort((a, b) => {
    const ra = rank.get(a.instanceId) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.instanceId) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

/** order 只保留还存在的实例，新实例按原有顺序补到末尾 —— 保证它始终覆盖整个仓库 */
function normalizeOrder(order: readonly string[], ids: readonly string[]): string[] {
  const known = new Set(ids);
  const next = order.filter((id) => known.has(id));
  const seen = new Set(next);
  for (const id of ids) if (!seen.has(id)) next.push(id);
  return next;
}

/* --------------------------------- 渲染 --------------------------------- */

export function renderWarehousePanel(
  root: HTMLElement,
  items: readonly ItemInstance[],
  currency: number,
): void {
  const panel = root.querySelector<HTMLElement>('.wh-panel');
  if (!panel) return;
  let state = states.get(panel);
  if (!state) {
    state = { filter: 'all', items, currency, order: [], selected: null, signature: '' };
    states.set(panel, state);
  }
  state.items = items;
  state.currency = currency;
  // 签名里带上带入集合：带入/放回不改 items，但格子内容会变（物品从仓库消失/重现）
  const signature = JSON.stringify([
    state.filter,
    items,
    currency,
    state.order,
    [...carriedInstanceIds(panel)].sort(),
  ]);
  if (signature === state.signature) return;
  state.signature = signature;
  paint(panel);
}

function paint(panel: HTMLElement): void {
  const state = states.get(panel);
  if (!state) return;
  panel.dataset.filter = state.filter;
  const carried = carriedInstanceIds(panel);
  state.order = normalizeOrder(
    state.order,
    aggregate(state.items).map((entry) => entry.instanceId),
  );
  const entries = orderedEntries(state, carried);
  state.signature = JSON.stringify([
    state.filter,
    state.items,
    state.currency,
    state.order,
    [...carried].sort(),
  ]);

  // 固定 100 格（20 行）；万一物品超上限也不隐藏，按 5 的倍数继续补满
  const grid = panel.querySelector<HTMLElement>('[data-wh-grid]');
  if (!grid) return;
  const needed = Math.max(WAREHOUSE_CAPACITY, Math.ceil(entries.length / COLUMNS) * COLUMNS);
  while (grid.children.length < needed) grid.append(createSlot());
  while (grid.children.length > needed) grid.lastElementChild?.remove();

  const slots = grid.querySelectorAll<HTMLButtonElement>('[data-wh-slot]');
  slots.forEach((slot, index) => {
    const entry = entries[index];
    slot.replaceChildren();
    slot.removeAttribute('data-item');
    slot.removeAttribute('data-drop');
    slot.removeAttribute('data-rarity');
    if (!entry) {
      slot.dataset.empty = 'true';
      slot.disabled = true;
      slot.removeAttribute('aria-label');
      slot.removeAttribute('title');
      return;
    }
    const details = warehouseItemDetails(entry.itemId);
    const label = details?.name ?? entry.itemId;
    slot.dataset.empty = 'false';
    slot.disabled = false;
    slot.dataset.item = entry.instanceId;
    // 稀有度决定格内底色；没有对应色板的（如 pending）落回木色
    if (details && RARITY_TINTS.has(details.rarityKey)) {
      slot.dataset.rarity = details.rarityKey;
    } else {
      delete slot.dataset.rarity;
    }
    slot.setAttribute('aria-label', label);
    slot.title = label;
    const icon = warehouseItemIconAssetPath(entry.itemId);
    if (icon) {
      const img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      img.draggable = false;
      slot.append(img);
    }
    if (details?.name) {
      // 名称走 DOM：拖拽换位、空格清空、随面板缩放都不会和底图对不上
      const name = document.createElement('span');
      name.className = 'wh-slot-name';
      name.textContent = details.name;
      slot.append(name);
    }
  });

  const capacity = panel.querySelector<HTMLElement>('[data-wh-capacity]');
  if (capacity) {
    // 一格一件：容量就是在库件数（带入背包的物品不在库里，不计入）
    capacity.textContent = String(entries.length);
    // 满仓给个红字提示：此时买不了东西，撤离多出来的走信箱
    capacity.closest('.wh-capacity')?.setAttribute('data-full', String(entries.length >= WAREHOUSE_CAPACITY));
  }

  const total = panel.querySelector<HTMLElement>('[data-wh-value]');
  if (total) {
    // 总价值按全部持有物品算：带入背包的仍是自己的东西，数值不随带入波动
    const value = aggregate(state.items).reduce((sum, entry) => sum + valueOf(entry.itemId), 0);
    total.textContent = String(value);
  }

  for (const button of panel.querySelectorAll<HTMLElement>('[data-wh-filter]')) {
    button.setAttribute('aria-pressed', String(button.dataset.whFilter === state.filter));
  }

  paintDetail(panel);
  syncCarry(panel);
  syncScrollBar(panel);
}

/** 右侧细滚动条：内容不超过一屏时整条隐藏（面板外框本来就有缝，不额外占位） */
function syncScrollBar(panel: HTMLElement): void {
  const scroller = panel.querySelector<HTMLElement>('[data-wh-scroll]');
  const bar = panel.querySelector<HTMLElement>('[data-wh-bar]');
  const thumb = bar?.firstElementChild as HTMLElement | null;
  if (!scroller || !bar || !thumb) return;
  const { scrollHeight, clientHeight, scrollTop } = scroller;
  const scrollable = scrollHeight > clientHeight + 1;
  panel.dataset.scrollable = String(scrollable);
  if (!scrollable) return;
  const ratio = clientHeight / scrollHeight;
  const track = bar.clientHeight;
  const height = Math.max(18, track * ratio);
  const maxTop = track - height;
  const progress = maxTop > 0 ? scrollTop / (scrollHeight - clientHeight) : 0;
  thumb.style.height = `${height}px`;
  thumb.style.transform = `translateY(${Math.round(maxTop * progress)}px)`;
}
