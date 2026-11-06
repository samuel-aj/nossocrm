# Calendário proativo e agente por inatividade

## Aprovação

Samuel aprovou calendário apenas para follow-ups proativos, com dias/horários configuráveis, adiamento para próxima abertura e respostas receptivas preservadas. Testes sem mensagens reais. Também aprovou ação direta de agente de IA no follow-up de etapa. Base: main2193874, ZapSign Mestre preservada.

## Configuração

Em Configurações > IA e Automações > Horários de follow-up: chave de ativação, fuso IANA, dias da semana e intervalos por dia. Começa desativada para preservar comportamento atual. Horários são locais ao fuso escolhido; intervalos têm início inclusivo e fim exclusivo. Faixas que atravessam meia-noite devem ser divididas em dois dias. Validação rejeita sobreposições e calendário ativo sem nenhuma faixa.

## Execução

Prazos continuam em tempo corrido desde a referência original. Fora do horário, adiar sem consumir a tentativa, alterar histórico comercial ou declarar mensagem enviada. Revalidar ao executar: resposta do lead, etapa, regra, agente/robô ativo, organização, pausa manual e limite de tokens.

Robôs iniciados por follow-up carregam contexto proativo persistente; esperas e robôs filhos herdam a política. O motor confere o calendário ao retomar. Uma resposta recebida encerra o silêncio e a continuação receptiva não fica bloqueada pelo calendário. Robôs operacionais iniciados por outros gatilhos permanecem como estão. Nenhum calendário libera mensagem livre fora da janela da Meta.

O adiamento não pode causar execução concentrada de todas as regras vencidas na abertura. Consolidar as regras já vencidas na mais recente, com uma única tentativa na abertura; as futuras preservam a referência original; resultado visível deve distinguir adiamento, execução, falha e cancelamento. Reserva atômica impede dois workers de disparar o mesmo item.

## Agente de IA na etapa

Novo tipo de ação: Ativar agente de IA. Selecionar agente da organização e instrução de retorno. Validar disponibilidade da IA e agente habilitado. Respeitar parada/pausa humana, aprovação pendente e bloqueio de consumo. Preservar dados/memória já existentes, registrar contexto da etapa e não alterar o número da conversa. Sem conversa válida, registrar pendência/erro sem criar comunicação em outro número.

## Banco e compatibilidade

Migração aditiva para calendário por organização e campos de ação agente na regra. Dados atuais preservados. Sem atualização massiva de agendamentos antigos ao habilitar calendário. Escrita apenas via servidor autenticado com permissão administrativa; leitura/execução sempre por organização. Falha de leitura não pode liberar disparo proativo por padrão. Migração não será aplicada em produção durante desenvolvimento.

## Validação

Testes puros para horários, limites, fim de semana, fuso e horário de verão; testes de API para isolamento e autorização; testes de workers para adiamento, concorrência, cliente respondendo durante espera, troca de etapa, robô filho e teto de consumo. UI permite editar dias, intervalos e fuso, salvar/reabrir e explica o adiamento para a próxima abertura. Provedores de mensagens/IA simulados, sem credenciais reais.

## Fora desta entrega

Retorno combinado com data/hora, CTWA, ZapSign autônoma e voz seguem como entregas próprias no roteiro mestre. Esta divisão não cancela esses itens.
