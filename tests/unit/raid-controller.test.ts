import { describe, expect, it } from 'vitest';
import { RAID_RULES, ITEM_DEFINITIONS } from '../../src/config/game-config';
import { EventBus } from '../../src/shared/events/game-events';
import { ReferenceInventory } from '../../src/modules/inventory/reference-inventory';
import { RaidController } from '../../src/modules/raid/raid-controller';
import type { ItemInstance, RaidResult, SavePort } from '../../src/shared/types/game';

const loot = (id: string, itemId = 'school-badge'): ItemInstance => ({
  instanceId: id,
  itemId,
  origin: { kind: 'raid-loot', obtainedInRaidId: 'raid-1' },
});
const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

async function setup(durationMs = 600_000, starterWeaponId?: string) {
  let now = 0;
  let rejectSave = false;
  const results: RaidResult[] = [];
  const events = new EventBus();
  const inventory = new ReferenceInventory(events, 6, ITEM_DEFINITIONS);
  const save: SavePort = {
    beginRaid: async () => [],
    finalizeRaid: async (result) => {
      if (rejectSave) {
        throw new Error('Quota');
      }
      results.push(result);
    },
  };
  const controller = new RaidController(
    inventory,
    save,
    events,
    { ...RAID_RULES, durationMs },
    ITEM_DEFINITIONS,
    () => now,
    () => 'raid-1',
  );
  await controller.start([], starterWeaponId);
  return {
    controller,
    inventory,
    events,
    results,
    advance(ms: number) {
      now += ms;
      controller.tick();
    },
    setFailure(value: boolean) {
      rejectSave = value;
    },
    fill() {
      for (let i = 0; i < 4; i++) {
        inventory.addLoot(loot(`loot-${i}`));
      }
    },
  };
}

