# Correções de Performance — implementação de 08/10/2026

## Resultado

- MQL define o marco de qualificação, independentemente do nome da etapa. Ganho comercial automático ocorre na promoção para CUSTOMER (Cliente), conforme correção posterior do usuário. No BPC atual, isso ocorre em Assinado com Pendência; Protocolado é acompanhamento adicional.
- A visão padrão acompanha os mesmos leads captados no intervalo e os acontecimentos comprovados até a data de apuração. Fechamento usa apenas ganhos entre os qualificados dessa base.
- Resultados no período mostra entradas, qualificações, ganhos, perdas e reaberturas pelas respectivas datas. Carteira atual mostra os negócios abertos agora.
- Gráfico horizontal com nomes completos, contagens e bases dos percentuais; clique abre os registros usados no cálculo. PDF acompanha a mesma visão.
- Perdas agrupadas por grafia e aliases seguros de repetição, cinco principais e expansão. Os motivos originais são preservados.
- Histórico imutável de entrada/saída do funil, chegada à etapa, qualificação, ganho, perda e reabertura. Guarda estrutural de organização/funil/etapa inclusive para integrações privilegiadas.

## Histórico e limites

A migration recupera apenas evidências datadas, sem UPDATE dos negócios e sem disparar automações operacionais para corrigir o passado. Datas estimadas não viram qualificações ocorridas hoje; mudanças irrelevantes também não criam novos marcos. Reabertura e transferência preservam resultados registrados. O primeiro ganho por jornada vem da promoção comprovada a Cliente: múltiplas etapas CUSTOMER e protocolo posterior não duplicam o ganho. Perda, reabertura, saída do funil e regressão para antes de Cliente permitem uma promoção futura. O salto direto para Protocolo não é ganho; entrar depois em CUSTOMER, sem uma promoção anterior, registra o fechamento naquele momento.

O backfill não usa a data antiga de protocolo como assinatura. Ao movimentar um legado, o banco restaura a data de Cliente comprovada no histórico; sem prova, mantém a data desconhecida. Alterações sem movimento não reescrevem a situação operacional. Registros antigos sem prova de presença no funil ou data não entram silenciosamente em denominadores. A interface informa essas lacunas. Snapshots antigos podem usar campos atuais ou o último registro disponível; o relatório declara essa limitação.

Na captação, o responsável usa a primeira presença comprovada; o filtro de produto usa a associação atual. Isso é explícito porque o CRM grava negócio e produtos em requisições separadas. Nos acontecimentos por período, o produto é o do instante registrado. Uma melhoria separada seria tornar a criação com itens atômica e capturar seu snapshot no fim da transação; não foi alterada a API de criação neste trabalho.

## Validação

- 176 testes focados aprovados em 21 arquivos: relatórios, PDF, drilldowns, kanban, promoção CUSTOMER, APIs, robôs, IA e integridade histórica. Inclui as últimas correções da revisão independente.
- PostgreSQL isolado via PGlite aprovado: backfill sem UPDATE; CUSTOMER comercial e MQL; assinatura antes de protocolo; restauração de flags e data histórica; salto pré-CUSTOMER→Protocolo→CUSTOMER; múltiplas etapas CUSTOMER; repetição de ganho; reabertura, perda, regressão e transferência; snapshots, privilégios e RLS com identidades diferentes.
- Prévia local com dados sintéticos, sem conexão ao Supabase: três modos, contagens, filtro e motivos originais. Prévia revisada com 10 clientes ganhos, 5 protocolados e taxa 10/39; o detalhamento mantém 06/10 como fechamento após protocolo em 07/10. Explicação de Cliente conferida em largura de 390px. Capturas em tmp/performance-preview/customer-promotion-cohort.png e customer-promotion-mobile.png.
- Suíte geral executada neste ajuste: 1.303 passaram, 12 falharam e 5 ignorados (1.320). Os mesmos 12 testes da base continuam falhando: cache-integrity (5), CreateBoardModal.stages (5), US-001-abrir-deal-no-boards (1), supabaseMiddleware (1). Duas regressões acrescentadas na revisão posterior receberam a execução focal integrada final de 176/176. O snapshot de cache já desatualizado também registra as novas escritas corretas no cache único. Log local tmp/performance-preview/customer-promotion-full-suite.log.
- Lint focal dos arquivos alterados aprovado. Na entrega anterior b7fece9, lint global tinha zero erros e um warning preexistente no img de components/navigation/NavigationRail.tsx:39, bloqueado por max-warnings=0; não foi repetido sem mudanças nesse arquivo.
- Build webpack final passou com TypeScript e geração de páginas após o congelamento da revisão: log local tmp/performance-preview/customer-promotion-build-final.log.
- Banco real apenas consultado para compatibilidade: PostgreSQL 17.4. Testes usam PGlite isolado; nenhuma migration, configuração ou dado de produção foi alterado.

Comandos de verificação:

```powershell
npx vitest run features/reports lib/utils/lossDetails.test.ts lib/ai/tools.stageGuard.test.ts lib/public-api/dealsMoveStage.test.ts lib/wa-agents/botsEngine.test.ts lib/query/hooks/useMoveDeal.win.test.ts lib/query/hooks/useMoveDeal.loss.test.ts lib/boards/boardOutcome.test.ts features/deals/lead/DealStageControl.test.tsx features/deals/lead/StageCascadePicker.test.tsx features/boards/utils/qualificationView.test.ts
node scripts/test-performance-db.mjs '<caminho-temporario>/node_modules/@electric-sql/pglite/dist/index.js'
npm run build -- --webpack
```

O runner SQL requer @electric-sql/pglite@0.3.15 instalado em pasta temporária (instruções no próprio arquivo); não usa URL de banco nem credenciais.

## Aplicação em produção

Ainda não aplicada. Primeiro publicar a migration `20261008161431_performance_lifecycle_history.sql` e verificar tabela, triggers, privilégios e contagens; depois publicar a aplicação e conferir DBA/BPC com consultas somente leitura. A aplicação nova depende da tabela nova. Não aplicar a migration apenas para testar em produção.

Rollback do frontend pode manter o diário histórico: não excluir evidências para voltar a versão da tela. Reversão dos triggers exige migration explícita revisada; não executar rollback destrutivo automático.

## Regra de Cliente aplicada em todos os caminhos

O critério usa o ID CUSTOMER configurado na etapa, independentemente de seu nome. O destino antigo wonStageId permanece apenas como fallback do botão manual Ganho quando não existe etapa CUSTOMER; Arquivar mantém a etapa atual. Funis que já gerenciam clientes preservam sua etapa explícita de conclusão. Movimentações comuns por API, robôs e kanban usam a regra transacional do banco. A IA e os atalhos preferem a etapa que promove para Cliente.

A cópia para o próximo funil ocorre em uma nova promoção, sem repetir por cada etapa posterior. O cache recebe as datas confirmadas pelo banco, inclusive a recuperação histórica. A configuração e o PDF explicam a distinção entre fechamento comercial e protocolo.
