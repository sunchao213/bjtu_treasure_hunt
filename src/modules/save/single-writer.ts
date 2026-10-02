/** E/B seam: fail closed if another tab owns the save or the browser lacks Web Locks. */
export async function acquireSaveLock(): Promise<(() => void) | null> {
  if (!navigator.locks) {
    throw new Error('请使用 localhost 或 HTTPS，并在较新的 Chrome / Edge 中打开。');
  }
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request('bjtu-treasure-hunt:a-framework', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(null);
          return;
        }
        await new Promise<void>((release) => {
          resolve(release);
        });
      })
      .catch(reject);
  });
}
