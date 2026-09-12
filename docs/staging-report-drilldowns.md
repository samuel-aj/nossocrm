# STAGING — detalhes dos relatórios e dados de perda

Implementação de 12/09/2026, baseada na staging e30c652. Destino: branch staging, projeto Vercel nossocrm e Supabase de preview mggvzlmquzqcloprxmoe. MAIN permanece para a etapa posterior de validação.

## Comportamento

- Faturamento, taxas de qualificação/fechamento, ciclo médio, fechamentos, perdas, motivos e vendedores abrem os negócios usados no cálculo. Taxas exibem suas duas bases separadamente; cada acontecimento mantém sua própria data.
- As listas permitem buscar pelo nome do lead ou responsável e abrir o cartão em outra aba, conservando a análise. Mostram produto, etapa atual, datas e, conforme o indicador, valores, classificação, motivo ou duração.
- Filtro de produto aplicado antes de calcular indicadores, comparação com o período anterior e gráfico. O PDF recebe os mesmos resultados e identifica o produto. Negócios com vários produtos são contados uma única vez; faturamento continua sendo o valor integral do negócio vinculado ao produto. Sem produto significa sem vínculo com o catálogo, incluindo itens avulsos.
- Opção visual 3 aprovada: faixa abaixo das etapas e acima das abas com classificação, motivo e encerramento. Aparece nas perdas e desaparece após reabrir. Campos antigos ausentes são explicitamente identificados.
- Edição de classificação/motivo respeita a permissão de editar e RLS, exige que o negócio continue perdido e verifica os valores anteriores. Preserva etapa, encerramento e primeira qualificação. Correção registra antes/depois na Timeline; se apenas o registro de histórico falhar, a interface informa a falha parcial.
- A Timeline passa a exibir as descrições dos eventos, inclusive motivos já existentes. Novas perdas pela movimentação da interface registram classificação e motivo juntos. Dados de perda são enviados em uma atualização, evitando a corrida entre movimento e classificação.
- O hook de movimentação atualiza a lista canônica DEALS_VIEW_KEY e o detalhe; ambos são restaurados se houver falha. A escrita duplicada no cache bruto foi removida conforme AGENTS.md.

## Validação

- 55 testes específicos passaram: datas de coortes distintas, soma de faturamento, filtro de produto e ausência de produto, motivos por categoria, busca, links, abas das taxas, exportação, edição, permissões, mudança de organização, falha parcial e rollback do cache.
- Typecheck e lint dos arquivos alterados passaram; git diff --check sem erros.
- Suíte geral final: 403 passaram, 5 ignorados e 6 falharam. As falhas foram reproduzidas na base e30c652: middleware/login, mock de história do board e quatro verificações legadas de cache/snapshot. A base tinha também uma sétima falha referente ao cache bruto no hook de movimento, corrigida nesta alteração.
- Banco de STAGING: atualização de um lead fictício do board DEMO dentro de BEGIN/ROLLBACK, primeiro como administrador e depois com papel authenticated e identidade do responsável. Classificação/motivo atualizados, etapa/encerramento/qualificação preservados, transações revertidas. Não houve migração nem alteração persistente dos dados de demonstração.
- Navegador conectado indisponível: nenhum browser na descoberta e tentativa de abrir iab retornou Browser is not available. A validação visual autenticada deve ser feita no preview antes de MAIN.

## Conferência no preview

1. Em Relatórios > Performance, selecionar board, período, vendedor e produto. Conferir o total e abrir cada indicador/motivo.
2. Nas taxas, alternar as duas bases. Buscar um lead e abrir seu cartão em outra aba.
3. Abrir um lead perdido e alternar Timeline, WhatsApp e Atividades: a faixa permanece no topo.
4. Corrigir classificação/motivo num lead de teste: a data de encerramento permanece e o histórico mostra antes/depois. Reabrir o lead remove a faixa sem apagar os eventos anteriores.
5. Exportar PDF e conferir produto e números iguais aos da tela.
