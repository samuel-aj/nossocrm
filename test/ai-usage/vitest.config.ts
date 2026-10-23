import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
export default defineConfig({
  root,
  resolve: { alias: { '@': root } },
  test: {
    globals: true, environment: 'happy-dom',
    setupFiles: [resolve(__dirname, 'offline.ts'), resolve(root, 'test/setup.dom.ts')],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'dist', 'tmp'],
    testTimeout: 15000, hookTimeout: 15000,
  },
});
