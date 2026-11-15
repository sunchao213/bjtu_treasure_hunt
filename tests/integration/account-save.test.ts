import { describe, expect, it } from 'vitest';
import { accountStorage } from '../../src/modules/save/account-storage';
import { FORMAL_SAVE_KEY, PersistentSave } from '../../src/modules/save/persistent-save';

describe('saves belong to the signed-in account', () => {
  it('isolates account progress and preserves the old shared save until explicitly migrated', () => {
    const data = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return data.size;
      },
      clear: () => data.clear(),
      key: (index) => [...data.keys()][index] ?? null,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    };
    const legacy = new PersistentSave(storage);
    legacy.beginRaid('old-raid', []);
    const original = storage.getItem(FORMAL_SAVE_KEY);
    const aliceStorage = accountStorage(storage, 'alice');
    const bobStorage = accountStorage(storage, 'bob');
    const alice = new PersistentSave(aliceStorage);
    const bob = new PersistentSave(bobStorage);
    expect(alice.view().activeRaid).toBeNull();
    expect(bob.view().activeRaid).toBeNull();

    alice.beginRaid('alice-raid', []);
    expect(new PersistentSave(aliceStorage).view().activeRaid?.raidId).toBe('alice-raid');
    expect(new PersistentSave(bobStorage).view().activeRaid).toBeNull();
    bob.beginRaid('bob-raid', []);
    aliceStorage.removeItem(FORMAL_SAVE_KEY);
    expect(new PersistentSave(bobStorage).view().activeRaid?.raidId).toBe('bob-raid');
    expect(storage.getItem(FORMAL_SAVE_KEY)).toBe(original);
  });
});
