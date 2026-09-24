# Participantes e menções de grupos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Entregar participantes e menções de grupos aprovado no staging.
**Architecture:** Estender o fluxo existente com módulos separados para dados, API e UI; preservar escopo da organização e comportamento anterior fora do pedido.
**Tech Stack:** Next.js16, React19, TypeScript5, Supabase, TanStack Query, Vitest.
**Spec:** docs/superpowers/specs/2026-09-23-crm-models-groups-tags-design.md (seção correspondente).

## Global Constraints
- Staging only. No real WhatsApp messages in tests.
- Next.js16/React19/TypeScript5; preserve existing UI patterns.
- Every resource is scoped by organization; only superadmin publishes global models.
- Canonical deal cache: [...queryKeys.deals.lists(), 'view'].
- No subagents from workers; controller handles review. Do not push or apply remote migrations.

### Task 1: Participantes e menções de grupos
**Files:** lib/whatsapp/groups.ts; lib/whatsapp/providers/{types,evolution,metaCloud}.ts; app/api/whatsapp/groups/participants/route.ts; app/api/whatsapp/send/route.ts; features/whatsapp/{DealWhatsAppChat,useWhatsAppChat}.tsx/ts; novo componente de participantes e menções.
**Interfaces:** Consumes existing org auth/helpers and canonical data entities. Produces the feature's authenticated API/UI and tests; preserve existing call signatures when extending.
**Requirements:** Verificar docs oficiais Evolution e Meta antes de implementar. Endpoint usa requireOrgUser e valida conversa visível/pertencente à org e conexão. Listar membros e resolver JID/LID/telefone sem heurística perigosa. Envio de menção valida membros no servidor. Painel título + busca + iniciar chat sem enviar. Composer @ suporta teclado, remove menções removidas do texto, mantém IDs e exibe nomes. Provedor não suportado mostra mensagem honesta. Testar isolamento, serialização real de payload, LID, tokenização, navegação e ausência de envio ao abrir chat.

- [ ] Read existing implementations and corresponding spec section; check AGENTS.md.
- [ ] Write behavioral regression tests for the cases named above, run focused Vitest to confirm failure before implementation.
- [ ] Implement API/domain/UI and additive migration using `supabase migration new` (available via npx CLI); run docs-required verification. Use separate files for normalization, dependency mapping, and UI when applicable.
- [ ] Run focused tests, TypeScript and changed-file ESLint; record exact commands and results in report.
- [ ] Self-review and commit only task files; write report with files, commit, test evidence, limitations. Controller reviews diff against requirements.
