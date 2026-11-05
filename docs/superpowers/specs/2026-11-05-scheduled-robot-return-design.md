# Retorno combinado por robô — design

Aprovado por Samuel: agendar robô no horário combinado e reativar agente, com exceção ao calendário quando confirmado com o cliente. Testes sem mensagens reais; implementação local, sem publicar nesta entrega.

Usar wa_bot_runs e o relógio existente, com metadados aditivos de agendamento. Evita criar um segundo worker e mantém cancelamento/histórico existentes. Alternativas consideradas: só ai_resume_at não executaria robô; fila separada duplicaria cron/estado. A opção escolhida é execução futura do robô, isolada por organização e conversa.

Agente > Ações > Recursos seleciona um robô habilitado. Ferramentas consultar/agendar/cancelar retorno; reagendar substitui somente retorno pendente, sem cancelar outros robôs. Data local e fuso IANA devem ser explícitos, futura até 90 dias; rejeitar horário inexistente ou ambíguo. IA confirma data/fuso com cliente e só promete após persistência. A ferramenta não aceita bot/organização/conversa fornecidos pelo modelo: estes vêm do contexto autenticado.

Uma execução pendente por conversa. Reserva atômica via trava da conversa, revalidação de última resposta e idempotência. Não enviar na criação. Tick existente executa quando vence. Nova mensagem recebida cancela retorno ainda não iniciado; pausa/parada manual, aprovação pendente, troca de agente/número ou limite de consumo impedem execução. Follow-ups ordinários aguardam o retorno pendente. Mensagem livre continua sujeita à janela Meta; robô pode usar modelo aprovado.

Exceção de calendário restrita à execução do retorno salvo, conferida no banco, inclusive se o worker atrasar. Follow-ups ordinários continuam seguindo o calendário; resposta recebida converte a continuação em receptiva sem remover pausas manuais ou limite de consumo. Robô com Entregar a agente reativa o agente sem apagar memória e recebe o contexto combinado como instrução da execução. Reserva/locks existentes e substituição atômica evitam duplicar agendamentos.

A referência de mensagem é capturada antes de carregar histórico/prompt. Uma mensagem nova durante a geração invalida o agendamento antigo na RPC. O início persiste o contexto proativo atomicamente e revalida número, agente, lead, contato e estado. Se outra geração estiver em andamento, aguarda a próxima tentativa do relógio. A migração só adiciona campos/índice/funções e gatilho; não reescreve conversas ou históricos existentes.

Chat mostra data e fuso do retorno e ação Cancelar retorno. Simulador do agente responde às ferramentas sem banco nem envio. Testes cobrem fuso, DST, duplicidade, isolamento, nova resposta, pausa, limite, exceção e calendário normal, persistência, API e UI. Verificar migração em PostgreSQL local e build completo. Não alterar dados de produção.
