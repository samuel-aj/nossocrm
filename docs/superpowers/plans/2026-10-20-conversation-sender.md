# Conversation Sender Implementation Plan

**Goal:** Selecionar o remetente da conversa e confirmar a mudança antes de enviar.

**Architecture:** Um hook controla seleção, referência e autorização de uma tentativa. O chat usa a autorização em todos os envios e mantém snapshots imutáveis durante conversão de mídia. A sessão do compositor tem identidade por lead/contato/telefone/grupo/conexão.

**Tech Stack:** React 19, TypeScript, TanStack Query, Vitest, Testing Library.

## 1. Seleção e autorização

Arquivos: `features/whatsapp/useConversationSender.ts`, seu teste ao lado.

- [x] Selecionar conexão fixa, indicação explícita da conversa ou última mensagem válida, nessa ordem; ignorar preferência global.
- [x] Criar `authorize(): Promise<SenderPermit | null>`, `isCurrent(permit)`, `markSent(permit)`, `selectSender(id)`, `confirm()` e `cancel()`.
- [x] Expor remetente ativo e dados para o modal. Uma confirmação pendente resolve uma única vez; cancelar/navegar retorna null.
- [x] Testar dois contatos, preferência por recência, polling, número indisponível, ausência de histórico, confirmação/sucesso/falha, mudança durante autorização e desmontagem.

## 2. Integrar os envios

Arquivos: `features/whatsapp/DealWhatsAppChat.tsx`, `features/boards/components/Modals/DealDetailModal.tsx`.

- [x] Adicionar identidade da sessão do compositor; incluir ID do lead no card.
- [x] Substituir `wa-sender-connection` pelo hook.
- [x] Antes de limpar o rascunho, chamar `const permit = await sender.authorize(); if (!permit) return;`.
- [x] Após qualquer conversão assíncrona, exigir `sender.isCurrent(permit)`; enviar sempre `permit.sender.id`, nunca ler seleção mutável após await.
- [x] Em sucesso chamar `sender.markSent(permit)`; em erro restaurar rascunho somente na sessão original.
- [x] Usar ConfirmModal com os dois números e nome do contato; cancelamento mantém texto, anexo, áudio e modelo.

## 3. Validação e revisão

Arquivos: testes de integração do chat em `features/whatsapp/DealWhatsAppChat.sender.test.tsx`.

- [x] Exercitar texto, anexo, áudio e modelo com hook/API simulados; verificar ausência de envio antes de confirmar e envio único ao confirmar.
- [x] Cobrir cancelamento e navegação durante confirmação/conversão.
- [x] Rodar `node node_modules/vitest/vitest.mjs run --config tmp/sender-check/vitest.config.ts features/whatsapp features/chats features/boards/components/Modals/DealDetailModal.test.tsx` (configuração local sem credenciais e com rede bloqueada).
- [x] Rodar ESLint dos arquivos alterados, `npm run typecheck` e `npm run build`.
- [x] Revisar o diff, preservar o ajuste anterior de origem no relatório e informar resultado local.

Fluxo já escolhido pelo usuário; execução nesta sessão com delegação de hook/testes e revisão independente, sem nova rodada de aprovação ou envio real.

## Resultado — 2026-10-20

124 testes em 20 arquivos aprovados, incluindo 28 testes do hook e 17 de integração do compositor. ESLint sem avisos, typecheck, build de produção e diff check aprovados. Revisão independente concluída. Nenhuma mensagem real enviada; implementação local, sem publicação.
