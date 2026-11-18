import { EXPLORATION_CATALOG_IDS, ITEM_DEFINITIONS } from '../../config/game-config';
import type { ItemInstance } from '../../shared/types/game';
import { QUEST_CHAPTERS } from '../quests/quest-service';
import { warehouseItemDetails, warehouseItemIconSvg } from './warehouse-items';

const evidenceIds = new Set(
  QUEST_CHAPTERS.flatMap((chapter) => chapter.evidence.map((entry) => entry.itemId)),
);

/** A quest evidence item is never a value-only collectible, even if its legacy kind says collectible. */
export const VALUE_COLLECTION_IDS = EXPLORATION_CATALOG_IDS.filter(
  (id) => ITEM_DEFINITIONS[id]?.kind === 'collectible' && !evidenceIds.has(id),
);

export type ArchiveMode = 'collection' | 'warehouse';
export interface ArchiveSnapshot {
  readonly codexIds: readonly string[];
  readonly warehouse: readonly ItemInstance[];
}
export interface ArchiveEntry {
  readonly id: string;
  readonly unlocked: boolean;
  readonly count: number;
}

export function archiveEntries(snapshot: ArchiveSnapshot, mode: ArchiveMode): ArchiveEntry[] {
  if (mode === 'collection') {
    const unlocked = new Set(snapshot.codexIds);
    return VALUE_COLLECTION_IDS.map((id) => ({ id, unlocked: unlocked.has(id), count: 0 }));
  }
  const counts = new Map<string, number>();
  for (const item of snapshot.warehouse) {
    if (!ITEM_DEFINITIONS[item.itemId]) continue;
    counts.set(item.itemId, (counts.get(item.itemId) ?? 0) + 1);
  }
  return Object.keys(ITEM_DEFINITIONS)
    .filter((id) => counts.has(id))
    .map((id) => ({ id, unlocked: true, count: counts.get(id)! }));
}

export function archiveBrowserMarkup(id: string, mode: ArchiveMode = 'collection'): string {
  return `<section id="${id}" class="archive-browser" data-mode="${mode}" aria-label="收藏与仓库">
    <nav class="archive-categories" aria-label="物品类别">
      <span class="archive-categories-label">思源档案</span>
      <button type="button" data-archive-mode="collection" aria-pressed="${mode === 'collection'}"><small>01</small><b>收集<br>图鉴</b></button>
      <button type="button" data-archive-mode="warehouse" aria-pressed="${mode === 'warehouse'}"><small>02</small><b>仓库</b></button>
      <span class="archive-spine" aria-hidden="true">思源 · 物品记录</span>
    </nav>
    <section class="archive-catalog" aria-label="物品列表">
      <header class="archive-catalog-heading"><div class="archive-catalog-title"><h2 data-archive-heading>收集图鉴</h2><button type="button" class="archive-export-button" data-archive-export>导出图鉴</button><span class="archive-export-status" data-archive-export-status role="status" aria-live="polite"></span></div><span data-archive-count></span></header>
      <p class="archive-catalog-hint" data-archive-hint></p>
      <div class="archive-item-grid" data-archive-grid></div>
      <footer class="archive-catalog-footer"><span>思源记录册</span><span aria-hidden="true">▪ ▪ ▪</span></footer>
    </section>
    <section class="archive-inspector" aria-label="物品详情">
      <div class="archive-detail-top"><div class="archive-item-art" data-archive-art></div>
        <div class="archive-item-heading"><span class="archive-detail-eyebrow">物品档案</span><h2 data-archive-name>尚未发现</h2><p data-archive-category></p><p data-archive-rarity></p><div class="archive-value"><span>物品价值</span><strong data-archive-value>—</strong></div></div>
      </div>
      <h3 class="archive-description-title">物品说明 / 作用</h3>
      <p class="archive-description" data-archive-description></p>
      <p class="archive-detail-note" data-archive-note></p>
    </section>
  </section>`;
}

interface BrowserState {
  snapshot: ArchiveSnapshot;
  mode: ArchiveMode;
  selected: Partial<Record<ArchiveMode, string>>;
  signature: string;
}
const states = new WeakMap<HTMLElement, BrowserState>();

