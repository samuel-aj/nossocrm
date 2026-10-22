# Validação — etapas cumulativas

Implementação local concluída em 21/10/2026 na branch `codex/cumulative-stage-milestones`. Regra: avançar confirma as etapas normais anteriores e preenche as datas faltantes na data do movimento; preserva datas existentes e exclui Perdido do processo cumulativo.

## Verificações

- PostgreSQL isolado com PGlite: 105 assertions passaram (59 anteriores e 46 novas). Migration aplicada duas vezes; os cadastros e eventos anteriores permaneceram idênticos. Inclui salto, criação avançada, idempotência, datas legadas, perdas, reabertura, transferência entre funis, funil de serviços e isolamento do ledger.
- Engine de relatórios: 102 testes passaram em sete arquivos, incluindo 17 controles cumulativos. Abrange ordenação dos eventos, corte diário/mensal, snapshots, filtros e reabertura com ou sem novos cumprimentos.
- Movimentação e controles: 64 testes passaram no conjunto de boardOutcome, useMoveDeal (ganho/perda/pendências), DealStageControl, StageCascadePicker e qualificationView.
- Apresentação/modal/PDF: 35 testes passaram.
- Ponta a ponta local: export dos eventos reais produzidos pelo PostgreSQL sintético, parser da aplicação e cálculo de relatórios. Oito comparações passaram (salto e reabertura × diário/mensal × mensal/conversão), com uma entrada, qualificação e ganho coerentes, taxas de 100% e datas de cumprimento preservadas.
- Regressão com fixture previamente capturada: 50 recortes diários/mensais e por responsável, sem mudanças nas populações, taxas, faturamento ou etapas dos registros históricos. Nenhuma nova consulta remota foi necessária.
- ESLint dos arquivos alterados, TypeScript, build de produção e revisão independente passaram. O TypeScript e lint do engine foram repetidos após a última correção de ordenação.

## Evidências locais

- `tmp/cumulative-stage-audit/comparison.json`: comparação do histórico.
- `tmp/cumulative-stage-audit/db-synthetic.json`: dados fictícios produzidos no PGlite.
- `tmp/cumulative-stage-audit/db-to-report.json`: conferência integrada de oito recortes.
- Runner reproduzível: `scripts/test-performance-db.mjs`, usando módulo PGlite isolado.
- Vitest executado com `tmp/sender-check/vitest.config.ts`, fetch bloqueado e sem o setup que limpa fixtures remotas.

## Situação de entrega

Este registro documenta a validação local de 21/10/2026. Nenhum cadastro de produção foi alterado durante esses testes. Em 22/10/2026 foi autorizada a publicação e, separadamente, a regularização de dois saltos históricos com preservação das datas existentes. Os dados operacionais e scripts direcionados permanecem fora do repositório público.
