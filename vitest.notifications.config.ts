import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  envDir: false,
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['test/setup.zapsign.ts', 'test/setup.dom.ts', 'test/setup.notifications.ts'],
    include: [
      'lib/notifications/**/*.test.ts',
      'components/notifications/**/*.test.{ts,tsx}',
      'components/pwa/serviceWorker.test.ts',
      'context/AuthContext.test.tsx',
      'app/api/notifications/**/route.test.ts',
      'test/*push*.test.ts',
    ],
  },
});
