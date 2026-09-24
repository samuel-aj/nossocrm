# Indicadores de automação no board — validação de staging

## Comportamento aprovado

O espaço do indicador de atividades mostra exclusivamente robô em andamento (azul), IA ativa (violeta), ou o estado das tarefas quando não há automação ativa. Avisos e contadores de atraso ficam ocultos durante a automação; nenhuma tarefa é alterada. O mesmo componente atende Kanban e lista.

Filtros: Todas, Robô em andamento, IA ativa e Sem automação ativa. Compatíveis com filtros existentes, limpeza e preferências fixadas do board.

## Estado e acesso

- Robôs `running` e `waiting_reply` contam como ativos; espera programada é explicada no tooltip. Concluídos, cancelados e erros não contam.
- IA só conta em `active`; pausada, parada e aguardando aprovação não contam. Abrange agentes nativos e externos.
- Usa execução/atendimento vinculado ao lead, nunca apenas robô configurado para uma etapa. Vínculos explícitos prevalecem; fallback de contato seleciona o lead aberto atualizado mais recentemente entre todos os boards, como no contexto do motor.
- Em múltiplos canais simultâneos, um robô tem precedência no único indicador e no filtro.
- API em lotes de até 100 IDs, autenticação, organização da aba, RLS dos leads e permissões de conversa. Consultas paginadas; máximo de três lotes concorrentes no navegador.
- Projeção separada de execução, sem duplicar o cache de leads. Atualiza a cada 10 segundos com a aba visível e ao recuperar foco/conexão. Não exige novas políticas de leitura das tabelas privadas de WhatsApp.
- Falha de consulta mostra estado indisponível; não classifica desconhecido como “Sem automação ativa”.

## Verificações

- 46 testes direcionados passaram: estados, exclusividade sobre atraso, filtros e Limpar, troca de organização, atualização do cache, autenticação e proteção da API, regressões dos filtros existentes.
- TypeScript, ESLint dos arquivos alterados e build otimizado Next.js passaram.
- API autenticada com banco staging: robô aguardando resposta, IA ativa, humano sem automação; bot encerrado e IA pausada removem os indicadores. Acesso anônimo 401, origem externa 403, IDs indisponíveis e de outra organização não retornam informações.
- Chrome, build compilado com banco staging: ícones distintos nos cards, filtros de robô e IA retornam só o lead correspondente, IA pausada some do filtro por atualização automática, limpar restaura os cards e os indicadores de tarefas.
- Fixtures temporárias usam telefones inválidos, robô sem envio e desligado, espera/lock em 2099, IA externa sem conexão. Nenhuma mensagem é disparada. Remover fixtures e revogar sessão temporária ao concluir.

## Publicação

Destino: branch staging. Sem migração de banco e sem alteração em main/produção.
