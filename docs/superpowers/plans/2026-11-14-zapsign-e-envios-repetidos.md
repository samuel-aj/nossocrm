# ZapSign e envios repetidos — Implementation Plan

**Goal:** Publicar a correção parcial da ficha com os novos casos de endereço, contrato manual e repetição de mídia/robô relatados em 14/11.

**Architecture:** A ficha deve aceitar o mesmo conteúdo independentemente de quebras de linha e pontuação, mantendo nova confirmação quando o cliente corrige um dado. Reservas persistentes e leitura do estado após lock impedem repetição. O contrato manual alimenta o contexto dinâmico da conversa e a fila de assinatura, sem alterar prompts.

**Tech Stack:** Next.js, TypeScript, Supabase/PostgreSQL, Vitest, Vercel.

Publicação autorizada por Samuel. Execução em paralelo nesta sessão, com revisão integrada. Não criar contratos reais nem enviar mensagens nos testes; não modificar modelos, prompts, dados históricos ou configurações de clientes.

## 1. Ficha sem dependência de vírgulas

Arquivos: `lib/zapsign/contractPersonalFields.ts`, `contractPersonalFields.test.ts`, `agentDraft.ts`, `agentDraftConfirmation.test.ts`, `signatures.test.ts`.

- [x] Reproduzir entradas equivalentes, em uma ou várias mensagens, sem vírgulas, com número compacto e endereço rural.

```ts
expect(addressHasCustomerEvidence(
  'Rua das Flores n564 Bairro São Francisco Campanha MG',
  ['Rua das Flores n564', 'Bairro São Francisco', 'Campanha MG'],
)).toBe(true);
```

- [x] Normalizar apenas formatação comprovada; preservar números e palavras. Acrescentar casos negativos para número, bairro e CEP inventados.
- [x] Conferir preparação → resumo → confirmação → emissão simulada, incluindo correção parcial 88→98 e invalidação do resumo anterior.

```powershell
npm.cmd run test:run -- --config vitest.zapsign.config.ts
```

Aceite: sem `perguntar_ao_cliente` para dados já fornecidos; resumo atualizado ainda precisa de confirmação.

## 2. Mídia uma vez por conversa

Arquivos: `lib/wa-agents/media.ts`, `engine.ts`, `test.ts`, helpers de reserva e testes; migração aditiva de comprovantes.

- [x] Reproduzir duas chamadas à mesma mídia em turnos diferentes no simulador e duas reservas concorrentes no runtime.
- [x] Persistir reserva antes do envio e comprovante após sucesso; considerar histórico existente. Falha comprovada permite retry; resultado incerto não causa reenvio automático.
- [x] Preservar arquivos diferentes e isolar organizações/conversas. Não alterar as instruções da ferramenta.

```powershell
npm.cmd run test:run -- --config tmp/vitest-isolated.config.ts lib/wa-agents/tools.test.ts lib/wa-agents/replyGeneration.test.ts
```

Aceite: a mesma mídia não aparece de novo após resposta do cliente ou troca de agente; simulador igual ao runtime.

## 3. Robô e follow-up

Arquivos: `lib/wa-agents/bots.ts`, `botsEngine.test.ts`, `followups.ts`, `followups.test.ts`.

- [x] Reproduzir dois workers com o mesmo snapshot antes da aquisição do lock.
- [x] Após adquirir o lock, ler execução atual e revalidar status e vencimento; usar estado atualizado para execução/resposta.
- [x] Cobrir execução já encerrada, espera futura e corrida entre scheduler e execução imediata; manter tentativas futuras legítimas.

```powershell
npm.cmd run test:run -- --config tmp/vitest-isolated.config.ts lib/wa-agents/botsEngine.test.ts lib/wa-agents/followups.test.ts
```

## 4. Contrato manual e acompanhamento

Arquivos: `lib/zapsign/signatures.ts`, `agentNotices.ts`, helper de contexto, testes e migração das funções de assinatura.

- [x] Reconhecer contrato emitido do mesmo lead/contato/modelo no contexto dinâmico; impedir follow-up antigo de coleta de ficha.
- [x] Associar novas emissões manuais à conversa/agente ativo sem reenviar convite; notificação de assinatura usa as proteções existentes de pausa, limites e horário.
- [x] Testar outro lead/organização/modelo, agente pausado, assinatura parcial e webhooks repetidos. Não backfill em cadastros antigos.

```powershell
npm.cmd run test:run -- --config vitest.zapsign.config.ts
```

## 5. Integração e publicação

- [x] Revisar diff contra `origin/main`, escopo e ausência de mudanças em prompts; preservar `tmp/` preexistente.
- [x] Executar suites isoladas afetadas, tipos, lint dos arquivos alterados e build.
- [x] Testar migrações num PostgreSQL temporário; validar RLS, permissões e concorrência.
- [x] Aplicar migrações compatíveis com a versão atual e confirmar esquema.
- [ ] Integrar somente o commit conferido, verificar deployment de produção e domínio do CRM.

```powershell
npm.cmd run typecheck
npm.cmd run build
git diff --check
gh pr checks 70
```

Registrar commit, deploy, migrações e testes no checkpoint do projeto. Não simular envio em produção.

## Validação em 14/11/2026

474 testes passaram (288 ZapSign, 144 integração do agente/robô e 42 regressões de ferramentas/mídia). Typecheck, lint dos arquivos alterados e build passaram. Migrações validadas em PGlite e aplicadas em produção: manual_contract_agent_followup (20261114182334) e agent_media_delivery_once (20261114182345). RLS e acesso exclusivo service_role conferidos. Sem contratos ou mensagens reais nos testes; nenhum prompt alterado.
