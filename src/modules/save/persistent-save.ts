import { occupiedSlots } from '../inventory/inventory-sections';
import {
  isCarryInAllowed,
  isExplorationItem,
  ITEM_DEFINITIONS,
  RAID_RULES,
  WAREHOUSE_CAPACITY,
} from '../../config/game-config';
import type {
  ItemInstance,
  MailClaimResult,
  MailItem,
  RaidResult,
  SavePort,
} from '../../shared/types/game';
import { SAVE_KEY, type SaveData, type StoragePort } from './reference-save';
import { activeQuestChapter, chapterUnlockGranted } from '../quests/quest-service';
import { retainSettlementItems } from './settlement-retention';
import { migrateRetiredItems } from './retired-items';

// Keep the storage key stable so existing browsers can migrate in place.
export const FORMAL_SAVE_KEY = 'bjtu-treasure-hunt:save:v2';
export const FORMAL_SCHEMA_VERSION = 4 as const;
export const DEFAULT_SKIN_ID = 'school-uniform';
const WARDROBE_SKIN_PRICE = 688;
export const SKIN_DEFINITIONS = [
  { id: DEFAULT_SKIN_ID, name: '默认校服', price: 0 },
  { id: 'red-trailblazer', name: '赤焰探险少女', price: WARDROBE_SKIN_PRICE },
  { id: 'lavender-mage', name: '星灯魔法师', price: WARDROBE_SKIN_PRICE },
  { id: 'navy-adventurer', name: '金纹探险家', price: WARDROBE_SKIN_PRICE },
  { id: 'silver-researcher', name: '银发研究员', price: WARDROBE_SKIN_PRICE },
  { id: 'lab-scientist', name: '白袍研究员', price: WARDROBE_SKIN_PRICE },
  { id: 'orange-rescuer', name: '橙焰救援员', price: WARDROBE_SKIN_PRICE },
] as const;
export type SkinId = (typeof SKIN_DEFINITIONS)[number]['id'];

export interface FormalSaveData {
  schemaVersion: typeof FORMAL_SCHEMA_VERSION;
  warehouse: ItemInstance[];
  currency: number;
  codexIds: string[];
  unlockedChapterIds: string[];
  activeRaid: { raidId: string; loadout: ItemInstance[] } | null;
  settledRaidIds: string[];
  lastResult: RaidResult | null;
  /** 仓库爆仓后由信箱代管的补发物资；领完即整封删除 */
  mailbox: MailItem[];
  ownedSkinIds: SkinId[];
  equippedSkinId: SkinId;
  activeRaidSkinId: SkinId | null;
}

type PreviousSaveData = Omit<
  FormalSaveData,
  | 'schemaVersion'
  | 'activeRaid'
  | 'mailbox'
  | 'ownedSkinIds'
  | 'equippedSkinId'
  | 'activeRaidSkinId'
> & {
  schemaVersion: 1 | 2 | 3 | 4;
  activeRaid: { raidId: string; loadout?: ItemInstance[] } | null;
  mailbox?: MailItem[];
  ownedSkinIds?: SkinId[];
  equippedSkinId?: SkinId;
  activeRaidSkinId?: SkinId | null;
};

export type SaveImportResult = {
  readonly sourceSchemaVersion: number;
  readonly targetSchemaVersion: typeof FORMAL_SCHEMA_VERSION;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);
const uniqueStrings = (value: unknown): value is string[] =>
  strings(value) && new Set(value).size === value.length;
const failureReasons = new Set(['death', 'timeout', 'abandoned', 'interrupted']);

function validItem(value: unknown): value is ItemInstance {
  if (
    !record(value) ||
    typeof value.instanceId !== 'string' ||
    !value.instanceId ||
    typeof value.itemId !== 'string' ||
    !ITEM_DEFINITIONS[value.itemId] ||
    !record(value.origin)
  ) {
    return false;
  }
  return (
    value.origin.kind === 'carry-in' ||
    (value.origin.kind === 'raid-loot' &&
      typeof value.origin.obtainedInRaidId === 'string' &&
      value.origin.obtainedInRaidId.length > 0)
  );
}

