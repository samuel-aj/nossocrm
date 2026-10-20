# Passagens omitidas nos relatórios de períodos curtos

## Diagnóstico

Consulta somente leitura ao histórico do funil Rede Social confirmou uma chegada
a Contrato em 19/10/2026 às 10:35:42 (America/Manaus). O ganho do mesmo lead
ocorreu apenas em 20/10 às 07:31:45. Portanto, Contrato deve constar no dia 19,
enquanto esse ganho pertence ao dia 20.

O movimento para Contrato e a qualificação têm o mesmo `occurred_at`, mas o
registro de qualificação foi persistido cerca de 17 ms depois, em `recorded_at`.
O filtro das etapas após MQL usava o desempate por `recorded_at` e descartava
a própria movimentação que qualificou o lead. Um avanço posterior ou ganho
podia mascarar a omissão em períodos maiores.

Não houve falha no recorte local de “Ontem”, na paginação ou no carregamento
do histórico. O modal de Verificação apresenta a evidência de passagem naquela
coluna; ele não representa necessariamente a etapa atual da ficha.

## Correção

`buildConversionFunnel` compara a ocorrência da visita com a ocorrência da
confirmação de qualificação, preservando microssegundos. Eventos simultâneos
valem como avanço simultâneo. A ordenação por `recorded_at` continua em vigor
para âncoras de reentrada e encerramento/reabertura de episódios.

Não há alterações na base de entradas, na seleção dos qualificados, nas regras
de ganho/perda, no corte de datas, nos dados do CRM ou no layout.

## Conferência com histórico real

Snapshot somente leitura de 20/10/2026, aproximadamente 09:05 em Manaus.
Os nomes foram removidos da fixture local de investigação; ela não faz parte
da alteração publicada.

| Recorte | Indicador | Antes | Depois |
| --- | --- | ---: | ---: |
| 19/10 | Entradas | 24 | 24 |
| 19/10 | Qualificados | 11 | 11 |
| 19/10 | Proposta feita ou além | 2 | 10 |
| 19/10 | Contrato ou além | 0 | 2 |
| 19/10 | Ganhos do período | 4 | 4 |
| Outubro até a consulta | Entradas | 169 | 169 |
| Outubro até a consulta | Qualificados | 104 | 104 |
| Outubro até a consulta | Proposta feita ou além | 58 | 100 |
| Outubro até a consulta | Contrato ou além | 24 | 29 |
| Outubro até a consulta | Ganhos do período | 10 | 10 |

O mensal também recupera passagens omitidas pelo mesmo defeito. Suas regras
e as taxas dos indicadores permanecem iguais. As taxas entre colunas acompanham
as contagens corrigidas. Uma consulta SQL independente às chegadas de 19/10
confirmou 24 entradas, 10 avanços a Proposta ou além e 2 a Contrato ou além.

Foram comparadas 44 combinações de períodos/filtros, incluindo os dias 1 a 19,
últimos sete dias e mensal, com e sem filtro de responsável. Não houve diferença
nas populações de entradas, qualificados, ganhos, perdas e reaberturas, nem nas
taxas dos indicadores, no faturamento e no total de origens.

Revisão independente conferiu os 54 pares únicos lead/etapa acrescentados:
todos possuem ocorrência simultânea de movimentação/qualificação com gravação
da movimentação anterior. Nenhum lead/etapa foi removido.

## Validação

- Regressão reproduzida antes do patch: 2 falhas, 5 controles passando.
- Depois do patch: 165 testes de relatórios passando, em 19 arquivos.
- TypeScript (`npm run typecheck`), ESLint dos arquivos alterados e
  `git diff --check` passaram.
- Build local de produção (`npm run build`) concluído antes da publicação.
- Sete cenários novos: período diário/mensal, ganho apenas no dia seguinte,
  visitas anteriores/simultâneas/posteriores com microssegundos e reentrada.
- Consulta de produção exclusivamente de leitura. Nenhuma mensagem enviada,
  nenhum lead movido, nenhum dado ou esquema alterado.

Validação acima realizada antes da publicação, autorizada pelo usuário em 20/10/2026.