describe('A extraction lifecycle', () => {
  it('pauses the raid clock for rules and requires a new extraction after resuming', async () => {
    const s = await setup();
    s.fill();
    s.controller.setExtractionPresence(true);
    s.controller.startExtraction();
    s.advance(4_000);
    s.controller.pause();
    s.controller.pause();
    const remaining = s.controller.getView().remainingMs;
    s.advance(700_000);
    expect(s.controller.getView().remainingMs).toBe(remaining);
    expect(s.controller.getView().phase).toBe('active');
    expect(s.controller.startExtraction().ok).toBe(false);
    s.controller.applyDamage(100);
    expect(s.controller.getView().health).toBe(100);
    expect(s.results).toHaveLength(0);
    s.controller.resume();
    s.controller.resume();
    expect(s.controller.getView().remainingMs).toBe(remaining);
    s.controller.startExtraction();
    s.advance(4_999);
    expect(s.results).toHaveLength(0);
    s.advance(1);
    await flush();
    expect(s.controller.getView().phase).toBe('success');
    expect(s.controller.prepareNext()).toBe(true);
    expect(s.controller.isPaused()).toBe(false);
  });

  it('adds a selected starter weapon to the raid inventory without requiring warehouse stock', async () => {
    const s = await setup(600_000, 'training-bat');
    expect(s.inventory.getCarriedItems()).toEqual([
      {
        instanceId: 'raid-1:starter:training-bat',
        itemId: 'training-bat',
        origin: { kind: 'carry-in' },
      },
    ]);
    s.fill();
    s.controller.setExtractionPresence(true);
    expect(s.controller.startExtraction().ok).toBe(true);
    s.advance(5_000);
    await flush();
    expect(s.results[0]?.items.some((item) => item.itemId === 'training-bat')).toBe(false);
  });

  it('rejects 95, rejects outside zone, and allows exactly 100', async () => {
    const s = await setup();
    s.inventory.addLoot(loot('epic', 'gpa-charm'));
    s.inventory.addLoot(loot('rare'));
    s.inventory.addLoot(loot('common', 'scratch-paper'));
    s.controller.setExtractionPresence(true);
    expect(s.controller.getView().value).toBe(95);
    expect(s.controller.startExtraction()).toEqual({ ok: false, error: 'VALUE_TOO_LOW' });
    s.inventory.clear();
    s.fill();
    s.controller.setExtractionPresence(false);
    expect(s.controller.startExtraction()).toEqual({ ok: false, error: 'NOT_IN_RANGE' });
    s.controller.setExtractionPresence(true);
    expect(s.controller.startExtraction().ok).toBe(true);
    s.advance(4_999);
    expect(s.results).toHaveLength(0);
    s.advance(1);
    await flush();
    expect(s.controller.getView().phase).toBe('success');
    expect(s.results[0]?.value).toBe(100);
  });

  it('cancels immediately when 110 drops to 85; restored eligibility needs a fresh 5 seconds', async () => {
    const s = await setup();
    s.inventory.addLoot(loot('epic', 'gpa-charm'));
    s.inventory.addLoot(loot('rare-1'));
    s.inventory.addLoot(loot('rare-2'));
    s.controller.setExtractionPresence(true);
    s.controller.startExtraction();
    s.advance(4_000);
    const removed = s.inventory.remove('rare-2');
    expect(s.controller.getView().phase).toBe('active');
    expect(s.controller.getView().value).toBe(85);
    if (removed.ok) {
      s.inventory.addLoot(removed.value);
    }
    s.advance(2_000);
    expect(s.results).toHaveLength(0);
    s.controller.startExtraction();
    s.advance(5_000);
    await flush();
    expect(s.results).toHaveLength(1);
  });

  it('counts only current-raid loot even when a valuable item is carried in', async () => {
    const s = await setup();
    s.inventory.begin('raid-1', [
      { instanceId: 'carried-key', itemId: 'siyuan-key', origin: { kind: 'carry-in' } },
    ]);
    s.inventory.addLoot(loot('rare-1'));
    s.inventory.addLoot(loot('rare-2'));
    s.inventory.addLoot(loot('rare-3'));
    s.inventory.addLoot(loot('rare-4'));
    expect(s.controller.getView().value).toBe(100);
    s.controller.setExtractionPresence(true);
    expect(s.controller.startExtraction().ok).toBe(true);
    s.advance(5_000);
    await flush();
    expect(s.results[0]?.value).toBe(100);
    expect(s.results[0]?.items).toHaveLength(5);
  });

  it('locks the value rules at controller construction', async () => {
    const rules = { ...RAID_RULES, values: { ...RAID_RULES.values } };
    const events = new EventBus();
    const inventory = new ReferenceInventory(events, 6, ITEM_DEFINITIONS);
    const results: RaidResult[] = [];
    const controller = new RaidController(
      inventory,
      {
        beginRaid: async () => [],
        finalizeRaid: async (result) => {
          results.push(result);
        },
      },
      events,
      rules,
      ITEM_DEFINITIONS,
      () => 0,
      () => 'snapshot-raid',
    );
    await controller.start();
    rules.values.uncommon = 1;
    inventory.addLoot({
      instanceId: 'loot',
      itemId: 'school-badge',
      origin: { kind: 'raid-loot', obtainedInRaidId: 'snapshot-raid' },
    });
    expect(controller.getView().value).toBe(25);
  });

  it.each(['damage', 'leave'] as const)('cancels on %s', async (cause) => {
    const s = await setup();
    s.fill();
    s.controller.setExtractionPresence(true);
    s.controller.startExtraction();
    s.advance(4_900);
    if (cause === 'damage') {
      s.controller.applyDamage(10);
    } else {
      s.controller.setExtractionPresence(false);
    }
    s.advance(1_000);
    expect(s.controller.getView().phase).toBe('active');
    expect(s.results).toHaveLength(0);
  });

  it('timeout wins at exactly the extraction completion boundary', async () => {
    const s = await setup(5_000);
    s.fill();
    s.controller.setExtractionPresence(true);
    s.controller.startExtraction();
    s.advance(5_000);
    await flush();
    expect(s.controller.getView().phase).toBe('failed');
    expect(s.results[0]?.reason).toBe('timeout');
    expect(s.results[0]?.items).toEqual([]);
  });

  it('death wins and terminal state only settles once', async () => {
    const s = await setup();
    s.fill();
    s.controller.setExtractionPresence(true);
    s.controller.startExtraction();
    s.controller.applyDamage(100);
    s.advance(10_000);
    s.controller.abandon();
    s.controller.applyDamage(100);
    await flush();
    expect(s.results).toHaveLength(1);
    expect(s.results[0]?.reason).toBe('death');
    expect(s.controller.prepareNext()).toBe(true);
    expect(s.inventory.getCarriedItems()).toHaveLength(0);
  });

  it('background elapsed time expires a run without simulating every frame', async () => {
    const s = await setup();
    s.advance(600_001);
    await flush();
    expect(s.results[0]?.reason).toBe('timeout');
  });

  it('freezes failed save, retries same result and publishes end once', async () => {
    const s = await setup();
    const emitted: RaidResult[] = [];
    s.events.on('RaidEnded', (result) => emitted.push(result));
    s.fill();
    s.controller.setExtractionPresence(true);
    s.controller.startExtraction();
    s.setFailure(true);
    s.advance(5_000);
    await flush();
    expect(s.controller.getView().phase).toBe('settling');
    expect(s.controller.getView().saveError).toBe(true);
    expect(emitted).toHaveLength(0);
    expect(s.controller.prepareNext()).toBe(false);
    s.inventory.clear();
    s.setFailure(false);
    s.advance(10_000);
    expect(s.controller.getView().value).toBe(100);
    expect(s.controller.getView().remainingMs).toBe(595_000);
    await s.controller.retrySettlement();
    await s.controller.retrySettlement();
    expect(s.results[0]?.items).toHaveLength(4);
    expect(s.results).toHaveLength(1);
    expect(emitted).toHaveLength(1);
    s.advance(20_000);
    expect(s.controller.getView().remainingMs).toBe(595_000);
  });

  it('does not start gameplay until begin persistence succeeds and blocks duplicate starts', async () => {
    let complete: ((items: readonly ItemInstance[]) => void) | undefined;
    const save: SavePort = {
      beginRaid: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      finalizeRaid: async () => {},
    };
    const events = new EventBus();
    const inventory = new ReferenceInventory(events, 6, ITEM_DEFINITIONS);
    const controller = new RaidController(inventory, save, events, RAID_RULES, ITEM_DEFINITIONS);
    const starting = controller.start();
    expect(controller.getView().phase).toBe('preparing');
    expect((await controller.start()).ok).toBe(false);
    complete?.([]);
    await starting;
    expect(controller.getView().phase).toBe('active');
  });

  it('reports begin save failure without moving into active', async () => {
    const events = new EventBus();
    const controller = new RaidController(
      new ReferenceInventory(events, 6, ITEM_DEFINITIONS),
      {
        beginRaid: async () => {
          throw new Error('Storage blocked');
        },
        finalizeRaid: async () => {},
      },
      events,
      RAID_RULES,
      ITEM_DEFINITIONS,
    );
    expect((await controller.start()).ok).toBe(false);
    expect(controller.getView().phase).toBe('preparing');
  });
});
