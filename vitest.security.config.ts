import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Correções de segurança (auditoria de 23/11/2026) sem banco real: nada de
// limpeza de fixtures nem .env.local (o setup padrão aponta para produção).
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['test/setup.zapsign.ts', 'test/setup.dom.ts'],
    include: [
      'app/api/public/v1/docs/route.test.ts',
      'app/auth/callback/route.test.ts',
      'lib/public-api/orgRefs.test.ts',
      'lib/security/safeError.test.ts',
      'features/settings/components/LifecycleSettingsModal.test.tsx',
      'lib/security/auditLog.test.ts',
      'features/security/eventLabels.test.ts',
      'features/security/SecurityEventsPanel.test.tsx',
      'app/api/security/security.test.ts',
    ],
    testTimeout: 30_000,
  },
});
