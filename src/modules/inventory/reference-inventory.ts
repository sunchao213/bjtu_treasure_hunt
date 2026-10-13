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
  private readonly equipment = new Map<string, string>();

  constructor(
    private readonly bus: EventBus,
    private readonly capacity: number,
    private readonly definitions: Readonly<Record<string, ItemDefinition>>,
  ) {}

  begin(raidId: string, loadout: readonly ItemInstance[]): void {
    if (
      !raidId ||
      loadout.length > this.capacity ||
      new Set(loadout.map((item) => item.instanceId)).size !== loadout.length ||
      loadout.some((item) => !this.isValidItem(item, true) || item.origin.kind !== 'carry-in')
    ) {
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
    if (!this.isValidItem(item, false)) {
      return { ok: false, error: 'INVALID_ITEM' };
    }
    if (this.items.some((owned) => owned.instanceId === item.instanceId)) {
      return { ok: false, error: 'INVALID_ITEM' };
    }
    if (this.bagCount() >= this.capacity) {
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
    for (const [slotId, equippedId] of this.equipment) {
      if (equippedId === instanceId) {
        this.equipment.delete(slotId);
      }
    }
    this.changed();
    return { ok: true, value: structuredClone(item) };
  }

  equip(instanceId: string, slotId: string): ActionResult {
    const item = this.items.find((candidate) => candidate.instanceId === instanceId);
    if (!item || this.definitions[item.itemId]?.kind !== 'weapon' || !slotId.trim()) {
      return { ok: false, error: item ? 'ITEM_NOT_USABLE' : 'ITEM_NOT_FOUND' };
    }
    if ([...this.equipment.values()].includes(instanceId)) {
      return { ok: false, error: 'ITEM_ALREADY_EQUIPPED' };
    }
    if (this.equipment.has(slotId)) {
      return { ok: false, error: 'EQUIPMENT_SLOT_OCCUPIED' };
    }
    this.equipment.set(slotId, instanceId);
    this.changed();
    return { ok: true, value: undefined };
  }

  unequip(slotId: string): ActionResult<ItemInstance> {
    const instanceId = this.equipment.get(slotId);
    if (!instanceId) {
      return { ok: false, error: 'ITEM_NOT_FOUND' };
    }
    if (this.bagCount() >= this.capacity) {
      return { ok: false, error: 'BAG_FULL' };
    }
    const item = this.items.find((candidate) => candidate.instanceId === instanceId);
    if (!item) {
      return { ok: false, error: 'INVALID_ITEM' };
    }
    this.equipment.delete(slotId);
    this.changed();
    return { ok: true, value: structuredClone(item) };
  }

  getEquipment(): Readonly<Record<string, ItemInstance>> {
    return structuredClone(
      Object.fromEntries(
        [...this.equipment].flatMap(([slotId, instanceId]) => {
          const item = this.items.find((candidate) => candidate.instanceId === instanceId);
          return item ? [[slotId, item]] : [];
        }),
      ),
    );
  }

  /** Apply the effect first; consume only if the caller confirms it was applied. */
  consumeHealing(instanceId: string, applyEffect: () => boolean): ActionResult<ItemInstance> {
    const item = this.items.find((candidate) => candidate.instanceId === instanceId);
    if (!item) {
      return { ok: false, error: 'ITEM_NOT_FOUND' };
    }
    if (this.definitions[item.itemId]?.kind !== 'healing') {
      return { ok: false, error: 'ITEM_NOT_USABLE' };
    }
    if (!applyEffect()) {
      return { ok: false, error: 'INVALID_STATE' };
    }

    const removed = this.remove(instanceId);
    if (!removed.ok) {
      return removed;
    }
    this.bus.emit('ItemConsumed', { raidId: this.raidId, instanceId });
    return removed;
  }

  clear(): void {
    this.items = [];
    this.equipment.clear();
    this.changed();
  }
  private bagCount(): number {
    return this.items.length - this.equipment.size;
  }
  private isValidItem(item: ItemInstance, allowCarryIn: boolean): boolean {
    if (
      !item ||
      typeof item.instanceId !== 'string' ||
      !item.instanceId ||
      typeof item.itemId !== 'string' ||
      !this.definitions[item.itemId] ||
      !item.origin ||
      typeof item.origin !== 'object'
    ) {
      return false;
    }
    if (item.origin.kind === 'carry-in') {
      return allowCarryIn;
    }
    return (
      item.origin.kind === 'raid-loot' &&
      typeof item.origin.obtainedInRaidId === 'string' &&
      item.origin.obtainedInRaidId.length > 0 &&
      item.origin.obtainedInRaidId === this.raidId
    );
  }
  private changed(): void {
    this.bus.emit('InventoryChanged', { raidId: this.raidId });
  }
}
