# Correções de Performance — implementação de 08/10/2026

## Resultado

- MQL define o marco de qualificação, independentemente do nome da etapa. A configuração explícita de ganho permanece soberana: BPC somente em Protocolado.
- A visão padrão acompanha os mesmos leads captados no intervalo e os acontecimentos comprovados até a data de apuração. Fechamento usa apenas ganhos entre os qualificados dessa base.
- Resultados no período mostra entradas, qualificações, ganhos, perdas e reaberturas pelas respectivas datas. Carteira atual mostra os negócios abertos agora.
- Gráfico horizontal com nomes completos, contagens e bases dos percentuais; clique abre os registros usados no cálculo. PDF acompanha a mesma visão.
- Perdas agrupadas por grafia e aliases seguros de repetição, cinco principais e expansão. Os motivos originais são preservados.
- Histórico imutável de entrada/saída do funil, chegada à etapa, qualificação, ganho, perda e reabertura. Guarda estrutural de organização/funil/etapa inclusive para integrações privilegiadas.

## Histórico e limites

A migration recupera apenas evidências datadas, sem UPDATE dos negócios e sem disparar automações operacionais para corrigir o passado. Datas estimadas não viram qualificações ocorridas hoje; mudanças irrelevantes também não criam novos marcos. Reabertura e transferência preservam resultados registrados.

Registros antigos sem prova de presença no funil ou data não entram silenciosamente em denominadores. A interface informa essas lacunas. Snapshots antigos podem usar campos atuais ou o último registro disponível; o relatório declara essa limitação.

Na captação, o responsável usa a primeira presença comprovada; o filtro de produto usa a associação atual. Isso é explícito porque o CRM grava negócio e produtos em requisições separadas. Nos acontecimentos por período, o produto é o do instante registrado. Uma melhoria separada seria tornar a criação com itens atômica e capturar seu snapshot no fim da transação; não foi alterada a API de criação neste trabalho.

## Validação

- 78 testes focados aprovados: relatório, PDF, drilldowns, movimentações e integridade histórica.
- PostgreSQL isolado via PGlite: backfill sem UPDATE, MQL, ganho explícito, reentrada, reabertura, snapshots de etapas, privilégios e RLS com identidades diferentes.
- Prévia local com dados sintéticos, sem conexão ao Supabase: três modos, contagens, filtro e motivos originais. Mobile com viewport de 390px sem transbordamento horizontal; entradas 50/50 e reaberturas 0/0 conciliadas no detalhamento.
- Suíte geral: 1.255 passaram, 12 falharam e 5 ignorados (1.272). As mesmas 12 falhas da base: cache-integrity (5), CreateBoardModal.stages (5), US-001-abrir-deal-no-boards (1), supabaseMiddleware (1). Ajustes posteriores receberam nova execução focal completa (78/78).
- Lint global: zero erros, um warning preexistente no img de components/navigation/NavigationRail.tsx:39, bloqueado por max-warnings=0. Lint dos arquivos alterados sem erros/warnings.
- Build webpack passou com TypeScript e geração de páginas. Build final aprovado após revisão: log local tmp/performance-preview/performance-build-final.log.
- Banco real apenas consultado para compatibilidade: PostgreSQL 17.4. Testes usam PGlite isolado; nenhuma migration, configuração ou dado de produção foi alterado.

Comandos de verificação:

```powershell
npx vitest run features/reports lib/utils/lossDetails.test.ts lib/ai/tools.stageGuard.test.ts lib/ai/tools.rbac.test.ts lib/query/hooks/useMoveDeal.loss.test.ts
node scripts/test-performance-db.mjs '<caminho-temporario>/node_modules/@electric-sql/pglite/dist/index.js'
npm run build -- --webpack
```

O runner SQL requer @electric-sql/pglite@0.3.15 instalado em pasta temporária (instruções no próprio arquivo); não usa URL de banco nem credenciais.

## Aplicação em produção

Ainda não aplicada. Primeiro publicar a migration `20261008161431_performance_lifecycle_history.sql` e verificar tabela, triggers, privilégios e contagens; depois publicar a aplicação e conferir DBA/BPC com consultas somente leitura. A aplicação nova depende da tabela nova. Não aplicar a migration apenas para testar em produção.

Rollback do frontend pode manter o diário histórico: não excluir evidências para voltar a versão da tela. Reversão dos triggers exige migration explícita revisada; não executar rollback destrutivo automático.
