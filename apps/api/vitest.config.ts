import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Veritabanı ve Redis isteyen testler ayrı çalışır: npm run test:int
    exclude: ['src/**/*.int.test.ts', 'node_modules/**'],
    environment: 'node',
  },
  // NestJS dependency injection needs decorator metadata, which esbuild does not emit.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
