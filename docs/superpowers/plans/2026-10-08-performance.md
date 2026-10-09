# Correção do relatório Performance — Implementation Plan

**Goal:** reconhecer MQL, preservar marcos históricos comprovados e separar conversão, resultados por evento e carteira atual.

**Architecture:** regras compartilhadas, diário imutável do banco com RLS, cálculo puro e hook de dados que usa snapshots. A interface e o PDF consomem o mesmo resultado e as mesmas listas de leads.

**Tech Stack:** Next.js, React, TypeScript, TanStack Query, Supabase/PostgreSQL, Vitest, Recharts.

## 1. Banco e histórico

- [ ] Criar migração pela CLI Supabase para regra MQL, diário lifecycle e validação estrutural de stage/board/org.
- [ ] Registrar entered_board/left_board/qualified/won/lost/reopened com snapshots e evidência idempotente; manter data de qualificação comprovada por board.
- [ ] Recuperar apenas registros com data comprovada; ignorar estimated em backfill de eventos.
- [ ] Validar a migração em PostgreSQL isolado e acrescentar regressões SQL, incluindo RLS e não fabricação de datas.

Casos de aceite SQL: lead inicialmente antes de MQL sem qualified_at; movimento para MQL atribui data transition; título alterado num legado após MQL não atribui agora; regressão conserva marco; transferir e voltar conserva evento; reabrir preserva ganho anterior; etapa de board/organização diferente é rejeitada mesmo por serviço.

## 2. Cálculo e consulta

- [ ] Atualizar features/reports/performanceMetrics.ts e testes para modos cohort/period/current, MQL, corte temporal e conjuntos compatíveis.
- [ ] Atualizar usePerformanceReport.ts: eventos por board + negócios visíveis relacionados, snapshots históricos, filtro de responsável/produto coerente, chave das regras e inscrições realtime.
- [ ] Atualizar reportDrilldown.ts e testes: explicar base por modo e mostrar as mesmas listas usadas no indicador.

Contrato: calculatePerformance recebe options no oitavo argumento; usePerformanceReport recebe mode no sexto. mode padrão cohort. Eventos históricos têm event_type, occurred_at, source e snapshot do negócio; o mapeamento para tipos TypeScript ocorre na fronteira da consulta.

Regressão matemática essencial:
```ts
expect(result.qualifiedIds.size).toBeLessThanOrEqual(result.entries.length);
expect(result.cohortWonDeals.every(deal => result.qualifiedIds.has(deal.id))).toBe(true);
```
Os cenários devem incluir ganhos de leads antigos, salto de etapa opcional, evento após a data-limite, qualificação estimada, reabertura e transferência.

## 3. Motivos e movimentação

- [ ] Adicionar chave/label estável de agrupamento em lib/utils/lossDetails.ts, preservando original; testar pontuação/caixa e aliases conhecidos, sem unir comentários ambíguos.
- [ ] Validar stageId no resolvedor de lib/ai/tools.ts antes de gravar e testar ausência de escrita em rejeição.
- [ ] Preservar lastStageChangeDate em lib/query/hooks/useMoveDeal.ts quando a etapa não muda, com teste focal.

## 4. Interface e PDF

- [ ] ReportsPage.tsx: seletor de modo, bases visíveis, volumes por evento/carteira sem falsas taxas, encerramentos explícitos e cobertura do histórico.
- [ ] StagePerformanceChart.tsx: quantidade legível, nomes completos, conversão da mesma base quando aplicável, interação por teclado.
- [ ] Motivos: cinco principais, participação na categoria, Outros e expansão. Atualizar testes de UI e generateReportPDF.ts.
- [ ] Conferir preview local com dados sintéticos e capture screenshot, sem dados de clientes no fixture.

## 5. Integração

- [ ] Rodar testes focais, TypeScript, lint focal, build e suíte geral uma vez; comparar falhas conhecidas da base.
- [ ] Revisão independente dos arquivos integrados e verificação de migração/backfill com dados agregados, sem escrita em produção.
- [ ] Documentar checks, limites históricos e passos de publicação/reversão. Preparar branch/PR revisável; não aplicar mudanças de banco em produção durante testes.

Execução paralela aprovada no fluxo atual: backend (1), cálculo (2), integridade/motivos (3), root UI/integração (4–5). Revisão de contrato antes de integrar. Não há dependência de skills adicionais indisponíveis para executar o plano.
