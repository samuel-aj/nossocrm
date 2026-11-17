import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Robôs (motor e quadro) sem banco real: nada de limpeza de fixtures nem .env.local.
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['test/setup.zapsign.ts'],
    include: ['lib/wa-agents/botsEngine.test.ts', 'features/wa-agents/canvas/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
