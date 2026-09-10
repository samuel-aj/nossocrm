# Modal de leads por etapa
Goal: abrir a lista exata de cada barra com nome, criação, qualificação e encerramento.
Architecture: usar os conjuntos do cálculo atual e a primeira data comprovada de qualificação no histórico completo. Reutilizar Modal com tabela e datas ausentes em branco.
Tech Stack: React, TypeScript, Recharts, Vitest.

- [x] Expor stageId, deals e datas comprovadas em performanceMetrics.ts sem alterar totais.
- [x] Ligar clique e teclado em StagePerformanceChart.tsx ao estado de ReportsPage.tsx.
- [x] Criar StageLeadsModal.tsx com tabela, rolagem e fechamento padrão.
- [x] Validar listas, contagens, filtros, datas fora do mês, datas ausentes e interação: 29 testes passaram.
- [x] Typecheck e lint dos arquivos alterados passaram. Build de produção passou.
- Lint global bloqueado por quatro erros de ts-ignore em webhooks e dois avisos preexistentes em navegação e ActivitiesContext.
