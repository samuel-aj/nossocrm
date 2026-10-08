> Regra de ganho revisada pelo usuário após esta auditoria: promoção a Cliente define fechamento comercial; Protocolado é acompanhamento posterior. A conclusão original sobre Protocolado abaixo é histórica e foi substituída no design/implementação.

# Revisão de relatórios e registros do kanban — MPL

Data: 08/10/2026. Escopo: diagnóstico do relatório Performance dos funis DBA e BPC Autista, fórmulas, persistência de marcos e clareza da interface. Código equivalente ao main publicado `8700a209e088f577580e495a608e7d8d145433af`, checkout `nossocrm-envio-fix`, HEAD `2bf6c72d6b0ecd373fce9e7f62a04e889f20549f`. Consultas de produção somente leitura; não houve mudanças de configuração, leads, banco ou publicação.

## Regras confirmadas pelo usuário

- Qualificado = etapa configurada como **MQL**, independentemente do nome.
- DBA: o marco atual é **Proposta enviada**, vinculada a MQL.
- BPC Autista: qualificação na etapa **QUALIFICADO**, vinculada a MQL; ganho somente em **Protocolado**. Assinado com Pendência não deve ser alterado para ganho.

## Diagnóstico prioritário

### P1 — MQL é ignorado por parte do sistema

`features/reports/performanceMetrics.ts:50` identifica somente SALES_QUALIFIED ou nome começando com “qualificado”. As funções live `crm_internal.deal_stage_rules` e `sync_deal_lifecycle_dates` usam a mesma lógica antiga, confirmada no banco. A visualização de qualificação do kanban já prioriza MQL (`features/boards/utils/qualificationView.ts:35`).

Consequência: DBA mostra traço nas duas taxas e não persiste a data de qualificação. BPC funciona porque o nome da etapa coincide com o fallback. Nos 316 negócios atuais não excluídos do DBA, nenhum possui qualified_at, incluindo os 43 atualmente ganhos. Isso não significa que nenhum tenha se qualificado.

Correção recomendada: unificar a regra MQL em UI, cálculos, triggers, importações e integrações; manter o marco de ganho configurado em cada board. Atualizar cache ao mudar as regras do funil. Na ausência de configuração/dados suficientes, mostrar indisponibilidade explicada, sem sugerir zero qualificações.

### P1 — Percentuais misturam populações distintas

O gráfico calcula etapas abertas sobre leads criados no período e sua posição atual, mas a coluna Ganho usa todos os encerrados no período. O percentual da etapa anterior divide esses dois grupos como se fossem o mesmo conjunto (`performanceMetrics.ts:130–152`).

Reprodução no DBA, setembro, todos os vendedores/produtos:

| Indicador | Valor observado |
|---|---:|
| Criados em setembro | 261 |
| Barra Contato Feito | 37 |
| Barra Proposta enviada | 34 |
| Barra Contrato Enviado | 33 |
| Ganhos encerrados em setembro | 34 |
| Desses ganhos, criados antes de setembro | 2 |
| Percentual exibido entre contrato e ganho | 34 / 33 = 103% |

São denominadores incompatíveis para uma conversão de funil. Os testes atuais chegam a exigir 300% nessa transição (`performanceMetrics.test.ts:106–118`), e o PDF afirma que taxas acima de 100% são válidas. O cálculo atual é intencional; precisa mudar a definição e os testes, não apenas a apresentação.

Nos cartões ocorre o mesmo: qualificações do mês / entradas do mês; ganhos do mês / qualificações do mês. As frases “X de Y” sugerem subconjuntos, embora possam ser leads diferentes. Não corrigir limitando artificialmente a 100%.

### P1 — “Avanços no período” usa posição atual e passagens inferidas

O gráfico não usa os eventos para contar passagens. Preenche todas as etapas anteriores à posição atual, mesmo se houve salto, e remove etapas posteriores em regressões/perdas (`performanceMetrics.ts:130–136`). Uma pendência opcional pode aparecer como etapa visitada sem ter sido. Um mês antigo pode mudar após uma movimentação nova.

O estado atual também determina quais ganhos/perdas entram: reabertura limpa closed_at, e transferência remove o lead da consulta do board anterior. Isso é correto para mostrar a carteira atual, mas insuficiente para um histórico de resultados. Correção: distinguir fotografia atual, conversão dos mesmos leads e eventos ocorridos no período. Preservar resultados anteriores com eventos explícitos e eventuais reversões.

### P2 — Recuperação histórica precisa separar evidência de estimativa

