# Modal de leads por etapa
Goal: abrir a lista exata de cada barra com nome, cria??o, qualifica??o e encerramento.
Architecture: usar os conjuntos do c?lculo atual e a primeira data comprovada de qualifica??o no hist?rico completo. Reutilizar Modal com tabela e datas ausentes em branco.
Tech Stack: React, TypeScript, Recharts, Vitest.

- [x] Expor stageId, deals e datas comprovadas em performanceMetrics.ts sem alterar totais.
- [x] Ligar clique e teclado em StagePerformanceChart.tsx ao estado de ReportsPage.tsx.
- [x] Criar StageLeadsModal.tsx com tabela, rolagem e fechamento padr?o.
- [x] Validar listas, contagens, filtros, datas fora do m?s, datas ausentes e intera??o: 29 testes passaram.
- [x] Typecheck e lint dos arquivos alterados passaram. Build de produ??o passou.
- Lint global bloqueado por quatro erros de ts-ignore em webhooks e dois avisos preexistentes em navega??o e ActivitiesContext.
