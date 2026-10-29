# Validação local — distribuição e métricas dos robôs

Data: 29/10/2026. Branch: `codex/bot-distribution-analytics`.

## Evidência
- Suíte integrada offline: 141 testes, 17 arquivos, todos aprovados. Abrange motor, serialização, importação/modelos, conexões, início em lote, API administrativa e componentes.
- Depois da revisão, a suíte de UI passou com 12 testes (inclui recuperação quando o objetivo é removido por outra aba).
- ESLint dos arquivos alterados, `tsc --noEmit` e `npm run build`: aprovados. Build gerou 155 páginas; manteve o aviso existente do instalador sobre padrão dinâmico amplo em `lib/installer/edgeFunctions.ts`, sem falha de compilação.
- SQL isolado com PGlite: duas migrações aplicadas em banco descartável, apenas registros fictícios. Testados rodízio A/B/C/D, pesos, atomicidade/reprocessamento, isolamento entre organizações, permissões, atribuição estável, legado e testes separados.
- Agregação validada com 127 execuções reais fictícias: sem limite de paginação, saídas convergentes separadas, união dos balões, objetivos posteriores à escolha, repetição sem inflar taxas e filtro de datas.
- Auditoria corrigiu espera repetida em ciclos, identidade contato→lead e sobreposição de estatísticas quando outra aba altera o fluxo. Dois negócios diferentes de um contato continuam distintos.
- Nenhuma conexão com banco de produção, mensagem real ou acionamento real de robô foi feito.

## Comandos reproduzíveis
Usar `npx vitest run --config test/ai-usage/vitest.config.ts` com os arquivos explícitos do motor, analytics, canvas, rotas e modelos alterados. A configuração offline bloqueia acessos externos.

Os scripts `scripts/test-bot-distribution-db.mjs` e `scripts/test-bot-analytics-db.mjs` recebem como argumento o caminho absoluto de uma instalação local de `@electric-sql/pglite/dist/index.js`. Não usam credenciais nem banco remoto.

## Conferência visual
Prévia temporária com os componentes reais e dados fictícios compilada em `tmp/bot-analytics-preview`. Captura automatizada pendente: o controle do navegador retornou timeout tanto na sessão principal quanto no subagente. A prévia não integra a publicação.

## Publicação futura
Aplicar `20261029143000_bot_distribution.sql` antes de `20261029143100_bot_analytics.sql` e antes do código que consulta as novas colunas/RPCs. Ambas são aditivas; não reescrevem execuções anteriores, leads, conversas ou mensagens.

O botão existente Testar mantém seu comportamento de execução; a nova sinalização apenas exclui essas execuções dos indicadores e do rodízio de produção. As validações deste trabalho foram simuladas, sem usar esse botão com um número real.

As métricas detalhadas começam nas execuções instrumentadas após a ativação. Histórico antigo continua preservado, sem inventar taxas que não foram registradas.
