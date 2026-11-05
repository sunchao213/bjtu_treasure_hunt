import type { EventBus } from '../../shared/events/game-events';
import type {
  ActionResult,
  EquipmentSlot,
  InventoryClientPort,
  ItemDefinition,
  ItemInstance,
} from '../../shared/types/game';
import type { GameSnapshot } from '../../shared/net/protocol';
import type { GameSession } from './game-session';

/** Read-only client mirror. Inventory mutations are requests; the server snapshot is authoritative. */
export class OnlineInventory implements InventoryClientPort {
  private raidId = '';
  private carriedItems: readonly ItemInstance[] = [];

  constructor(
    private readonly bus: EventBus,
    private readonly session: GameSession,
    private readonly definitions: Readonly<Record<string, ItemDefinition>>,
  ) {}

  applySnapshot(snapshot: GameSnapshot): void {
    this.raidId = snapshot.raidId;
    this.carriedItems = structuredClone(snapshot.self.carriedItems);
    this.bus.emit('InventoryChanged', { raidId: this.raidId });
  }

  begin(raidId: string, loadout: readonly ItemInstance[]): void {
    this.raidId = raidId;
    this.carriedItems = structuredClone(loadout);
  }

  getCarriedItems(): readonly ItemInstance[] {
    return structuredClone(this.carriedItems);
  }

  getEquipment(): Readonly<Partial<Record<EquipmentSlot, ItemInstance>>> {
    // The authoritative snapshot protocol does not expose equipment yet.
    return {};
  }

  equip(instanceId: string, slotId: EquipmentSlot): ActionResult {
    void instanceId;
    void slotId;
    return { ok: false, error: 'INVALID_STATE' };
  }

  unequip(slotId: EquipmentSlot): ActionResult<ItemInstance> {
    void slotId;
    return { ok: false, error: 'INVALID_STATE' };
  }

  addLoot(item: ItemInstance): ActionResult {
    void item;
    return { ok: false, error: 'INVALID_STATE' };
  }

  remove(instanceId: string): ActionResult<ItemInstance> {
    const item = this.carriedItems.find((candidate) => candidate.instanceId === instanceId);
    if (!item) return { ok: false, error: 'ITEM_NOT_FOUND' };
    if (!this.session.requestAction('drop-item', instanceId)) {
      return { ok: false, error: 'INVALID_STATE' };
    }
    return { ok: true, value: structuredClone(item) };
  }

  consumeHealing(instanceId: string, applyEffect: () => boolean): ActionResult<ItemInstance> {
    void applyEffect;
    const item = this.carriedItems.find((candidate) => candidate.instanceId === instanceId);
    if (!item) return { ok: false, error: 'ITEM_NOT_FOUND' };
    if (this.definitions[item.itemId]?.kind !== 'healing') {
      return { ok: false, error: 'ITEM_NOT_USABLE' };
    }
    if (!this.session.requestAction('use-item', instanceId)) {
      return { ok: false, error: 'INVALID_STATE' };
    }
    return { ok: true, value: structuredClone(item) };
  }

  consumeUtility(instanceId: string, applyEffect: () => boolean): ActionResult<ItemInstance> {
    void applyEffect;
    const item = this.carriedItems.find((candidate) => candidate.instanceId === instanceId);
    if (!item) return { ok: false, error: 'ITEM_NOT_FOUND' };
    if (this.definitions[item.itemId]?.kind !== 'utility') {
      return { ok: false, error: 'ITEM_NOT_USABLE' };
    }
    if (!this.session.requestAction('use-item', instanceId)) {
      return { ok: false, error: 'INVALID_STATE' };
    }
    return { ok: true, value: structuredClone(item) };
  }

  clear(): void {
    this.carriedItems = [];
    this.bus.emit('InventoryChanged', { raidId: this.raidId });
  }
}