function validResult(value: unknown): value is RaidResult {
  if (!record(value) || typeof value.raidId !== 'string' || !value.raidId) {
    return false;
  }
  const validOutcome =
    (value.outcome === 'success' && value.reason === null) ||
    (value.outcome === 'failed' &&
      typeof value.reason === 'string' &&
      failureReasons.has(value.reason));
  return (
    validOutcome &&
    Array.isArray(value.items) &&
    value.items.every(validItem) &&
    typeof value.value === 'number' &&
    Number.isSafeInteger(value.value) &&
    value.value >= 0 &&
    (value.questComplete === undefined || typeof value.questComplete === 'boolean')
  );
}

function validSettlementResult(result: RaidResult, loadout: readonly ItemInstance[]): boolean {
  if (!validResult(result)) {
    return false;
  }
  const ids = new Set(result.items.map((item) => item.instanceId));
  if (ids.size !== result.items.length) {
    return false;
  }
  if (result.outcome === 'failed') {
    return result.items.length === 0;
  }
  return result.items.every((item) =>
    item.origin.kind === 'carry-in'
      ? loadout.some(
          (entry) => entry.instanceId === item.instanceId && entry.itemId === item.itemId,
        )
      : item.origin.obtainedInRaidId === result.raidId &&
        !loadout.some((entry) => entry.instanceId === item.instanceId),
  );
}

function validMail(value: unknown): value is MailItem {
  return (
    record(value) &&
    typeof value.mailId === 'string' &&
    value.mailId.length > 0 &&
    typeof value.title === 'string' &&
    typeof value.body === 'string' &&
    typeof value.createdAt === 'number' &&
    Number.isSafeInteger(value.createdAt) &&
    (value.sourceRaidId === undefined ||
      (typeof value.sourceRaidId === 'string' && value.sourceRaidId.length > 0)) &&
    Array.isArray(value.attachments) &&
    value.attachments.length > 0 &&
    value.attachments.every(validItem)
  );
}

function isSkinId(value: unknown): value is SkinId {
  return SKIN_DEFINITIONS.some((skin) => skin.id === value);
}

