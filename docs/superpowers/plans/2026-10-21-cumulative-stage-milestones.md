# Cumulative Stage Milestones Implementation Plan

**Goal:** aplicar a regra cumulativa definida pelo usuário, com datas persistidas e relatório consistente.

**Architecture:** o banco confirma os marcos numa única transação do movimento real. O cliente antecipa o mesmo resultado; o relatório lê eventos explícitos de cumprimento sem inferir retroativamente cadastros antigos.

**Tech Stack:** PostgreSQL/Supabase, TypeScript, React, Vitest, PGlite.

## 1. Banco e história

- [x] Criar migration prospectiva via CLI e ampliar evento permitido para `stage_completed`.
- [x] Atualizar trigger de datas: destino na região Cliente em avanço real cria ganho; preservar ganho/data existentes e regras de perda/reabertura.
- [x] Preencher qualificação ausente ao avançar para/depois do marco configurado.
- [x] Inserir confirmação única das etapas anteriores ainda sem registro, com snapshot da transação. Não atualizar cartões intermediários, inserir movimentações físicas falsas ou executar backfill.
- [x] Estender regressões SQL e runner isolado para salto direto, perdas, regressões, idempotência, transferências, datas preservadas e organizações.

## 2. Cliente

- [x] Manter `isAutomaticWonStage` identificando o marco exato, pois o relatório usa essa identidade.
- [x] Acrescentar helper para destino cumulativo de ganho e utilizá-lo na resolução da movimentação e descrição da transferência.
- [x] Testar salto e transferência para pós-Cliente, no-op legado, datas preservadas, perda/reabertura e funis de serviço.

## 3. Relatórios

- [x] Consumir `stage_completed` como evidência datada, sem mudar estado atual nem resetar ganho.
- [x] Incluir confirmação em entradas por etapa, conversão e pós-venda, respeitando filtros e snapshots.
- [x] UI/PDF distinguem cumprimento registrado ao avançar de movimentação física e evidência legada.
- [x] Testar um mesmo salto no relatório diário/mensal, datas anteriores preservadas e invariância à ordem dos eventos no mesmo instante.

## 4. Integração e entrega

- [x] Executar testes SQL somente no PGlite e testes TypeScript via `tmp/sender-check/vitest.config.ts`, que bloqueia fetch e não carrega limpeza de fixtures remotas.
- [x] Executar lint dos arquivos alterados, typecheck, build e revisão do diff, sem executar cadastros de teste em produção.
- [x] Documentar resultados e pendência de aplicação/publicação; manter dados existentes intactos.
