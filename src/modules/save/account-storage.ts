/** Account ownership scopes both the save and the browser's single-writer lock. */
export function accountStorage(
  storage: Storage,
  userId: string,
): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const prefix = `bjtu-treasure-hunt:account:${userId}:`;
  return {
    getItem: (key) => storage.getItem(prefix + key),
    setItem: (key, value) => storage.setItem(prefix + key, value),
    removeItem: (key) => storage.removeItem(prefix + key),
  };
}
