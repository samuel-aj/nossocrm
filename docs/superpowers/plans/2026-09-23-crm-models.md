# Biblioteca de modelos de robôs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Entregar biblioteca de modelos de robôs aprovado no staging.
**Architecture:** Estender o fluxo existente com módulos separados para dados, API e UI; preservar escopo da organização e comportamento anterior fora do pedido.
**Tech Stack:** Next.js16, React19, TypeScript5, Supabase, TanStack Query, Vitest.
**Spec:** docs/superpowers/specs/2026-09-23-crm-models-groups-tags-design.md (seção correspondente).

## Global Constraints
- Staging only. No real WhatsApp messages in tests.
- Next.js16/React19/TypeScript5; preserve existing UI patterns.
- Every resource is scoped by organization; only superadmin publishes global models.
- Canonical deal cache: [...queryKeys.deals.lists(), 'view'].
- No subagents from workers; controller handles review. Do not push or apply remote migrations.

### Task 1: Biblioteca de modelos de robôs
**Files:** features/wa-agents/BotList.tsx; features/wa-agents/BotEditor.tsx; novas unidades features/wa-agents/templates/* e lib/wa-agents/botTemplates*; app/api/wa-agents/bot-templates/*; migração supabase/migrations/*_bot_templates.sql.
**Interfaces:** Consumes existing org auth/helpers and canonical data entities. Produces the feature's authenticated API/UI and tests; preserve existing call signatures when extending.
**Requirements:** Implementar biblioteca e formato portável. Reusar BotInputSchema e validadores existentes, manter referência abstrata por dependência. API admin org-scoped, publicações só superadmin (verificar role real), importações validadas e cópias desligadas. UI escolhe modelo e reassocia recursos do destino. Guardar snapshots sanitizados, sem credenciais; ativação também verificada no servidor. Testar roundtrip com branches/layout, segredos removidos, isolamento, importação inválida, remapeamento em org diferente e guardas de ativação.

- [ ] Read existing implementations and corresponding spec section; check AGENTS.md.
- [ ] Write behavioral regression tests for the cases named above, run focused Vitest to confirm failure before implementation.
- [ ] Implement API/domain/UI and additive migration using `supabase migration new` (available via npx CLI); run docs-required verification. Use separate files for normalization, dependency mapping, and UI when applicable.
- [ ] Run focused tests, TypeScript and changed-file ESLint; record exact commands and results in report.
- [ ] Self-review and commit only task files; write report with files, commit, test evidence, limitations. Controller reviews diff against requirements.
