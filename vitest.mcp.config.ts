import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// No shared fixture cleanup or real Supabase environment: this suite is entirely offline.
export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    environment: 'node', globals: true, setupFiles: ['test/mcp.setup.ts'],
    include: [
      'lib/mcp/**/*.test.ts', 'app/api/mcp/*.test.ts', 'lib/public-api/auth.test.ts',
      'app/api/api-keys/route.test.ts', 'features/settings/components/McpSection.access.test.tsx',
      'app/api/superadmin/operator-keys/route.test.ts', 'features/security/OperatorKeysPanel.test.tsx',
      'features/wa-agents/AgentEditor.squad.test.tsx',
      'lib/whatsapp/outbound.test.ts', 'lib/whatsapp/sendMessage.test.ts',
      'app/api/whatsapp/send/*.test.ts', 'app/api/public/v1/whatsapp/messages/*.test.ts',
      'lib/whatsapp/providers/*.test.ts', 'lib/whatsapp/sendWindow.test.ts',
    ],
    testTimeout: 30_000, hookTimeout: 30_000,
  },
});
