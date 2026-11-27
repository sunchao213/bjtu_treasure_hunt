import { describe, expect, it } from 'vitest';
import { FORMAL_SAVE_KEY, PersistentSave } from '../../src/modules/save/persistent-save';
import type { StoragePort } from '../../src/modules/save/reference-save';
import { WAREHOUSE_CAPACITY } from '../../src/config/game-config';
import type { ItemInstance, RaidResult } from '../../src/shared/types/game';

class MemoryStorage implements StoragePort {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const item = (instanceId: string, itemId = 'bandage'): ItemInstance => ({
  instanceId,
  itemId,
  origin: { kind: 'raid-loot', obtainedInRaidId: 'seed' },
});

/** 造一份「仓库已有 count 件」的 v4 存档并写盘 */
function seed(count: number, currency = 0): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem(
    FORMAL_SAVE_KEY,
    JSON.stringify({
      schemaVersion: 4,
      warehouse: Array.from({ length: count }, (_, index) => item(`seed-${index}`)),
      currency,
      codexIds: [],
      unlockedChapterIds: [],
      activeRaid: null,
      settledRaidIds: [],
      lastResult: null,
      mailbox: [],
    }),
  );
  return storage;
}

const success = (raidId: string, count: number): RaidResult => ({
  raidId,
  outcome: 'success',
  reason: null,
  items: Array.from({ length: count }, (_, index) => ({
    instanceId: `${raidId}-loot-${index}`,
    itemId: 'bandage',
    origin: { kind: 'raid-loot' as const, obtainedInRaidId: raidId },
  })),
  value: 100,
});

