import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Entegrasyon testleri: gerçek PostgreSQL ve Redis ister (npm run infra:up, npm run db:migrate).
 * Bellek içi sahtelerin yakalayamadığı şeyleri sınar: SQL koşulları, eşzamanlı istekler, Redis betikleri.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    environment: 'node',
    // Dosyalar aynı veritabanını kullanır; her biri kendi tenant'ını açsa da sırayla çalışmaları logları okunur tutar.
    fileParallelism: false,
    testTimeout: 15_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
