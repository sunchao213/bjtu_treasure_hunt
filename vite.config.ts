import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Public files keep their names across releases. Bind their cache keys to their bytes,
// so an upgraded animation config cannot reuse an earlier sprite sheet from disk cache.
const assetRoot = fileURLToPath(new URL('./public/assets/', import.meta.url));
const assetHash = createHash('sha256');
for (const path of readdirSync(assetRoot, { recursive: true, encoding: 'utf8' }).sort()) {
  const absolute = join(assetRoot, path);
  if (statSync(absolute).isFile()) {
    assetHash.update(path.replaceAll('\\', '/')).update('\0').update(readFileSync(absolute));
  }
}

export default defineConfig({
  base: './',
  define: { __GAME_ASSET_VERSION__: JSON.stringify(assetHash.digest('hex').slice(0, 16)) },
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/artifacts/**'] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:5080', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:5080', ws: true, changeOrigin: false },
    },
  },
  preview: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:5080', changeOrigin: false },
      '/ws': { target: 'ws://127.0.0.1:5080', ws: true, changeOrigin: false },
    },
  },
  build: {
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
    chunkSizeWarningLimit: 1600,
  },
});
