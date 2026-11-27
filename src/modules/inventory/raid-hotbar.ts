import { HEALING_AMOUNTS, ITEM_DEFINITIONS, UTILITY_EFFECTS } from '../../config/game-config';
import type { ItemInstance } from '../../shared/types/game';

export const HOTBAR_SIZE = 4;
export function isHotbarItem(itemId: string): boolean {
  const definition = ITEM_DEFINITIONS[itemId];
  return (
    definition?.kind === 'weapon' ||
    (definition?.kind === 'healing' && HEALING_AMOUNTS[itemId] !== undefined) ||
    (definition?.kind === 'utility' && UTILITY_EFFECTS[itemId] !== undefined)
  );
}
export interface HotbarSlot {
  readonly itemId: string | null;
  readonly instanceId: string | null;
  readonly item: ItemInstance | null;
}

/** Bind individual instances so consuming an item leaves its own shortcut empty. */
export class RaidHotbar {
  private raidId: string | null | undefined;
  private bindings: (string | null)[] = Array<string | null>(HOTBAR_SIZE).fill(null);
  private items: readonly ItemInstance[] = [];
  private seenInstanceIds = new Set<string>();
  selectedIndex = 0;

  sync(raidId: string | null, items: readonly ItemInstance[], primary?: ItemInstance): void {
    if (raidId !== this.raidId) {
      this.raidId = raidId;
      this.bindings.fill(null);
      this.seenInstanceIds.clear();
      this.selectedIndex = 0;
    }
    this.items = items;
    if (!raidId) return;
    const carriedIds = new Set(items.map((item) => item.instanceId));
    this.bindings = this.bindings.map((id) => (id && carriedIds.has(id) ? id : null));
    const candidates = [
      ...(primary ? [primary] : []),
      ...items.filter((item) => ITEM_DEFINITIONS[item.itemId]?.kind === 'weapon'),
      ...items,
    ];
    for (const item of candidates) {
      if (this.seenInstanceIds.has(item.instanceId) || !carriedIds.has(item.instanceId)) continue;
      this.seenInstanceIds.add(item.instanceId);
      if (!isHotbarItem(item.itemId)) continue;
      const index = this.bindings.indexOf(null);
      if (index >= 0) this.bindings[index] = item.instanceId;
    }
  }

  /** Empty positions are valid selections and represent empty hands. */
  select(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= HOTBAR_SIZE) return false;
    this.selectedIndex = index;
    return true;
  }

  /** Rebind shortcuts only; the original instances never leave the inventory. */
  assign(index: number, instanceId: string): boolean {
    const item = this.items.find((entry) => entry.instanceId === instanceId);
    if (
      !this.raidId ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= HOTBAR_SIZE ||
      !item ||
      !isHotbarItem(item.itemId)
    )
      return false;
    const previousIndex = this.bindings.indexOf(instanceId);
    if (previousIndex >= 0 && previousIndex !== index)
      this.bindings[previousIndex] = this.bindings[index] ?? null;
    this.bindings[index] = instanceId;
    return true;
  }

  slots(): readonly HotbarSlot[] {
    return this.bindings.map((id) => {
      const item = id ? (this.items.find((entry) => entry.instanceId === id) ?? null) : null;
      return { itemId: item?.itemId ?? null, instanceId: item?.instanceId ?? null, item };
    });
  }

  selected(): HotbarSlot {
    return this.slots()[this.selectedIndex]!;
  }
}
