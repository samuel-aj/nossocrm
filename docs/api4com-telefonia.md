# API4com (telefonia) no NossoCRM

Ligar para o lead com um clique e registrar a ligação (resultado, duração e gravação) no histórico.

Branch `feat/api4com`, preview `staging`. **Não está em produção.**

## Como funciona

- A API4com tem **token e ramal por usuário**. Cada pessoa conecta o próprio token em **Configurações > Geral > Telefonia (API4com)**. O admin vê quem já conectou em **Configurações > Integrações > API4com**.
- Ao conectar, o CRM valida o token (`GET /users/me`), descobre o ramal (`GET /integrations?filter[where][gateway]=sippulse`, campo `metadata.username`) e cadastra o retorno (`PATCH /integrations` com `gateway: "nossocrm"`, `webhookConstraint.metadata.gateway: "nossocrm"`, `webhookVersion: "v1.8"`, tipos `channel-answer` e `channel-hangup`).
- O botão **Ligar** aparece ao lado do telefone do contato, na tela do lead, só para quem conectou.
- Clique: o CRM grava a ligação em `api4com_calls` e chama `POST /calls` com o ramal da pessoa. A API4com toca primeiro no **Webphone** dela (extensão do Chrome); quando ela atende, disca para o cliente. A resposta só vem depois disso (até ~90 s).
- O retorno chega em `/api/integrations/api4com/webhook/[orgId]/[segredo]`. O segredo é por usuário e vai na URL, porque a API4com não manda cabeçalho próprio. Dedupe por `id da chamada + tipo`. No `channel-hangup` o histórico do lead ganha um evento `call` em nome de quem ligou, com resultado, duração e link da gravação.
- Só ligações feitas pelo CRM chegam (filtro pelo `metadata.gateway`). As feitas direto no Webphone ficam só na API4com.

## Arquivos

- Banco: `supabase/migrations/20261103120000_api4com_integration.sql` (tabelas `api4com_user_settings`, `api4com_calls`, `api4com_webhook_events`). Nada existente muda.
- Servidor: `lib/api4com/client.ts` (HTTP), `lib/api4com/calls.ts` (conectar, ligar, desligar, webhook), `lib/api4com/shared.ts` (resultado e rótulos).
- Rotas: `app/api/integrations/api4com/me` (GET/PUT/DELETE da própria conexão), `team` (admin), `calls` (POST ligar), `calls/[callId]` (GET estado), `calls/[callId]/hangup`, `webhook/[orgId]/[secret]`.
- Telas: `features/settings/components/Api4comSection.tsx`, `features/api4com/CallButton.tsx`, caso `call` em `features/deals/lead/LeadTimeline.tsx`.
- Testes: `lib/api4com/calls.test.ts`, `features/api4com/CallButton.test.tsx`.

## Para testar no preview

1. Aplicar a migração no banco de **staging** pelo SQL Editor (o MCP recusou DDL).
2. Ter um usuário com plano e ramal na API4com e o Webphone aberto no Chrome.
3. Configurações > Geral > Telefonia (API4com): colar o token de acesso (sem expiração).
4. Abrir um lead com telefone e clicar em Ligar.

## Pendências conhecidas

- O formato exato da lista de `GET /integrations` (array puro ou `{data: [...]}`) não está documentado; o cliente aceita os dois. Confirmar no primeiro teste real.
- Os horários do webhook vêm sem fuso; o CRM usa o relógio dele na chegada de cada aviso e a duração informada pela API4com.
- Sem o webhook (cadastro falhou ou aviso perdido), a ligação fica "em andamento" na tela até 2 h; consultar `GET /calls` para reconciliar fica para uma próxima etapa.