function validData(value: unknown, version: 1 | 2 | 3 | 4): value is PreviousSaveData {
  if (
    !record(value) ||
    value.schemaVersion !== version ||
    !Array.isArray(value.warehouse) ||
    !value.warehouse.every(validItem) ||
    !uniqueStrings(value.codexIds) ||
    !uniqueStrings(value.unlockedChapterIds) ||
    !uniqueStrings(value.settledRaidIds) ||
    !(
      value.activeRaid === null ||
      (record(value.activeRaid) &&
        typeof value.activeRaid.raidId === 'string' &&
        value.activeRaid.raidId.length > 0 &&
        !value.settledRaidIds.includes(value.activeRaid.raidId))
    ) ||
    !(value.lastResult === null || validResult(value.lastResult))
  ) {
    return false;
  }
  // 硬上限只对 v4 起效：v3 及更早的存档可能已经超量，拦在校验层会让人打不开旧档，
  // 超量部分交给 migratePrevious 折进信箱。
  if (version === 4) {
    if (value.mailbox !== undefined && value.warehouse.length > WAREHOUSE_CAPACITY) return false;
    const mailbox = value.mailbox;
    if (
      mailbox !== undefined &&
      (!Array.isArray(mailbox) ||
        !mailbox.every(validMail) ||
        new Set(mailbox.map((mail) => mail.mailId)).size !== mailbox.length)
    ) {
      return false;
    }
    // 信箱与仓库共用 instanceId 空间：一件物品要么在仓库、要么在信里，不能两头都有
    const warehouseIds = new Set(value.warehouse.map((item) => item.instanceId as string));
    const mailIds = new Set<string>();
    for (const mail of mailbox ?? []) {
      for (const item of mail.attachments) {
        if (warehouseIds.has(item.instanceId) || mailIds.has(item.instanceId)) return false;
        mailIds.add(item.instanceId);
      }
    }
  } else if (
    value.mailbox !== undefined ||
    value.ownedSkinIds !== undefined ||
    value.equippedSkinId !== undefined ||
    value.activeRaidSkinId !== undefined
  ) {
    return false;
  }
  if (
    version === 4 &&
    (value.ownedSkinIds !== undefined ||
      value.equippedSkinId !== undefined ||
      value.activeRaidSkinId !== undefined) &&
    (!Array.isArray(value.ownedSkinIds) ||
      !value.ownedSkinIds.every(isSkinId) ||
      !value.ownedSkinIds.includes(DEFAULT_SKIN_ID) ||
      new Set(value.ownedSkinIds).size !== value.ownedSkinIds.length ||
      !isSkinId(value.equippedSkinId) ||
      !value.ownedSkinIds.includes(value.equippedSkinId) ||
      !(
        (value.activeRaidSkinId === null && value.activeRaid === null) ||
        (isSkinId(value.activeRaidSkinId) &&
          value.activeRaid !== null &&
          value.ownedSkinIds.includes(value.activeRaidSkinId))
      ))
  ) {
    return false;
  }
  if (
    value.currency !== undefined &&
    (!Number.isSafeInteger(value.currency) || Number(value.currency) < 0)
  ) {
    return false;
  }

  const warehouseIds = new Set(value.warehouse.map((item) => item.instanceId));
  if (warehouseIds.size !== value.warehouse.length) {
    return false;
  }
  if (version >= 3 && value.activeRaid !== null) {
    const loadout = value.activeRaid.loadout;
    if (
      !Array.isArray(loadout) ||
      loadout.length > RAID_RULES.bagCapacity ||
      !loadout.every(
        (item) =>
          validItem(item) && item.origin.kind === 'carry-in' && isCarryInAllowed(item.itemId),
      ) ||
      new Set(loadout.map((item) => item.instanceId)).size !== loadout.length ||
      loadout.some((item) => warehouseIds.has(item.instanceId))
    ) {
      return false;
    }
  }
  if (value.lastResult !== null && !value.settledRaidIds.includes(value.lastResult.raidId)) {
    return false;
  }
  if (value.lastResult !== null) {
    const lastResult = value.lastResult;
    const resultIds = new Set(lastResult.items.map((item) => item.instanceId));
    if (resultIds.size !== lastResult.items.length) {
      return false;
    }
    if (lastResult.outcome === 'failed' && lastResult.items.length > 0) {
      return false;
    }
    if (
      lastResult.outcome === 'success' &&
      !lastResult.items.every(
        (item) =>
          (version >= 3 && item.origin.kind === 'carry-in') ||
          (item.origin.kind === 'raid-loot' && item.origin.obtainedInRaidId === lastResult.raidId),
      )
    ) {
      return false;
    }
  }
  return true;
}

function decodeFormal(raw: string): { data: FormalSaveData; sourceSchemaVersion: number } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Formal save is not valid JSON; preserve the original before recovery.');
  }
  migrateRetiredItems(value);
  if (validData(value, FORMAL_SCHEMA_VERSION)) {
    return {
      data:
        value.mailbox !== undefined && value.ownedSkinIds !== undefined
          ? ({ ...structuredClone(value), currency: value.currency ?? 0 } as FormalSaveData)
          : migratePrevious(value),
      sourceSchemaVersion: FORMAL_SCHEMA_VERSION,
    };
  }
  if (validData(value, 3)) return { data: migratePrevious(value), sourceSchemaVersion: 3 };
  if (validData(value, 2)) {
    return { data: migratePrevious(value), sourceSchemaVersion: 2 };
  }
  throw new Error('Formal save is corrupt or uses an unsupported schema version.');
}

