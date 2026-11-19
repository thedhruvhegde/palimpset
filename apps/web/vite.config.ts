import { defineConfig } from 'vite';

// Relative base so the static build works on GitHub Pages under any repo path.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
});
