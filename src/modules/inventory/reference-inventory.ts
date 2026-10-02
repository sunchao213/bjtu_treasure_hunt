import { EventBus } from '../../shared/events/game-events';
import type {
  ActionResult,
  InventoryPort,
  ItemDefinition,
  ItemInstance,
} from '../../shared/types/game';

/** Runnable B reference adapter. Production equipment/stacking remains B's responsibility. */
export class ReferenceInventory implements InventoryPort {
  private raidId = '';
  private items: ItemInstance[] = [];

  constructor(
    private readonly bus: EventBus,
    private readonly capacity: number,
    private readonly definitions: Readonly<Record<string, ItemDefinition>>,
  ) {}

  begin(raidId: string, loadout: readonly ItemInstance[]): void {
    if (loadout.length > this.capacity) {
      throw new Error('Loadout exceeds capacity');
    }
    this.raidId = raidId;
    this.items = structuredClone([...loadout]);
    this.changed();
  }

  getCarriedItems(): readonly ItemInstance[] {
    return structuredClone(this.items);
  }

  addLoot(item: ItemInstance): ActionResult {
    if (
      !this.definitions[item.itemId] ||
      (item.origin.kind === 'raid-loot' && item.origin.obtainedInRaidId !== this.raidId)
    ) {
      return { ok: false, error: 'INVALID_ITEM' };
    }
    if (this.items.some((owned) => owned.instanceId === item.instanceId)) {
      return { ok: false, error: 'INVALID_ITEM' };
    }
    if (this.items.length >= this.capacity) {
      return { ok: false, error: 'INVENTORY_FULL' };
    }
    this.items.push(structuredClone(item));
    this.changed();
    this.bus.emit('ItemPicked', { raidId: this.raidId, item: structuredClone(item) });
    return { ok: true, value: undefined };
  }

  remove(instanceId: string): ActionResult<ItemInstance> {
    const index = this.items.findIndex((item) => item.instanceId === instanceId);
    const item = this.items[index];
    if (!item) {
      return { ok: false, error: 'ITEM_NOT_FOUND' };
    }
    this.items.splice(index, 1);
    this.changed();
    return { ok: true, value: structuredClone(item) };
  }

  clear(): void {
    this.items = [];
    this.changed();
  }
  private changed(): void {
    this.bus.emit('InventoryChanged', { raidId: this.raidId });
  }
}