O trigger de eventos de etapa está ativo e registra gravações no banco, inclusive movimentações por interface/API, independentemente das atividades geradas pela UI. Foram encontrados 1.707 eventos MPL, com primeiro registro em 09/09/2026.

| Funil | Negócios atuais | Sem deal_stage_events | Com data de qualificação | Datas estimadas |
|---|---:|---:|---:|---:|
| BPC Autista | 682 | 259 | 160 | 85 |
| DBA | 316 | 20 | 0 | 0 |

A ausência nessa tabela não prova ausência em todas as fontes: o relatório também tenta atividades e webhooks legados. Contudo, nem todo histórico pode ser reconstruído com precisão.

Hoje datas estimated entram nas taxas por mês (`performanceMetrics.ts:105`), embora o comentário do campo no banco diga que seriam excluídas das conversões datadas. O fallback de atividades associa texto ao nome atual da etapa sem board_id, podendo atribuir ao novo funil uma passagem do anterior.

Corrigir apenas MQL no trigger faria uma edição comum de lead antigo atribuir qualified_at=agora/estimated (`20260911141654_deal_lifecycle_dates.sql:124–129`). Isso deslocaria qualificações antigas para o mês da correção. Recuperar datas somente quando eventos identificam funil, etapa e momento com evidência suficiente. Estado atual sem histórico deve ser marcado como data desconhecida/estimada e separado da conversão datada.

### P2 — Motivos de perda estão fragmentados por texto livre

DBA/setembro: 51 perdas qualificadas distribuídas em 32 textos, 139 desqualificações em 35 textos e uma perda sem categoria. Exemplos reproduzidos: “Sem retorno” (6) e “Sem retorno.” (3); “Contato Repetido” e “CONTATO REPETIDO”; três grafias de “Repetido”.

`lib/utils/lossDetails.ts:2` só remove espaços nas pontas. `ReportsPage.tsx:148–165` desenha todas as variantes como categorias e estica as três colunas pela altura da maior lista.

Recomendação: motivo estruturado por ID + observação livre separada; padronização segura de caixa/espaços/pontuação e mapeamento revisado de sinônimos, preservando o texto original. Mostrar cinco motivos principais, participação percentual dentro da categoria, “Outros” e “Ver todos”. Reavaliar categorias ambíguas como “Não responde”: o marco MQL anterior e a razão da perda devem ter significados separados.

### P2 — Integridade de movimentação por integrações

Os caminhos principais de gravação já geram eventos. Há, porém, uma lacuna em `lib/ai/tools.ts:689–716`: moveDeal recebe stageId e atualiza diretamente, sem conferir que a etapa pertence ao mesmo board; a validação por nome tem esse filtro. O registro MCP constrói as ferramentas sem cliente escopado (`lib/mcp/crmRegistry.ts:53`) e o guard de visibilidade ignora chamadas sem auth.uid. Recomenda-se validar a associação etapa/funil/organização no resolvedor e como invariante no banco, também para operações privilegiadas.

Na amostra completa dos 998 negócios não excluídos da MPL, não foram encontrados stage_id inexistente, etapa de outro board/organização ou ganho e perda simultâneos. É uma lacuna de proteção identificada no código, não a causa comprovada dos 103%.

## Exemplos que explicam a confusão do BPC

- Outubro: 46 leads criados e 8 qualificações registradas no mês. Sete dessas qualificações pertencem aos leads criados em outubro; uma é de lead mais antigo. O 17,4% atual é 8/46; para o grupo criado em outubro, as qualificações registradas correspondem a 7/46 = 15,2%. Isso ilustra a diferença de definição, sem alterar dados.
- As 106 perdas de outubro incluem 80 leads criados antes de outubro. Esse total operacional pode legitimamente superar as 46 entradas do mês; não deve ser usado como perda do mesmo grupo de 46 leads.
- Ganhos em outubro permanecem zero pela regra confirmada de Protocolado. Existem cinco negócios atuais em Assinado com Pendência, que continuam não ganhos.

## Modelo recomendado para o relatório

Separar três perguntas, com período e critério de data sempre visíveis:

| Visão | Pergunta | Base |
|---|---|---|
| Conversão dos leads captados | Dos leads criados no intervalo, quantos chegaram a MQL e a ganho? | Mesmo conjunto de leads, apuração até uma data explícita |
| Resultados no período | Quantas qualificações, ganhos e perdas aconteceram no intervalo? | Data de cada evento; indicar quanto veio de leads anteriores |
| Carteira atual | Onde estão os leads agora? | Etapa atual, sem chamar distribuição de avanço histórico |