/** Both the lobby and modal use this browser and preserve independent tab/selection state. */
export function renderArchiveBrowser(root: HTMLElement, snapshot: ArchiveSnapshot): void {
  let state = states.get(root);
  if (!state) {
    state = {
      snapshot,
      mode: root.dataset.mode === 'warehouse' ? 'warehouse' : 'collection',
      selected: {},
      signature: '',
    };
    states.set(root, state);
    root.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!button) return;
      const current = states.get(root)!;
      const mode = button.dataset.archiveMode;
      if (mode === 'collection' || mode === 'warehouse') {
        current.mode = mode;
        current.signature = '';
        renderArchiveBrowser(root, current.snapshot);
      } else if (button.dataset.archiveItem) {
        current.selected[current.mode] = button.dataset.archiveItem;
        renderSelection(root, current);
      }
    });
  }
  state.snapshot = snapshot;
  const entries = archiveEntries(snapshot, state.mode);
  const signature = JSON.stringify([state.mode, entries]);
  if (signature === state.signature) return;
  state.signature = signature;
  root.dataset.mode = state.mode;
  const get = (name: string) => root.querySelector<HTMLElement>(`[data-archive-${name}]`)!;
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-archive-mode]')) {
    button.setAttribute('aria-pressed', String(button.dataset.archiveMode === state.mode));
  }
  get('heading').textContent = state.mode === 'collection' ? '收集图鉴' : '永久仓库';
  const exportButton = root.querySelector<HTMLButtonElement>('[data-archive-export]');
  if (exportButton) exportButton.hidden = state.mode !== 'collection';
  get('count').textContent =
    state.mode === 'collection'
      ? `${entries.filter((entry) => entry.unlocked).length} / ${entries.length}`
      : `${entries.length} 种 · ${entries.reduce((sum, entry) => sum + entry.count, 0)} 件`;
  get('hint').textContent =
    state.mode === 'collection'
      ? '纯价值收藏物 · 成功带出后永久点亮'
      : '已保存物品 · 点击图标查看详情';
  const grid = get('grid');
  grid.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'archive-grid-empty';
    empty.textContent = '仓库暂时空着。成功撤离或购买道具后，物品会出现在这里。';
    grid.append(empty);
  }
  for (const entry of entries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `archive-item-tile${entry.unlocked ? '' : ' is-undiscovered'}`;
    button.dataset.archiveItem = entry.id;
    button.setAttribute(
      'aria-label',
      entry.unlocked
        ? `${ITEM_DEFINITIONS[entry.id]!.name}${entry.count ? `，${entry.count} 件` : ''}`
        : '未解锁收藏物',
    );
    button.title = entry.unlocked ? ITEM_DEFINITIONS[entry.id]!.name : '未解锁收藏物';
    button.innerHTML = entry.unlocked
      ? warehouseItemIconSvg(entry.id)
      : '<span class="archive-question" aria-hidden="true">?</span>';
    if (entry.count > 0) {
      const count = document.createElement('span');
      count.className = 'archive-item-quantity';
      count.textContent = `×${entry.count}`;
      button.append(count);
    }
    grid.append(button);
  }
  if (!entries.some((entry) => entry.id === state.selected[state.mode])) {
    state.selected[state.mode] = (entries.find((entry) => entry.unlocked) ?? entries[0])?.id;
  }
  renderSelection(root, state);
}

function renderSelection(root: HTMLElement, state: BrowserState): void {
  root.querySelector<HTMLElement>('.archive-inspector')!.scrollTop = 0;
  const entry = archiveEntries(state.snapshot, state.mode).find(
    (item) => item.id === state.selected[state.mode],
  );
  const details = entry?.unlocked ? warehouseItemDetails(entry.id) : null;
  const set = (name: string, value: string) => {
    root.querySelector<HTMLElement>(`[data-archive-${name}]`)!.textContent = value;
  };
  for (const tile of root.querySelectorAll<HTMLElement>('[data-archive-item]')) {
    tile.setAttribute('aria-pressed', String(tile.dataset.archiveItem === entry?.id));
  }
  const art = root.querySelector<HTMLElement>('[data-archive-art]')!;
  art.innerHTML =
    details && entry
      ? warehouseItemIconSvg(entry.id)
      : '<span class="archive-question" aria-hidden="true">?</span>';
  set('name', details?.name ?? (entry ? '未解锁物品' : '暂无物品'));
  set('category', details?.category ?? '思源收藏档案');
  set('rarity', details?.rarity ?? '等待发现');
  set('value', details ? String(details.value ?? '待定') : '—');
  set(
    'description',
    details?.description ??
      (entry
        ? '在探索中发现这件收藏物，并成功带出校园后，即可解锁它的图像、价值和说明。'
        : '开始探索，带回属于你的第一件物品。'),
  );
  set(
    'note',
    details
      ? state.mode === 'collection'
        ? '已永久收录 · 无额外使用效果'
        : `仓库持有 ${entry!.count} 件 · 每件占 ${details.bagSlots} 格背包`
      : '未知记录 · 尚未收录',
  );
}
