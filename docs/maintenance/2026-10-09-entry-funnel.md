# Progressão dos leads que entraram no período

## Problema e comportamento corrigido

O gráfico anterior mostrava chegadas independentes por etapa no intervalo. No BPC Autista de setembro de 2026, eram 43 em Abordagem e 140 em Qualificação: cada coluna podia conter leads diferentes, inclusive entradas de meses anteriores e saltos de etapas. Isso não representava o avanço de uma mesma base.

O gráfico agora acompanha os mesmos IDs de **Entradas no funil** e **Origem dos leads**. Em cada coluna, conta uma vez cada lead cuja maior etapa registrada, desde a entrada selecionada até o fim do período, seja aquela etapa ou uma posterior na ordem atual do funil. Regressões, reaberturas e reentradas não zeram o maior avanço observado. Etapas de perda não integram essa ordem.

Os cartões permanecem em Resultados no período: ganhos, perdas e qualificações seguem os acontecimentos efetivamente registrados nas respectivas datas, inclusive de leads antigos. O avanço acumulado não fabrica visitas intermediárias, datas de qualificação, assinatura ou ganho. MQL continua significando qualificado e promoção para Cliente continua sendo o fechamento comercial; protocolo é posterior.

O detalhe de uma coluna mostra a etapa e a data realmente observadas, distinguindo passagem registrada de inclusão por etapa posterior. A coluna Encerramento não aparece nesse detalhe, pois a lista usa o retrato da entrada. O PDF usa a mesma base acumulada. Colunas verticais, rosca e alturas iguais foram preservadas.

## Chegadas iniciais históricas

Havia também uma exclusão indevida de chegadas iniciais: a compatibilidade histórica exigia igualdade exata entre o horário da etapa e `deals.created_at`. A criação na aplicação e o registro do trigger do banco usam relógios separados. Em setembro, 35 chegadas iniciais estavam de 71 a 331 ms após a criação e ficavam fora das entradas.

O hook agora marca explicitamente `from_stage_id === null` nos registros de `deal_stage_events`. O trigger usa essa origem nula em inserção, transferência entre funis ou primeira atribuição de etapa. O cálculo aceita a **data real dessa chegada**, sem declarar que necessariamente seja a criação do lead. Atividades genéricas sem origem não recebem esse marcador. Um `entered_board` no histórico oficial continua tendo precedência; datas inválidas, futuras e eventos de outros funis permanecem excluídos.

Não houve mudança de banco, reconstrução de visitas, escrita operacional ou migração.

## Conferência dos dados de setembro

Intervalo de Manaus: 01/09/2026 00:00 até 30/09/2026 23:59:59.999, equivalente a 01/09 04:00Z até 01/10 03:59:59.999Z. Sem filtros de vendedor/produto.

| Etapa | Chegadas independentes anteriores | Progressão da base de entradas |
| --- | ---: | ---: |
| EM ABORDAGEM | 43 | 147 |
| EM QUALIFICAÇÃO | 140 | 141 |
| EM VERIFICAÇÃO | 76 | 79 |
| PENDÊNCIA | 15 | 36 |
| QUALIFICADO | 1 | 25 |
| PROPOSTA FEITA | 24 | 25 |
| CONTRATO | 7 | 8 |
| Assinado com Pendência | 5 | 7 |
| Protocolado | 8 | 7 |

- Entradas: 147 (112 anteriores + 35 chegadas iniciais recuperadas pela data registrada).
- Reaberturas: 1; entradas sem etapa válida para o gráfico: 0.
- Cinco outros leads tiveram movimentação no período, mas não têm entrada documentada. Permanecem nos acontecimentos do período e ficam fora da base de entradas.
- A extração anonimizada contém 687 leads, 844 registros de etapa e 794 eventos de histórico. IDs foram transformados em MD5 no SQL; títulos sintéticos, valores zerados e responsáveis omitidos. O arquivo ignorado `tmp/performance-preview/bpc-september-anonymized.json` não integra o commit.
- O `calculatePerformance` TypeScript atual foi executado via esbuild sobre essa extração. A comparação automática das entradas, nove colunas, chegadas independentes e reabertura passou integralmente.

## Validação

- 109 testes do módulo de relatórios em 15 arquivos passaram.
- Após o ajuste final no modal, os 10 testes de ReportsPage/StageLeadsModal passaram novamente.
- ESLint dos arquivos de produto alterados, TypeScript e `git diff --check` passaram.
- Revisão independente sem bloqueadores.
- Prévia real dos componentes com dados fictícios em `http://127.0.0.1:4176/`: desktop 1440 px com os dois cards de 586,5 px; celular 390 px e detalhe das etapas conferidos. Captura `funil-acumulado-corrigido.jpg` no diretório de visualizações desta conversa.

## Entrega

Alteração local na branch `codex/performance-entry-funnel`, baseada no main `6113d9aadd12c3a4ecb7347bd8766768acf53680`. Ainda não publicada. Nenhuma migração adicional é necessária.
