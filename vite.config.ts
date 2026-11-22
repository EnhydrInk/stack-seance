import { defineConfig } from 'vite';

// Served from the root of stack-seance.enhydrink.com.
export default defineConfig({
  base: '/',
  build: { outDir: 'dist' },
});
