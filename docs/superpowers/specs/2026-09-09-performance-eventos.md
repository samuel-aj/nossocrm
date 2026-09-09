# Performance por acontecimentos do período

Regras aprovadas pelo usuário: relatório único; entradas por created_at, qualificação pela data em que o lead atingiu Qualificado (ou cruzou esse limite), ganhos e perdas por closed_at. Qualificação = qualificados / entradas; fechamento = ganhos / qualificados; percentuais acima de 100% são válidos; denominador zero exibe traço. Um lead conta uma vez por etapa por período, mesmo que volte à etapa. A perda posterior não apaga a qualificação.

Usar atividades STATUS_CHANGE e eventos históricos de webhook, com paginação completa e isolamento da organização e dos negócios visíveis ao usuário. Não usar updated_at como data de fechamento, nem presumir que todos os ganhos passaram por todas as etapas. Eventos sem data recuperável ficam identificados como lacunas, nunca inventados. Filtros usam quadro e responsável atuais, explicitamente identificados. PDF deve reproduzir os dados e fórmulas da tela.

Limite histórico: atividades antigas identificam a etapa pelo nome; nomes ambíguos não são atribuídos. Webhooks só existem onde havia regra ativa. A mudança não reconstrói movimentos ausentes nem atribui a data da proposta a uma qualificação anterior desconhecida.

Publicação autorizada exclusivamente na staging/preview. Em 2026-09-09 o usuário autorizou seguir sem as travas de Start/Finish nesta tarefa. O preflight original falhou por cópia legada do Drive sem manifesto; esse estado e a cópia foram preservados. O trabalho usa um worktree separado da staging; main não é destino de push.

## Registro confiável daqui em diante

A migration 20260909150926_performance_stage_events.sql cria uma tabela de chegadas por etapa e um trigger privado. Registra criação e mudança de etapa/quadro, sem duplicar edição na mesma etapa. RLS vincula leitura aos leads visíveis; clientes não podem inserir, editar ou apagar o histórico. Migration aplicada exclusivamente ao Supabase do preview mggvzlmquzqcloprxmoe, verificado pelos arquivos públicos do deployment. Produção usa pldknngsszuxiuweivdz e não foi alterada.

Verificação SQL em transação revertida: criação, qualificação, atualização repetida, proposta e perda posterior; três eventos preservados, sem dados de teste remanescentes. Advisors não apontaram achados nos novos objetos; os alertas existentes em outros objetos ficaram fora do escopo.

Validação: 16 testes específicos passaram; typecheck e build passaram. A suíte ampla tem sete falhas em três arquivos e o lint geral tem três erros/dois avisos, reproduzidos na staging intacta c0ed87a.