function decodeLegacy(raw: string): SaveData {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Reference save is not valid JSON; import was not performed.');
  }
  migrateRetiredItems(value);
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.warehouse) ||
    !value.warehouse.every(validItem) ||
    !uniqueStrings(value.codexIds) ||
    !uniqueStrings(value.unlockedChapterIds) ||
    !uniqueStrings(value.settledRaidIds) ||
    !(
      value.activeRaid === null ||
      (record(value.activeRaid) && typeof value.activeRaid.raidId === 'string')
    ) ||
    !(value.lastResult === null || validResult(value.lastResult))
  ) {
    throw new Error('Reference save is corrupt or not a supported v1 save.');
  }
  if (!validData(value, 1)) {
    throw new Error('Reference save violates formal save invariants; import was not performed.');
  }
  return value as unknown as SaveData;
}

function overflowMail(attachments: ItemInstance[], sourceRaidId?: string): MailItem {
  return {
    mailId: `mail:overflow:${crypto.randomUUID()}`,
    title: '物资补发',
    body: `本次撤离有 ${attachments.length} 件物资仓库放不下（上限 ${WAREHOUSE_CAPACITY} 格），暂时存放在思源信箱，腾出格子后再来领取。`,
    createdAt: Date.now(),
    ...(sourceRaidId ? { sourceRaidId } : {}),
    attachments,
  };
}

function migratePrevious(legacy: PreviousSaveData): FormalSaveData {
  // v3 及更早的存档没有上限，超量的部分不能凭空蒸发，折进信箱等玩家自己腾格子。
  const warehouse = structuredClone(legacy.warehouse);
  const overflow = warehouse.slice(WAREHOUSE_CAPACITY);
  warehouse.length = Math.min(warehouse.length, WAREHOUSE_CAPACITY);
  const migrated: FormalSaveData = {
    schemaVersion: FORMAL_SCHEMA_VERSION,
    warehouse,
    currency: typeof legacy.currency === 'number' ? legacy.currency : 0,
    codexIds: [...legacy.codexIds],
    unlockedChapterIds: [...legacy.unlockedChapterIds],
    activeRaid: null,
    settledRaidIds: [...legacy.settledRaidIds],
    lastResult: legacy.lastResult ? structuredClone(legacy.lastResult) : null,
    mailbox: structuredClone(legacy.mailbox ?? []),
    ownedSkinIds: legacy.ownedSkinIds ? [...legacy.ownedSkinIds] : [DEFAULT_SKIN_ID],
    equippedSkinId: legacy.equippedSkinId ?? DEFAULT_SKIN_ID,
    activeRaidSkinId: null,
  };
  if (overflow.length > 0) migrated.mailbox.push(overflowMail(overflow));
  // Old active raids have no trustworthy carry-in manifest; never guess returns.
  if ((legacy.schemaVersion === 3 || legacy.schemaVersion === 4) && legacy.activeRaid?.loadout) {
    migrated.activeRaid = {
      raidId: legacy.activeRaid.raidId,
      loadout: structuredClone(legacy.activeRaid.loadout),
    };
    migrated.activeRaidSkinId =
      legacy.schemaVersion === 4
        ? (legacy.activeRaidSkinId ?? migrated.equippedSkinId)
        : migrated.equippedSkinId;
  } else if (legacy.activeRaid) {
    migrated.settledRaidIds.push(legacy.activeRaid.raidId);
    migrated.lastResult = {
      raidId: legacy.activeRaid.raidId,
      outcome: 'failed',
      reason: 'interrupted',
      items: [],
      value: 0,
    };
  }
  return migrated;
}

/** Formal B persistence adapter. Writes are commit-after-storage and never mutate on failure. */
export class PersistentSave implements SavePort {
  private data: FormalSaveData;

