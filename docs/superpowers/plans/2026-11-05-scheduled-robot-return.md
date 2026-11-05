# Retorno combinado por robô — implementação e validação

**Objetivo:** o agente agenda o robô autorizado para o horário combinado, com exceção ao calendário, e o robô pode entregar de volta ao agente.
**Arquitetura:** fila existente wa_bot_runs/wake_at; metadados aditivos e RPCs transacionais, sem novo worker.

## Entregas
- [x] Conversão de data local + fuso IANA, rejeitando passado, ambiguidades e datas além de90dias (scheduledReturnTime.ts).
- [x] Persistência/isolamento/idempotência/substituição/cancelamento na migração20261105213530. Início captura contexto atomicamente e revalida estado, referência de mensagem, número e cadastro.
- [x] Ferramentas consultar_retorno, agendar_retorno e cancelar_retorno usando somente IDs do contexto autenticado; referência capturada antes de montar histórico.
- [x] Worker existente respeita horário, pausa/aprovação/orçamento; espera outra geração terminar; follow-ups ordinários aguardam retorno pendente.
- [x] Entrega ao agente recebe contexto combinado sem apagar memória; resposta ao robô remove restrição de calendário, mas preserva pausa manual.
- [x] Agente > Ações > Recursos seleciona robô habilitado; chat exibe horário/fuso e Cancelar retorno. Simulador mantém estado apenas em memória na geração.
- [x] 156 testes em9arquivos com banco/modelo/WhatsApp falsos. ESLint dos20arquivos alterados aprovado. Typecheck aprovado.
- [x] SQL testado em PostgreSQL PGlite local: dados legados, grants/RLS, vínculos, idempotência, cancelamento, início antecipado, pausa, resposta, remarcação e replay.
- [x] Build webpack aprovado: 162 páginas; revisão independente sem bloqueadores. Commit local desta entrega.

## Comandos seguros
Usar tmp/vitest-isolated.config.ts, que não carrega test/setup.ts (este acessa .env e pode limpar fixtures reais). Suite: scheduledReturnTime, scheduledReturns, proactiveFollowup, followups, stageFollowups, botsEngine, engineOutput, ChatAgentBanner e followupCalendar.
SQL: definir PGLITE_MODULE apontando ao módulo local e executar node scripts/verify-scheduled-return-sql.mjs. Sem conexão externa.
Build: npm run build -- --webpack. Lint focado nos arquivos da entrega, com --max-warnings=0.

## Orientação de configuração
Em Configurações > IA e Automações > Agentes de IA, editar agente, abrir Ações > Recursos e selecionar Robô para retorno combinado. O robô deve estar habilitado no número da conversa e pode usar Entregar a agente. Na API oficial do WhatsApp, fora da janela de24h, usar modelo aprovado antes de aguardar a resposta e entregar ao agente; agendamento não remove a restrição da Meta.
O agente consulta o relógio/fuso, confirma horário com o cliente, grava o retorno e só confirma sucesso após persistência. Nova mensagem recebida cancela um retorno ainda não iniciado para evitar contato desatualizado. É possível remarcar na conversa ou cancelar pelo banner.

## Publicação futura — não executada nesta entrega
Aplicar migração antes do código. Confirmar destino pela configuração de produção na Vercel, nunca pelo nome amigável do projeto: o CRM usa pldknngsszuxiuweivdz. Publicar com base atualizada de main preservando alterações posteriores. Conferir leitura autenticada da configuração e conversa, sem acionar workers/robôs reais em teste. Não ativar/configurar robôs de clientes automaticamente.
