# Alertas, sons e modelos com mídia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Tasks are sequential with independent review after each.

**Goal:** Entregar alertas visíveis de recuperação, sons configuráveis e templates Meta com mídia em staging.
**Architecture:** Estender engine/canvas e cache de deals existentes; persistir alertas/versionamento e eventos de notificação; manter mídia em storage restrito com geração de componentes Meta no servidor.
**Tech Stack:** Next.js, React, TypeScript, Supabase, Vitest.
**Spec:** docs/superpowers/specs/2026-09-24-alerts-sounds-media-design.md

## Global Constraints
- Organização sempre validada no servidor; referências de mídia e leads precisam pertencer ao tenant.
- One deals cache: `[...queryKeys.deals.lists(), 'view']`.
- Não enviar mensagens a clientes, não modificar robôs reais, não submeter templates à Meta no teste.
- Sem dependências novas sem necessidade; manter compatibilidade de preferências e templates existentes.
- Mudanças de banco em migration gerada com `supabase migration new`; controlador aplica em staging.
- Usar decisões do spec; não reiniciar brainstorming. Implementadores não delegam.

### Task 1: Sons e volume
**Files:** `lib/notifications/types.ts`, `lib/notifications/delivery.ts`, `components/notifications/NotificationPreferences.tsx`; testes junto a esses módulos.
**Interfaces:** Estender Preferences com `soundType: 'current'|'chime'|'alert'`, `volume: number` (0–100, default 40). `playNotificationSound(options?: Pick<Preferences,'soundType'|'volume'>): boolean`; chamadas usam preferências escolhidas. Zod usa defaults para não descartar preferências antigas.
- [ ] Testar preferências antigas com schema: `expect(PreferencesSchema.parse({...DEFAULT_PREFERENCES,volume:undefined,soundType:undefined})).toMatchObject({volume:40,soundType:'current'})`; áudio zero não cria oscilador; tipos diferentes geram sequências distintas.
- [ ] Implementar envelopes sem clipping, ganho controlado e som atual preservado no default; teste usa draft, não preferências salvas.
- [ ] Rodar Vitest dos módulos alterados, lint restrito, typecheck; corrigir erros introduzidos e registrar baseline separado.
- [ ] Commit e relatório com arquivos, comandos e resultados.

### Task 2: Bloco de alerta e board
**Files:** `lib/wa-agents/types.ts`, `lib/wa-agents/bots.ts`, `features/wa-agents/canvas/{types.ts,catalog.tsx,serialize.ts,BlockPanel.tsx,nodes.tsx}`, compatibilidade em `lib/wa-agents/botTemplates.ts`; `types/types.ts`, `lib/supabase/deals.ts`; cards/list e modal em `features/boards/components`; filtros/hooks existentes; `lib/notifications/{types.ts,server.ts}`; `components/notifications/NotificationPreferences.tsx`; nova migration e rota de reconhecimento com testes.
**Interfaces:** Persistir último alerta ativo no lead e histórico limitado ao evento em tabela dedicada ou histórico existente. Payload inclui ID imutável, texto, bot/run/block, created_at. Acknowledge recebe ID esperado e só limpa esse ID. Engine novo bloco `activate_alert` com `message`, caminho next convencional. Invariante: `ack(oldId)` nunca apaga `newId`. Notificação kind `alert`, opção Preferences `alerts` com default seguro para antigos; destinatário responsável autorizado.
- [ ] Testar serialização round-trip do novo bloco, template de robô portátil, retomada idempotente; lead de outra org rejeitado; abertura stale não remove novo alerta; abertura repetida não duplica histórico.
- [ ] Implementar persistência/RLS/permissões usando padrões existentes; eventos só inseridos após criação bem-sucedida, sem repetição na retomada.
- [ ] Implementar option 2: fundo/contorno verde, ícone e texto no card, preservando avisos atuais; list view e filtro Com alertas. Não limpar durante render/cache prefetch: reconhecer apenas abertura bem-sucedida do lead pelo usuário.
- [ ] Integrar notificações por responsável, mantendo testes e interfaces de sons da Task 1; aviso precisa funcionar sem `messages`/`leads` habilitados.
- [ ] Rodar testes direcionados, typecheck/lint; commit, relatório e migration para controlador.

### Task 3: Modelos com mídia (subprojeto independente)
**Files:** `features/settings/components/MessageTemplatesManager.tsx`, `lib/messageTemplates.ts`, `lib/whatsapp/templates.ts`, `app/api/message-templates/{route.ts,sync/route.ts,[id]/route.ts}`; nova rota/helper de upload e migration; `lib/wa-agents/bots.ts`, `app/api/whatsapp/send/route.ts`, seletor de templates/chat e provedores em `lib/whatsapp`.
**Interfaces:** header opcional com tipo image/video/document, storage path server-owned e referência de amostra Meta; nada de token no JSON cliente. Resolver components para envio compartilha entre chat/robô. Upload e criação separados; recusar objeto fora da org. Media faltante de importado deve ser resolvida por seleção de arquivo antes de enviar/ativar.
- [ ] Ler docs oficiais de criação de headers/upload resumable e envio da Meta, verificar provedores atuais; registrar limitações reais sem inventar suporte.
- [ ] Testar criação HEADER para tipos, text-only inalterado, envio mesmo header no chat/robô, sync preserva header; upload cross-tenant/MIME/tamanho rejeitado e URL maliciosa não é buscada.
- [ ] Implementar UI de upload/prévia e backend incluindo amostra para aprovação e header no envio. Validar formato/tamanho na UI e servidor; persistir referência do arquivo para não expirar após aprovação.
- [ ] Rodar testes/lint/typecheck; commit e relatório. Não chamar Meta para criar ou enviar template real.

### Task 4: Revisão e staging (controlador)
- [ ] Revisar cada task por agente independente, corrigir findings e revisar fixes; final whole-branch review.
- [ ] Build e testes relevantes; aplicar migrations staging, queries de verificação/RLS e browser funcional sem envio real.
- [ ] Push staging com base remota verificada para evitar sobrescrever trabalho; acompanhar deployment READY, verificar URLs e comunicar o que foi testado e limitações.