  constructor(private readonly storage: StoragePort) {
    const raw = storage.getItem(FORMAL_SAVE_KEY);
    this.data = this.initial();
    if (raw !== null) {
      const decoded = decodeFormal(raw);
      if (decoded.sourceSchemaVersion !== FORMAL_SCHEMA_VERSION) {
        this.commit(decoded.data);
      } else {
        this.data = decoded.data;
      }
    }
  }

  view(): FormalSaveData {
    return structuredClone(this.data);
  }

  exportRaw(): string {
    return JSON.stringify(this.data);
  }

  importRaw(raw: string): SaveImportResult {
    const decoded = decodeFormal(raw);
    this.commit(decoded.data);
    return {
      sourceSchemaVersion: decoded.sourceSchemaVersion,
      targetSchemaVersion: FORMAL_SCHEMA_VERSION,
    };
  }

  /** Explicitly imports the legacy reference key and leaves that key untouched. */
  importReference(): SaveImportResult {
    if (this.storage.getItem(FORMAL_SAVE_KEY) !== null) {
      throw new Error('Formal save already exists; export or reset it before importing.');
    }
    const raw = this.storage.getItem(SAVE_KEY);
    if (raw === null) {
      throw new Error('No reference save exists to import.');
    }
    const migrated = migratePrevious(decodeLegacy(raw));
    this.commit(migrated);
    return { sourceSchemaVersion: 1, targetSchemaVersion: FORMAL_SCHEMA_VERSION };
  }

  recoverInterrupted(): boolean {
    const active = this.data.activeRaid;
    if (!active) {
      return false;
    }
    const next = this.view();
    next.activeRaid = null;
    next.activeRaidSkinId = null;
    next.settledRaidIds.push(active.raidId);
    next.lastResult = {
      raidId: active.raidId,
      outcome: 'failed',
      reason: 'interrupted',
      items: [],
      value: 0,
    };
    this.commit(next);
    return true;
  }

  async beginRaid(
    raidId: string,
    loadoutIds: readonly string[],
    reservedSlots = 0,
  ): Promise<readonly ItemInstance[]> {
    if (
      !raidId ||
      this.data.activeRaid ||
      this.data.settledRaidIds.includes(raidId) ||
      loadoutIds.length > RAID_RULES.bagCapacity ||
      new Set(loadoutIds).size !== loadoutIds.length
    ) {
      throw new Error('Cannot begin raid');
    }
    const loadout = loadoutIds.map((id) => {
      const item = this.data.warehouse.find((entry) => entry.instanceId === id);
      if (!item) {
        throw new Error('Missing loadout item');
      }
      if (!isCarryInAllowed(item.itemId)) {
        throw new Error('Quest items cannot be brought into a raid');
      }
      const source = item.origin.kind === 'carry-in' ? item.origin.source : undefined;
      const carrySource =
        source ?? (item.instanceId.startsWith('purchase:') ? 'purchase' : 'exploration');
      return {
        ...structuredClone(item),
        origin: { kind: 'carry-in' as const, source: carrySource },
      };
    });
    if (
      !Number.isSafeInteger(reservedSlots) ||
      reservedSlots < 0 ||
      occupiedSlots(loadout, ITEM_DEFINITIONS) + reservedSlots > RAID_RULES.bagCapacity
    )
      throw new Error('Loadout exceeds capacity');
    const next = this.view();
    next.warehouse = next.warehouse.filter((item) => !loadoutIds.includes(item.instanceId));
    next.activeRaid = { raidId, loadout: structuredClone(loadout) };
    next.activeRaidSkinId = this.data.equippedSkinId;
    this.commit(next);
    return loadout;
  }

