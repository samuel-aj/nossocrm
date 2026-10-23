# Lead Alert Colors Implementation Plan

**Goal:** Aplicar o significado visual aprovado para alertas comuns e pausa da IA nos quatro locais do CRM.

**Architecture:** Alerta comum e bloqueio de consumo são estados independentes. Projetar bloqueios existentes em lote, reutilizando visibilidade das conversas; preservar caches de deals e filtro de automações. Usar componente de sinalização lavanda compartilhado.

**Tech Stack:** Next.js, React, TanStack Query, Supabase, Vitest offline.

## Contrato compartilhado

```ts
export type UsageBlock = { conversationId: string; blockedAt: string; reason: string | null };
export type UsageBlockMap = Record<string, UsageBlock>;
// Board response: { automations, usageBlocks: UsageBlockMap }, keyed by deal.
// Conversations response row: usage_block?: UsageBlock | null.
// Ordinary alert: optional tone: 'green' | 'red', default green.
```

## Tarefas e donos

- [ ] Root cria lib/ai-usage/alerts.ts e features/ai-usage/UsageBlockBadge.tsx; labels distinguem quota de consumo desconhecido. Aplica lavanda em ConversationBudget e categoria explícita ai_usage no feed/sino/toast; mensagens verdes e alertas comuns conforme tone.
- [ ] Worker board cria loader server-only lib/ai-usage/loadUsageBlocks.ts com paginação/identidades canônicas, sem escritas. Integra lib/boards/loadAutomationState.ts, API automation-state, hook/context e DealCard/KanbanList. Integra API de conversations com mesmo loader após filtro de visibilidade. Em falha da projeção adicional preserva leitura de mensagens e sinaliza indisponibilidade.
- [ ] Worker alerta comum propaga tone opcional no bloco, tipos/serialização/bot/RPC, evento e DealAlertBadge; mantém verde por omissão e compatibilidade do RPC antigo. Migração nova por CLI, somente aditiva; nenhum deploy/aplicação remota. Não editar DealCard/KanbanList (worker board usa tone).
- [ ] Root integra a projeção na lista de chats e agrupamento dos números, invalida projeção do board após grant e cria prévia visual local usando componentes reais com dados fictícios.
- [ ] Validar testes significativos: ACL/organização, bloqueios canônicos, ausência de falso alerta em pausa humana, mapeamento explícito antes de contato, alerta normal e IA simultâneos, serialização retrocompatível, grant sem retomada, formulário verde/vermelho.
- [ ] Rodar Vitest com test/ai-usage/vitest.config.ts (nunca setup remoto genérico), SQL em PGlite se houver migration, TypeScript, lint dos arquivos alterados, build. Conferir prévia desktop/mobile/tema escuro com dados locais.
- [ ] Revisar diff e preservar tmp/privado. Registrar estado e disponibilizar prévia; sem mensagem real e sem alterar produção neste escopo.

## Comandos de validação

```powershell
npx vitest run --config test/ai-usage/vitest.config.ts lib/ai-usage lib/notifications lib/boards features/ai-usage features/boards features/chats features/wa-agents/canvas app/api/ai-usage app/api/deals/automation-state
npm run typecheck
npm run build
git diff --check
```

Revisão: todas as superfícies aprovadas têm dono. Dados da IA não entram em active_alert. Não há tarefa para enviar mensagens, conceder saldo real ou retomar clientes.
