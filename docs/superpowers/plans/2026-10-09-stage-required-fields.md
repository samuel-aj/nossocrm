# Campos obrigatórios por etapa — Implementation Plan

**Goal:** Permitir configurar e preencher exigências por etapa pelo modo Automatizar, sem registrar uma movimentação incompleta.

**Architecture:** `BoardStage.requiredFields` persiste referências nativas/customizadas; um validador tipado atende a interface. Um provider de pendências no layout autenticado atende o hook central de movimentação. O banco valida a transição e uma RPC invoker salva pendências/produto/movimento atomicamente, preservando RLS e triggers atuais.

**Tech Stack:** Next.js, React, TanStack Query, Supabase/PostgreSQL, Vitest, PGlite.

## Execução na sessão atual

- [x] Modelo: criar `lib/deals/stageRequirements.ts` e testes para `getMissingStageFields(deal, stage, definitions)`, incluindo zero, arrays, origem desconhecida e campos apagados; adicionar `requiredFields?: string[]` a `types/types.ts`.
- [x] Persistência: propagar `required_fields` em todos os mapeamentos de etapas em `lib/supabase/boards.ts`. Criar migração pelo CLI: array vazio padrão, configuração administrativa, validação de transições e RPC de preenchimento + movimento. Sem atualização de leads existentes.
- [x] Banco: usar fixture PostgreSQL isolada em `scripts/test-stage-requirements-db.mjs`; testar rejeição de pendências, rollback do produto, mudança concorrente, zero válido, isolamento de organização e regras independentes.
- [x] Configuração: criar `features/boards/requirements/StageSettingsModal.tsx` com o editor integrado; conectar `AutomationLayer.tsx` e `KanbanBoard.tsx` através de `onEditStage`, disponível somente no modo Automatizar. Preservar campos de regras no editor legado do funil.
- [x] Preenchimento: criar provider/modal em `features/boards/requirements/StageRequirementsProvider.tsx`; formulário por tipo com Produto, Origem, Responsável e campos customizados. Não escrever antes de Salvar e mover; manter erro/formulário em caso de falha.
- [x] Movimento: integrar `useMoveDeal.ts`, adiando otimista/efeitos quando houver exigências. Cancelamento explícito sem toast de sucesso. Lotes sequenciais; reativação de inativos somente após sucesso. Mesmos caches `DEALS_VIEW_KEY` e detalhe.
- [x] Validação: testes direcionados de editor/modal/hook, regressões existentes de ganho/perda, typecheck, lint dos arquivos, build. Conferir visual local e acesso pelo botão Automatizar.
- [x] Entrega: documentar resultado, limitações e necessidade de aplicar migração na publicação; não publicar sem solicitação para esta funcionalidade.

Comandos: `npx vitest run lib/deals/stageRequirements.test.ts features/boards/requirements lib/query/hooks/useMoveDeal*.test.*`; `node scripts/test-stage-requirements-db.mjs <pglite-module>`; `npm run typecheck`; `npx eslint <arquivos alterados> --max-warnings 0`; `npm run build -- --webpack` (checkout Windows com node_modules compartilhado).
