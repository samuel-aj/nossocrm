# Simplificação da tela Performance — 09/10/2026

Solicitação: usar somente Resultados no período, retirar seletor de visão e textos destacados nos prints, incorporar entradas/reaberturas ao quadro de etapas e remover Total perdidos do rodapé.

## Alterações

- ReportsPage usa `period` na consulta, nos detalhes e na exportação PDF. As implementações compartilhadas dos outros modos continuam disponíveis internamente.
- Removidos os três botões de visão, o bloco explicativo do cabeçalho e o aviso externo de cobertura histórica.
- Entradas no funil e Reaberturas ficam abaixo do título Chegadas por etapa no período, com acesso aos respectivos leads.
- Rodapé da rosca mantém Ver detalhes. Informação sobre origem ausente/reconstruída permanece no popover e nos detalhes.
- Total perdidos removido. Totais das categorias e perdas sem classificação continuam acessíveis.
- Rosca A, colunas verticais, filtros, fórmulas de cada modo e registros históricos preservados. Sem alteração de banco.

## Verificação

- 12/12 testes de ReportsPage, LeadSourceChart e StagePerformanceChart passaram, incluindo consulta/PDF em period e detalhamento de entradas/reaberturas.
- ESLint focal, TypeScript e git diff --check passaram.
- Revisão independente sem problemas concretos.
- Prévia sintética dos componentes reais conferida no Chrome: http://127.0.0.1:4176/. Captura `relatorio-periodo-simplificado.jpg` na pasta de visualizações desta conversa.

Implementação local a partir de main `699eb2c`, sem nova publicação nesta rodada.