Na conversão: qualificação = leads do grupo que atingiram MQL / entradas do grupo; fechamento = ganhos do mesmo grupo e da base qualificada / qualificados do grupo. Apresentar também conversão total entradas→ganhos se útil, com nome diferente. Denominador zero = indisponível, não 0% fictício. Casos incompletos ou saltos sem evidência devem ser explicitados antes de oferecer uma taxa como precisa.

Não tratar toda etapa opcional como passagem obrigatória. Exibir quantidade em cada barra e conversão entre os mesmos IDs; mostrar saltos/pendências separadamente quando necessário. Se a proposta for medir apenas encerramentos, ganhos / (ganhos + perdas qualificadas) deve ter outro nome e outra base, nunca substituir silenciosamente ganhos / qualificados.

## Clareza e usabilidade

- Período hoje fica escondido atrás de “Filtros 1”; mostrar “01/09–30/09/2026 · leads criados no período”, além de vendedor/produto e data-limite da apuração.
- As barras têm altura de quantidade, mas só o percentual fica escrito em cima; mostrar número absoluto e a base do percentual.
- A última barra muda a definição do percentual: no DBA, 103% é ganho/barra anterior e 13% é ganhos/entradas. Usar uma legenda e uma regra consistentes.
- Mostrar nomes completos de etapas em gráfico horizontal ou tabela complementar. Abreviações como “ass. com Pend...” atrapalham comparação.
- Substituir “Fechamentos 34/51” por “34 ganhos · 51 perdas qualificadas”, com os demais desfechos claramente separados.
- Mostrar cobertura do histórico e quantidade de datas estimadas na tela principal, não apenas no detalhe/PDF.
- Manter o clique nas métricas para inspecionar os leads e a fórmula. O drilldown atual é útil, mas abre “0 qualificados” até quando a configuração não é reconhecida; distinguir zero de não calculável.
- Alinhar Visão Geral, Performance, drilldowns e PDF à mesma definição e aos mesmos conjuntos de IDs.
- Atualizar a consulta ao mudar regras/ordem das etapas: a chave atual considera board.id, e o realtime acompanha somente deals/deal_items (`usePerformanceReport.ts:18–28`).
- Corrigir comparação de “este mês” parcial com mês passado inteiro ou informar explicitamente a diferença.

## Conferências realizadas e limites

- Leitura de código e funções PostgreSQL de produção, consultas agregadas por organização/funil e reprodução da tela DBA/setembro, com 34 ganhos, 51 perdas qualificadas, 139 desqualificações e 103%.
- Reproduções sintéticas isoladas em memória: MQL deixa as taxas null; 100 entradas novas e 103 ganhos antigos geram 103% no fechamento, apesar de nenhuma entrada nova ter sido ganha.
- Navegação por teclado: Enter abre o detalhamento da taxa; Escape fecha e devolve foco ao indicador, com foco visível. ARIA/semântica revisados no fluxo. As barras têm nome acessível com quantidade, mas a fórmula continua dependente do detalhe/tooltip.
- Não foi realizada auditoria completa de contraste, leitores de tela ou dispositivos móveis; não há certificação de acessibilidade nesta revisão.
- Sem gravação de leads, movimentações de teste ou mensagens. Apenas este documento de diagnóstico foi acrescentado ao checkout.
- Evidência visual: `C:/Users/samuk/.codex/visualizations/2026/10/07/01a1182c-aa5d-7201-8546-8565717b702e/crm-relatorio-dba-auditoria.png`.

## Ordem de implementação e critérios de aceite

1. Unificar MQL e manter ganho BPC em Protocolado. Recuperar histórico somente por evidência; nunca preencher a data atual em massa para fazer o gráfico aparecer.
2. Definir e separar conversão de coorte, resultados por evento e carteira atual. Atualizar cálculos, consultas, cache, telas, detalhes, PDF e testes em conjunto.
3. Ampliar o registro imutável de marcos e reversões: qualificação, ganho/perda, reabertura, transferência, autor/origem, board/stage, datas e valores pertinentes. Manter fotografia atual para operação.
4. Simplificar gráfico, filtros visíveis e motivos de perda estruturados.
5. Validar invariantes: MQL renomeado continua qualificando; Protocolado é o ganho BPC; salto não inventa visita; retorno/perda não apaga evento passado; transferência/reabertura não reescreve resultados fechados silenciosamente; troca de responsável não reatribui resultado antigo sem critério explícito; data desconhecida não vira agora; ganhos antigos não entram na conversão dos novos; etapa de outro board é recusada; detalhes e PDF reconciliam com os totais e IDs da tela.
