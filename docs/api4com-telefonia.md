# API4com (telefonia) no NossoCRM

Ligar para o lead com um clique e registrar a ligação (resultado, duração e gravação) no histórico.

Branch `feat/api4com`, preview `staging`. **Não está em produção.**

## Como funciona

- A API4com tem **token e ramal por usuário**. Cada pessoa conecta o próprio token em **Configurações > Geral > Telefonia (API4com)**. O admin vê quem já conectou em **Configurações > Integrações > API4com**.
- Ao conectar, o CRM valida o token (`GET /users/me`), descobre o ramal (`GET /integrations?filter[where][gateway]=sippulse`, campo `metadata.username`) e cadastra o retorno (`PATCH /integrations` com `gateway: "nossocrm"`, `webhookConstraint.metadata.gateway: "nossocrm"`, `webhookVersion: "v1.8"`, tipos `channel-answer` e `channel-hangup`).
- O botão **Ligar** fica no topo da conversa do lead, ao lado de IA Insights, só para quem conectou.
- **Telefone embutido** (sem Webphone nem extensão; doc da API4com "Integração utilizando Webphone próprio"): o navegador registra o ramal da pessoa na central por SIP sobre WebSocket (`wss://<domínio>:6443`, biblioteca JsSIP) e fala por WebRTC. Ramal, senha e domínio vêm de `GET /integrations?filter[where][gateway]=sippulse` (campos `username`, `password`, `domain`), lidos na hora pela rota `POST /api/integrations/api4com/sip` com o token da pessoa; a senha não fica no banco.
- Clique: o telefone liga (pede o microfone na primeira vez), o CRM grava a ligação em `api4com_calls` e chama `POST /calls` com o ramal. A central toca primeiro no ramal com o cabeçalho `X-Api4comintegratedcall: true`; o telefone do CRM atende sozinho e a central disca para o cliente. Chamada que chega sem esse cabeçalho toca na tela (Atender ou Recusar).
- O telefone vive no layout da área logada (`features/api4com/phone/Api4comPhoneProvider.tsx`): navegar não derruba a ligação; recarregar derruba (aviso antes de sair). Uma aba só fica com o ramal (`navigator.locks` + `BroadcastChannel`); clicar em Ligar em outra aba traz o telefone para ela. Religa sozinho ao abrir o CRM se a pessoa deixou ligado e o microfone já está liberado.
- Janela da ligação (`PhoneDock`, estilo popup de chamada): no computador fica no canto inferior esquerdo; no celular, no topo. Nome, andamento e tempo, botão **Encerrar** e controles redondos: Microfone (mudo), Teclado (DTMF RFC 2833), Áudio (microfone, saída de som e volume, lembrados no navegador) e Lead (abre o lead). Depois, o resultado.
- **Encerrar vale na hora**: a tela passa para "Ligação encerrada" no clique, o CRM pede à central para derrubar a ligação inteira (`POST /calls/{id}/hangup`) e encerra o áudio local. Não espera o webhook: o resultado entra quando ele chega (consulta a cada 1,2 s por até 20 s). Motivo: o JsSIP adia o BYE de uma chamada recebida até chegar o ACK da central, e a tela antiga esperava o webhook, então a pessoa clicava várias vezes.
- O aviso da API4com traz o token da pessoa em `metadata.api4comAccessToken`; a cópia guardada em `api4com_webhook_events` sai sem ele (`redactWebhookPayload`).
- O retorno chega em `/api/integrations/api4com/webhook/[orgId]/[segredo]`. O segredo é por usuário e vai na URL, porque a API4com não manda cabeçalho próprio. Dedupe por `id da chamada + tipo`. No `channel-hangup` o histórico do lead ganha um evento `call` em nome de quem ligou, com resultado, duração e link da gravação.
- Só ligações feitas pelo CRM chegam (filtro pelo `metadata.gateway`). As feitas direto no Webphone ficam só na API4com.

## Arquivos

- Banco: `supabase/migrations/20261103120000_api4com_integration.sql` (tabelas `api4com_user_settings`, `api4com_calls`, `api4com_webhook_events`). Nada existente muda.
- Servidor: `lib/api4com/client.ts` (HTTP), `lib/api4com/calls.ts` (conectar, ligar, desligar, webhook), `lib/api4com/shared.ts` (resultado e rótulos).
- Rotas: `app/api/integrations/api4com/me` (GET/PUT/DELETE da própria conexão), `team` (admin), `calls` (POST ligar), `calls/[callId]` (GET estado), `calls/[callId]/hangup`, `webhook/[orgId]/[secret]`.
- Telas: `features/settings/components/Api4comSection.tsx` (inclui o estado do telefone), `features/api4com/CallButton.tsx` (no cabeçalho da conversa em `DealDetailModal`), `features/api4com/phone/` (telefone SIP, provedor e janela da ligação), caso `call` em `features/deals/lead/LeadTimeline.tsx`.
- Testes: `lib/api4com/calls.test.ts`, `features/api4com/CallButton.test.tsx`, `features/api4com/phone/sipPhone.test.ts`.

## Para testar no preview

1. Aplicar a migração no banco de **staging** pelo SQL Editor (o MCP recusou DDL).
2. Ter um usuário com plano e ramal na API4com. Fechar o Webphone da API4com, se estiver aberto (dois no mesmo ramal se atrapalham).
3. Configurações > Geral > Telefonia (API4com): colar o token de acesso (sem expiração), na MESMA organização do lead (a conexão é por organização).
4. Abrir um lead com telefone, clicar em Ligar no topo da conversa e liberar o microfone.

## Pendências conhecidas

- O formato exato da lista de `GET /integrations` (array puro ou `{data: [...]}`) não está documentado; o cliente aceita os dois. Confirmar no primeiro teste real.
- Os horários do webhook vêm sem fuso; o CRM usa o relógio dele na chegada de cada aviso e a duração informada pela API4com.
- Sem o webhook (cadastro falhou ou aviso perdido), a ligação fica "em andamento" na tela até 2 h; consultar `GET /calls` para reconciliar fica para uma próxima etapa.
- O telefone embutido não foi testado contra a central real (sem ramal aqui). Pontos a confirmar no primeiro teste: registro em `wss://<domínio>:6443`, o cabeçalho `X-Api4comintegratedcall` no toque e o áudio pelo STUN público (`stun.l.google.com`), já que a doc não informa STUN/TURN.