  async finalizeRaid(result: RaidResult): Promise<void> {
    if (this.data.settledRaidIds.includes(result.raidId)) {
      return;
    }
    if (
      this.data.activeRaid?.raidId !== result.raidId ||
      !validSettlementResult(result, this.data.activeRaid.loadout)
    ) {
      throw new Error('Invalid settlement');
    }
    const next = this.view();
    if (result.outcome === 'success') {
      const warehouseIds = new Set(next.warehouse.map((item) => item.instanceId));
      for (const item of result.items) {
        if (warehouseIds.has(item.instanceId)) {
          throw new Error('Duplicate instance in settlement');
        }
        warehouseIds.add(item.instanceId);
        if (isExplorationItem(item) && !next.codexIds.includes(item.itemId)) {
          next.codexIds.push(item.itemId);
        }
      }
      const retained = retainSettlementItems(
        next.warehouse,
        result.items,
        next.currency,
        ITEM_DEFINITIONS,
        RAID_RULES.values,
      );
      // 重复收藏已在 retain 里折成交子，真正进仓的是 retained.warehouse 的尾部增量。
      // 超出 100 格的那部分原样进信箱，玩家腾出格子后自己领。
      const overflow = retained.warehouse.slice(WAREHOUSE_CAPACITY);
      retained.warehouse.length = Math.min(retained.warehouse.length, WAREHOUSE_CAPACITY);
      next.warehouse = retained.warehouse;
      next.currency = retained.currency;
      if (overflow.length > 0) next.mailbox.push(overflowMail(overflow, result.raidId));
    }
    next.activeRaid = null;
    next.activeRaidSkinId = null;
    next.settledRaidIds.push(result.raidId);
    next.lastResult = structuredClone(result);
    this.commit(next);
  }

  async unlockChapter(chapterId: string): Promise<void> {
    if (this.data.unlockedChapterIds.includes(chapterId)) return;
    const chapter = activeQuestChapter(this.data.unlockedChapterIds);
    if (
      chapter?.id !== chapterId ||
      !this.data.lastResult ||
      !chapterUnlockGranted(this.data.lastResult, chapterId)
    ) {
      throw new Error('Chapter unlock is not eligible');
    }
    const next = this.view();
    next.unlockedChapterIds.push(chapterId);
    this.commit(next);
  }

  reset(): void {
    this.commit({
      ...this.initial(),
      ownedSkinIds: [...this.data.ownedSkinIds],
      equippedSkinId: this.data.equippedSkinId,
    });
  }

  purchaseItem(
    itemId: string,
  ):
    | { ok: true; value: ItemInstance }
    | { ok: false; error: 'UNKNOWN_ITEM' | 'INSUFFICIENT_FUNDS' | 'WAREHOUSE_FULL' } {
    const definition = ITEM_DEFINITIONS[itemId];
    const price = definition?.price;
    if (!definition || price === undefined) return { ok: false, error: 'UNKNOWN_ITEM' };
    // 先判仓库再判钱：仓库满了就算有钱也不该扣款
    if (this.data.warehouse.length >= WAREHOUSE_CAPACITY)
      return { ok: false, error: 'WAREHOUSE_FULL' };
    if (this.data.currency < price) return { ok: false, error: 'INSUFFICIENT_FUNDS' };
    const item: ItemInstance = {
      instanceId: `purchase:${itemId}:${crypto.randomUUID()}`,
      itemId,
      origin: { kind: 'carry-in', source: 'purchase' },
    };
    const next = this.view();
    next.currency -= price;
    next.warehouse.push(item);
    this.commit(next);
    return { ok: true, value: structuredClone(item) };
  }

  purchaseSkin(skinId: string): { ok: boolean; owned: boolean } {
    const skin = SKIN_DEFINITIONS.find((entry) => entry.id === skinId);
    if (!skin || this.data.activeRaid) return { ok: false, owned: false };
    if (this.data.ownedSkinIds.includes(skin.id)) return { ok: true, owned: true };
    if (this.data.currency < skin.price) return { ok: false, owned: false };
    const next = this.view();
    next.currency -= skin.price;
    next.ownedSkinIds.push(skin.id);
    this.commit(next);
    return { ok: true, owned: true };
  }

