import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./src/ui/renderer', import.meta.url)),
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('./dist/frontend', import.meta.url)),
    emptyOutDir: true,
    target: ['safari16', 'chrome109']
  }
});
