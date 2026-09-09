# Plano de implementação do Performance

**Objetivo:** entregar no preview o relatório único de acontecimentos com as fórmulas aprovadas.

**Arquitetura:** função pura de agregação, consulta paginada sob RLS, tela e PDF alimentados pelo mesmo resultado. Next.js, React, TypeScript, Supabase e Vitest existentes.

- [x] Isolar checkout na staging, preservando main e o preflight original.
- [x] Criar `features/reports/performanceMetrics.ts` para associar datas a eventos e calcular taxas sem limitar a 100%.
- [x] Criar `features/reports/usePerformanceReport.ts` com paginação completa, chave por usuário/organização/filtros, erros de carga e lacunas históricas explícitas.
- [x] Substituir os cálculos misturados de `ReportsPage.tsx` e sincronizar o PDF.
- [x] Testar entrada em julho, qualificação em agosto, ganho em setembro; perda posterior; duplicação de eventos; passagem de qualificado para proposta em outro mês; ausência de datas; denominador zero; filtro e fronteiras de período.
- [x] Executar lint, typecheck, Vitest e build; verificar preview e o host público do banco.
- [ ] Commit e push apenas de HEAD:staging; confirmar deployment READY e entregar a URL.
