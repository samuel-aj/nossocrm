# Origem nativa e distribuição no relatório — 08/10/2026

Implementação autorizada pelo usuário para padronizar Origem do lead e manter ausência como Não informado. Trabalho local na branch `codex/performance-report-corrections`; nenhuma migration, alteração de dados ou publicação em produção neste escopo.

## Comportamento entregue

- Origem pertence ao negócio. O contato pode gerar outra oportunidade com outra origem, sem sobrescrever a aquisição anterior.
- Campo nos dois formulários de criação, no chat e no painel do lead. Opções por organização em Configurações do CRM; somente administradores alteram o catálogo. Categorias removidas permanecem legíveis nos leads existentes.
- Absorção dos valores e opções do campo legado `origem`. Os dados originais e UTMs são preservados; o controle duplicado é ocultado. Rótulos personalizados são mantidos; o gráfico agrupa diferenças de caixa, espaços e acentuação, sem inventar equivalência comercial.
- Kanban, lista, ordenação, filtros, edição em massa e contextos de IA leem o valor nativo. Limpar a origem não ressuscita o valor legado.
- API pública aceita/retorna `lead_source`: omitir preserva; null limpa. Se origem legada e nativa vierem juntas, a nativa vence, inclusive null. `custom_fields_patch.origem:null` continua uma limpeza explícita. Retentativa idempotente não troca a aquisição do lead existente. Upsert de contatos preserva seu source quando omitido; esse campo não define a origem do negócio.
- UTMs ficam nos detalhes da campanha. Inferência limitada na criação requer plataforma reconhecida e medium explicitamente pago/orgânico. Plataforma isolada, posicionamento ou UTM ambígua deixam origem vazia. Editar UTMs posteriormente não muda uma origem estabelecida.
- Cópia por automação NextBoard preserva origem, inclusive vazio explícito. O CSV existente importa/exporta somente contatos e não cria negócios: foi mantido separado; integrações/importações de negócios usam o campo da API pública.

## Relatório e histórico

Rosca com contagem, percentual e detalhamento acessível por clique/teclado. Não informado participa do denominador. Muitas categorias são resumidas em Outros (agrupados), mantendo lista completa e tabela completa no PDF.

A base é exatamente a de entradas do modo selecionado: leads captados no intervalo na visão de conversão; entradas distintas no funil na visão de acontecimentos; negócios abertos na carteira atual. Uma oportunidade conta uma vez. Filtros de responsável/produto seguem as mesmas regras dos demais indicadores.

Novos eventos guardam a origem daquela entrada; uma edição posterior não altera esses snapshots. Eventos antigos recebem a origem disponível na adoção e são identificados como reconstruídos, sem alegar comprovação histórica. A origem de `OLD`/`NEW` é preservada separadamente em transferências de funil.

As regras previamente aprovadas continuam: MQL conta como qualificação; promoção para CUSTOMER conta como ganho; protocolo é etapa posterior e preserva a data comercial.

## Validação

- 168/168 testes afetados, em 23 arquivos, passaram na integração final.
- Suíte ampla: 1.379 passaram, 5 ignorados e as mesmas 12 falhas conhecidas em 4 arquivos: cache-integrity (5), CreateBoardModal.stages (5), US-001-abrir-deal-no-boards (1) e supabaseMiddleware (1). Nenhuma dessas falhas foi mascarada; snapshot reescrito pela suíte foi restaurado aos bytes anteriores.
- Regressões SQL/PGlite de Performance e origem passaram. Cobrem omissão/null, conflito nativo/legado em lote, inferência de UTM só na criação, categorias antigas, ator, escrita autenticada, RLS/ACL, snapshots e ausência de UPDATE operacional durante a migration. A fixture não executa todos os triggers de produção.
- ESLint dos arquivos alterados passou. Compilação final de produção com TypeScript passou (`npm run build -- --webpack`).
- Prévia real do ReportsPage com dados fictícios: 50 leads na captação, 6 sem origem (12%); detalhamento por teclado retorna os mesmos 6. Carteira atual: 20 leads, 2 sem origem (10%). Layout conferido em desktop e 390 pixels.
- PDF exportado pelo navegador e reaberto com unpdf: 3 páginas; origens 12/11/6/6/5/5/5, total 50 e 100%. A tabela preserva as categorias agrupadas visualmente na pizza.

Evidências locais ignoradas pelo Git em `tmp/performance-preview`: `native-source-focused.log`, `native-source-suite.log`, `native-source-build-final.log`, `native-source-final.jpg`, `native-source-mobile.jpg` e `native-source-report.pdf`.

## Aplicação e reversão quando a publicação for autorizada

Aplicar migrations da branch em ordem: `20261008161431_performance_lifecycle_history.sql`, depois `20261008193128_native_lead_source.sql`, antes do frontend/API dependentes das novas colunas. A migration de origem não atualiza a tabela operacional deals em massa, evitando disparos de automações por adoção. O legado é lido até a próxima escrita normal; a inicialização mantém null explícito distinto de ausência legada.

Não apagar campos legados, UTMs, histórico ou colunas numa reversão emergencial. Preservar novos dados de origem e reverter o código da aplicação se necessário; avaliar a regra de ganho separadamente para não reintroduzir protocolo como assinatura. Antes de eventual publicação, conferir o estado remoto e migrations já aplicadas, sem reaplicar às cegas.

## Ajuste somente visual — 08/10/2026

A pedido do usuário após revisar a prévia, o gráfico de origens ocupa a coluna esquerda ao lado das etapas. Os totais de qualificados perdidos e desqualificados foram incorporados aos respectivos blocos de motivos; total geral e perdas sem classificação continuam acessíveis abaixo desses blocos.

As etapas voltaram a colunas verticais, com escala iniciada em zero, quantidades acima das colunas, nomes completos e percentuais. A explicação da conversão está disponível por foco/tooltip. Em telas estreitas a rolagem horizontal fica dentro do gráfico. Nenhuma fórmula, base, filtro, regra de ganho/qualificação, migration ou exportação foi alterada nesta revisão.

Validação desta revisão: 15/15 testes existentes em ReportsPage, LeadSourceChart, LossReasonsCard e StagePerformanceChart; lint dos cinco arquivos alterados; TypeScript (`npm run typecheck`); diff sem erros. Prévia real com dados fictícios conferida em desktop e viewport de 390px; largura do documento igual à largura visível no celular (375px úteis). Capturas locais: `tmp/performance-preview/report-layout-final.jpg` e `report-layout-mobile.jpg`. Continua somente local, sem publicação.


## Opção A aprovada e aplicada — 08/10/2026

Após comparar três propostas, o usuário escolheu Rosca em destaque. LeadSourceChart usa rosca central maior, total destacado, legenda em duas colunas e rodapé com detalhes. A explicação completa da base fica no botão de informação; o aviso numérico de origem reconstruída/indisponível segue visível. Estado vazio, histórico, fontes e callbacks preservados; agrupamento Outros âmbar e Não informado cinza por chave apenas nesta apresentação.

9 testes existentes de componente/integração passaram; lint focal e TypeScript passaram. Revisão independente sem achados bloqueadores. Desktop, celular e tema escuro conferidos na prévia isolada. Detalhamento por teclado retorna os6desconhecidos de50 da fixture, sem duplicar. Cálculos, filtros, PDF, etapas verticais e produção preservados. Plano: `docs/superpowers/plans/2026-10-08-lead-source-donut-design.md`.
