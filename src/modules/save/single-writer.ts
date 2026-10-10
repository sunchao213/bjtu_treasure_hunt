/** E/B seam: fail closed if another tab owns the save or the browser lacks Web Locks. */
export async function acquireSaveLock(): Promise<(() => void) | null> {
  if (!navigator.locks) {
    throw new Error(
      '存档需要安全连接和 Web Locks：请通过 localhost 或 HTTPS，在较新的 Chrome、Edge 或 Safari 中打开；微信内打不开时请改用系统浏览器。',
    );
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
