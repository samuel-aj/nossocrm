import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Repo-specific ignores (generated/auxiliary code)
    "testsprite_tests/**",
    "tmp/**",
    "**/*.bak",

    // Build/runtime artifacts
    "public/sw.js",
  ]),

  // Scripts are CommonJS by design; allow require() there.
  {
    files: ["scripts/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // Project-level rule tuning: keep lint useful, but avoid blocking on high-noise rules.
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // Too noisy for this codebase right now; we enforce type safety via TS + runtime validation.
      // Keeping it enabled currently creates hundreds of warnings and blocks "zero-warning" workflows.
      '@typescript-eslint/no-explicit-any': 'off',

      // The codebase still has a large amount of legacy/merged code where unused vars
      // are common (especially in hooks and experimental modules). We keep this off
      // to preserve a "zero warnings" lint gate, and re-enable once the backlog is reduced.
      '@typescript-eslint/no-unused-vars': 'off',

      // Style/ergonomics rules: warnings only (should not block CI/dev loop).
      'prefer-const': 'warn',
      // Too pedantic for the current codebase (large JSX content with quotes).
      'react/no-unescaped-entities': 'off',

      // Prevent hook-order bugs (e.g. hook called after an early return).
      'react-hooks/rules-of-hooks': 'error',

      // React Compiler-specific rules (currently too disruptive for the project).
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      // React Compiler-specific rules: disabled until we adopt the compiler broadly.
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'warn',
      'react-hooks/incompatible-library': 'off',

      // Valid pattern in React; this rule creates lots of false positives in real apps.
      'react-hooks/set-state-in-effect': 'off',

      // This rule is great, but currently too noisy for this repo (many existing hook deps warnings).
      // We rely on code review + tests until we can clean it up and re-enable.
      'react-hooks/exhaustive-deps': 'off',
    },
  },

  // Pendências que surgiram com eslint-config-next 16.4 (eslint-plugin-react-hooks 7.1 e a regra nova
  // do @next/eslint-plugin-next). O código já existia assim; as regras continuam valendo no resto do
  // projeto. Remover cada arquivo desta lista quando ele for corrigido.
  {
    files: [
      "context/activities/ActivitiesContext.tsx",
      "features/deals/lead/DealStageControl.tsx",
      "features/deals/lead/LeadComposers.tsx",
      "features/deals/lead/LeadPropertiesPanel.tsx",
      "features/wa-agents/AgentTestChat.tsx",
      "features/whatsapp/WhatsAppPairingPanel.tsx",
    ],
    rules: {
      // Padrão "ref com o valor mais recente" (ref.current = x durante a renderização) e leitura de ref no render.
      "react-hooks/refs": "off",
    },
  },
  {
    files: [
      "app/(admin)/admin/page.tsx",
      "app/install/wizard/page.tsx",
      "app/select-org/page.tsx",
      "components/OrgSwitcher.tsx",
    ],
    rules: {
      // Recarga completa de propósito (troca de organização, instalador): não trocar por router.push sem revisar.
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
]);

export default eslintConfig;
