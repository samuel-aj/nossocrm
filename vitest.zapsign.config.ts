import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    environment: 'node',
    include: ['app/api/integrations/zapsign/settings/route.test.ts', 'lib/zapsign/*.test.ts'],
    // No global integration setup, credentials, real API calls or DB cleanup.
    setupFiles: ['test/setup.zapsign.ts'],
  },
});