describe('warehouse capacity 100', () => {
  it('refuses to buy when the warehouse is full and does not charge', () => {
    const storage = seed(WAREHOUSE_CAPACITY, 500);
    const save = new PersistentSave(storage);
    expect(save.purchaseItem('bandage')).toEqual({ ok: false, error: 'WAREHOUSE_FULL' });
    expect(save.view().currency).toBe(500);
    expect(save.view().warehouse).toHaveLength(WAREHOUSE_CAPACITY);
  });

  it('still buys normally one slot below the cap', () => {
    const save = new PersistentSave(seed(WAREHOUSE_CAPACITY - 1, 500));
    const result = save.purchaseItem('bandage');
    expect(result.ok).toBe(true);
    expect(save.view().warehouse).toHaveLength(WAREHOUSE_CAPACITY);
    expect(save.view().currency).toBe(490);
  });

  it.each([
    ['training-bat', 10],
    ['stun-baton', 40],
    ['long-broom', 25],
  ])('buys %s, deducts its price and persists it in the warehouse', (itemId, price) => {
    const storage = seed(0, price);
    const save = new PersistentSave(storage);
    const result = save.purchaseItem(itemId);
    expect(result).toMatchObject({
      ok: true,
      value: { itemId, origin: { kind: 'carry-in', source: 'purchase' } },
    });
    expect(save.purchaseItem(itemId)).toEqual({ ok: false, error: 'INSUFFICIENT_FUNDS' });
    expect(new PersistentSave(storage).view()).toMatchObject({
      currency: 0,
      warehouse: [expect.objectContaining({ itemId })],
    });
  });

  it('routes duplicate collectibles that exceed capacity to the mailbox without paying currency', async () => {
    const save = new PersistentSave(seed(WAREHOUSE_CAPACITY - 2, 38));
    await save.beginRaid('overflow-raid', []);
    const extraction = success('overflow-raid', 5);
    await save.finalizeRaid({
      ...extraction,
      items: extraction.items.map((entry) => ({ ...entry, itemId: 'school-badge' })),
      value: 125,
    });

    const view = save.view();
    expect(view.warehouse).toHaveLength(WAREHOUSE_CAPACITY);
    expect(view.currency).toBe(38);
    expect(view.warehouse.slice(-2).map((entry) => entry.itemId)).toEqual([
      'school-badge',
      'school-badge',
    ]);
    expect(view.mailbox).toHaveLength(1);
    const mail = view.mailbox[0]!;
    expect(mail.attachments).toHaveLength(3);
    expect(mail.sourceRaidId).toBe('overflow-raid');
    expect(mail.attachments.map((entry) => entry.instanceId)).toEqual([
      'overflow-raid-loot-2',
      'overflow-raid-loot-3',
      'overflow-raid-loot-4',
    ]);
    // 仓库里不能同时出现信里的那些 instanceId
    const warehouseIds = new Set(view.warehouse.map((entry) => entry.instanceId));
    expect(mail.attachments.some((entry) => warehouseIds.has(entry.instanceId))).toBe(false);
  });

  it('writes no mail at all when everything fits', async () => {
    const save = new PersistentSave(seed(WAREHOUSE_CAPACITY - 5));
    await save.beginRaid('roomy-raid', []);
    await save.finalizeRaid(success('roomy-raid', 5));
    expect(save.view().warehouse).toHaveLength(WAREHOUSE_CAPACITY);
    expect(save.view().mailbox).toEqual([]);
  });

  it('claims only what fits and keeps the rest in the letter', () => {
    const storage = seed(WAREHOUSE_CAPACITY - 2);
    storage.setItem(
      FORMAL_SAVE_KEY,
      JSON.stringify({
        ...JSON.parse(storage.getItem(FORMAL_SAVE_KEY)!),
        mailbox: [
          {
            mailId: 'mail-a',
            title: '物资补发',
            body: '测试',
            createdAt: 1,
            attachments: [item('m1'), item('m2'), item('m3')],
          },
        ],
      }),
    );
    const save = new PersistentSave(storage);
    expect(save.claimMail('mail-a')).toEqual({ moved: 2, remaining: 1 });
    expect(save.view().warehouse).toHaveLength(WAREHOUSE_CAPACITY);
    expect(save.view().mailbox[0]!.attachments.map((entry) => entry.instanceId)).toEqual(['m3']);

    // 仓库满了以后再点，一件也领不走，但信不能丢
    expect(save.claimMail('mail-a')).toEqual({ moved: 0, remaining: 1 });
    expect(save.view().mailbox).toHaveLength(1);
  });

  it('deletes a letter once its attachments are all claimed', () => {
    const storage = seed(0);
    storage.setItem(
      FORMAL_SAVE_KEY,
      JSON.stringify({
        ...JSON.parse(storage.getItem(FORMAL_SAVE_KEY)!),
        mailbox: [
          {
            mailId: 'mail-b',
            title: '物资补发',
            body: '测试',
            createdAt: 1,
            attachments: [item('b1'), item('b2')],
          },
        ],
      }),
    );
    const save = new PersistentSave(storage);
    expect(save.claimMail(null)).toEqual({ moved: 2, remaining: 0 });
    expect(save.view().mailbox).toEqual([]);
    expect(save.view().warehouse.map((entry) => entry.instanceId)).toEqual(['b1', 'b2']);
    // 领完的信不能复活
    expect(save.claimMail(null)).toEqual({ moved: 0, remaining: 0 });
  });

  it('folds an over-capacity v3 save into warehouse + mailbox on migration', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      FORMAL_SAVE_KEY,
      JSON.stringify({
        schemaVersion: 3,
        warehouse: Array.from({ length: WAREHOUSE_CAPACITY + 7 }, (_, index) =>
          item(`legacy-${index}`),
        ),
        currency: 40,
        codexIds: [],
        unlockedChapterIds: [],
        activeRaid: null,
        settledRaidIds: [],
        lastResult: null,
      }),
    );
    const save = new PersistentSave(storage);
    const view = save.view();
    expect(view.schemaVersion).toBe(4);
    expect(view.warehouse).toHaveLength(WAREHOUSE_CAPACITY);
    expect(view.mailbox).toHaveLength(1);
    expect(view.mailbox[0]!.attachments).toHaveLength(7);
    expect(view.currency).toBe(40);
    // 迁移后的存档能再次通过校验并读回
    expect(new PersistentSave(storage).view().mailbox).toHaveLength(1);
  });

  it('rejects a v4 save whose mailbox duplicates a warehouse item', () => {
    const storage = seed(0);
    const raw = JSON.parse(storage.getItem(FORMAL_SAVE_KEY)!);
    raw.warehouse = [item('dup')];
    raw.mailbox = [
      {
        mailId: 'mail-c',
        title: '物资补发',
        body: '测试',
        createdAt: 1,
        attachments: [item('dup')],
      },
    ];
    storage.setItem(FORMAL_SAVE_KEY, JSON.stringify(raw));
    expect(() => new PersistentSave(storage)).toThrow(/corrupt|unsupported/);
  });
});