  equipSkin(skinId: string): boolean {
    if (
      this.data.activeRaid ||
      !isSkinId(skinId) ||
      !this.data.ownedSkinIds.includes(skinId) ||
      this.data.equippedSkinId === skinId
    )
      return false;
    const next = this.view();
    next.equippedSkinId = skinId;
    this.commit(next);
    return true;
  }

  /**
   * 按实例顺序重排仓库（仓库界面拖拽互换落盘）。
   * 一格一件：传入的是 instanceId 列表；同 itemId 的实例可以拆开排在任意位置。
   * 未列出的实例按原顺序补在末尾，所以传入残缺的列表也不会丢物品。
   */
  reorderWarehouse(instanceIds: readonly string[]): void {
    const byId = new Map(this.data.warehouse.map((item) => [item.instanceId, item]));
    const seen = new Set<string>();
    const ordered: ItemInstance[] = [];
    for (const id of instanceIds) {
      const item = byId.get(id);
      if (!item) continue;
      ordered.push(item);
      seen.add(id);
    }
    for (const item of this.data.warehouse) {
      if (!seen.has(item.instanceId)) ordered.push(item);
    }
    if (
      ordered.every((item, index) => item.instanceId === this.data.warehouse[index]?.instanceId)
    ) {
      return;
    }
    const next = this.view();
    next.warehouse = structuredClone(ordered);
    this.commit(next);
  }

  /**
   * 领取信箱附件。仓库满时只放得下多少放多少，剩下的留在信里；
   * 领空的邮件整封删除（信箱只放补发物资，没有「已读存档」的概念）。
   * 传 null 表示「全部领取」，一次 commit 写完，不会一封信写一次盘。
   */
  claimMail(mailId: string | null): MailClaimResult {
    const next = this.view();
    let room = Math.max(0, WAREHOUSE_CAPACITY - next.warehouse.length);
    const pending = next.mailbox.reduce((sum, mail) => sum + mail.attachments.length, 0);
    if (room === 0 || pending === 0) return { moved: 0, remaining: pending };

    const targets =
      mailId === null ? next.mailbox : next.mailbox.filter((mail) => mail.mailId === mailId);
    if (targets.length === 0) return { moved: 0, remaining: pending };

    let moved = 0;
    const kept: MailItem[] = [];
    for (const mail of next.mailbox) {
      // 单封领取时，没点到的信原样留下
      if (mailId !== null && mail.mailId !== mailId) {
        kept.push(mail);
        continue;
      }
      const take = Math.min(room, mail.attachments.length);
      if (take > 0) {
        next.warehouse.push(...structuredClone(mail.attachments.slice(0, take)));
        room -= take;
        moved += take;
      }
      const left = mail.attachments.slice(take);
      if (left.length > 0) kept.push({ ...mail, attachments: left });
    }
    next.mailbox = kept;
    if (moved === 0) return { moved: 0, remaining: pending };
    this.commit(next);
    return { moved, remaining: pending - moved };
  }

  private commit(next: FormalSaveData): void {
    if (!validData(next, FORMAL_SCHEMA_VERSION)) {
      throw new Error('Refusing to commit invalid formal save data.');
    }
    this.storage.setItem(FORMAL_SAVE_KEY, JSON.stringify(next));
    this.data = structuredClone(next);
  }

  private initial(): FormalSaveData {
    return {
      schemaVersion: FORMAL_SCHEMA_VERSION,
      warehouse: [],
      currency: 0,
      codexIds: [],
      unlockedChapterIds: [],
      activeRaid: null,
      settledRaidIds: [],
      lastResult: null,
      mailbox: [],
      ownedSkinIds: [DEFAULT_SKIN_ID],
      equippedSkinId: DEFAULT_SKIN_ID,
      activeRaidSkinId: null,
    };
  }
}
