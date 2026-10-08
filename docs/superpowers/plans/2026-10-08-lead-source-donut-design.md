# Origem dos leads — opção A aprovada

**Objetivo:** aplicar a composição Rosca em destaque escolhida pelo usuário em 08/10/2026.

**Arquitetura:** alteração de apresentação isolada em `features/reports/LeadSourceChart.tsx`. Preservar `leadSourceSlices`, bases, valores, agrupamentos, callbacks, filtro e PDF. React, SVG, Tailwind e Popover Radix já existentes.

## Design aprovado

Rosca central de aproximadamente 226px (214px em tela estreita), total em destaque e legenda em duas colunas abaixo. Cada origem apresenta nome, quantidade e percentual. Cabeçalho compacto; botão de informação reúne a explicação completa da base. Rodapé mantém acesso a todas as origens. Avisos sobre origens reconstruídas continuam visíveis. Outros em âmbar e Não informado em cinza, com cores por chave, nunca por posição. Etapas permanecem em colunas verticais ao lado.

A composição tem altura natural para nomes longos e avisos, sem cortar informações. O contexto da carteira atual usa descrição própria, sem alegar período. Nenhuma publicação ou migration faz parte desta alteração.

## Execução

- [x] Substituir composição lateral pela rosca central e legenda em duas colunas; preservar teclado, nomes acessíveis e callbacks.
- [x] Mover explicações completas para Popover acionável por clique/teclado; manter resumo histórico visível e ajustar o teste existente para confirmar acesso à informação.
- [x] Rodar testes existentes de LeadSourceChart/ReportsPage, lint focal e typecheck; revisar diff independentemente.
- [x] Conferir componente real na prévia sintética em desktop, celular e tema escuro; salvar captura e registrar commit local.

Comandos: `npx vitest run features/reports/LeadSourceChart.test.tsx features/reports/ReportsPage.test.tsx --reporter=dot`; `npx eslint features/reports/LeadSourceChart.tsx features/reports/LeadSourceChart.test.tsx`; `npm run typecheck`. Resultado esperado: zero falhas nos testes e verificações. Reutilizar prévia isolada `tmp/performance-preview`, sem credenciais ou conexão com produção.


## Validação concluída

9/9 testes dos dois arquivos passaram; ESLint e TypeScript sem erros. Revisão independente sem bloqueadores. Prévia do componente real conferida em desktop, celular390px (375px úteis, sem overflow) e tema escuro. Informação acessível por clique, detalhamento por teclado conciliado6/6 de50leads fictícios. Capturas: `tmp/performance-preview/donut-a-mobile.jpg` e artefato visual `origem-rosca-a-aplicada.jpg`. Nenhum dado, migration ou cálculo foi alterado.
