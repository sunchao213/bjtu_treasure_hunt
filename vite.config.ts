import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
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
