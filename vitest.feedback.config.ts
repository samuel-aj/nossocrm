import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Suíte offline da caixa de ajustes: não lê .env nem acessa o Supabase.
export default defineConfig({
  envDir: false,
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['test/setup.dom.ts'],
    include: [
      'lib/feedback/**/*.test.ts',
      'lib/ai/transcribeAudio.test.ts',
      'app/api/feedback/**/*.test.ts',
      'features/feedback/**/*.test.{ts,tsx}',
    ],
  },
});
