import { defineConfig } from 'vite';
export default defineConfig({
  root: 'apps/web', envDir: '../..',
  build: { outDir: '../../out', emptyOutDir: true, sourcemap: false },
});
