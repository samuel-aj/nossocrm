# Agentes de IA e Robôs de atendimento (versão beta)

Atendimento automático no WhatsApp configurado **dentro do CRM**, sem depender de ferramenta externa (n8n continua possível pelos webhooks). Funciona com WhatsApp via QR Code (Evolution) e com a WhatsApp API oficial (Meta).

## Como ligar

1. Configurações → Central de I.A → card **Versão beta: Agentes de IA e Robôs de atendimento** → ligar (só admin).
2. Aparece a aba **Configurações → Agentes** com três partes: Agentes de IA, Robôs e Execuções.
3. Com a chave desligada, o CRM se comporta exatamente como antes: nenhuma tela, rota ou gatilho novo age para aquela organização. Desligar não apaga as configurações.

A chave é a linha `ai_feature_flags (key = 'wa_agents_beta', enabled = true)` da organização.

## Agentes de IA

Cada agente tem:

| Seção | O que faz |
|---|---|
| Identidade | Nome interno, nome da persona (como se apresenta), ligado/desligado |
| Números | Em quais números ele é o **ponto de entrada** de conversas novas. Vazio = só recebe conversas passadas por outro agente ou iniciadas na mão |
| Modelo | Provedor + modelo + temperatura, fixos por agente. A chave da API vem de Configurações → Central de I.A; pode ser sobrescrita por agente |
| Roteiro | O prompt do agente. Variáveis: `{{nome_lead}}`, `{{primeiro_nome}}`, `{{telefone}}`, `{{data_hora}}`, `{{nome_agente}}`, `{{nome_escritorio}}`, `{{negocio.titulo}}`, `{{negocio.etapa}}` |
| Quando encerrar | Regras obrigatórias de quando o agente para e o que diz na mensagem final (aceita as mesmas variáveis e marcadores do roteiro). Ver "Quando encerrar" abaixo |
| Comportamento | Buffer (segundos que espera para juntar mensagens picadas), histórico (quantas mensagens da conversa o agente lê), intervalo entre linhas, pausa automática quando um atendente responde (minutos; 0 = só retoma na mão), limite de respostas por atendimento (0 = sem limite), só conversas novas |
| Resultados e ações | Resultados possíveis do encerramento (ex.: qualificado, desqualificado) e o que fazer em cada um: passar para outro agente, pedir aprovação humana, encerrar, registrar nota, mover etapa, adicionar rótulo, marcar perdido, atribuir responsável, criar tarefa |
| Webhooks | Por evento (iniciado, mensagem recebida, resposta enviada, ferramenta usada, encerrado, passado para agente, aguardando aprovação, aprovado, recusado, pausado, retomado, parado, erro), com URL, segredo e corpo personalizável com `{{variáveis}}` |

### Chave da IA e ligar o agente

Salvar um agente nunca depende da chave da IA. **Ligar** depende: ao salvar/ligar com `enabled=true`, o servidor confere a chave efetiva (própria do agente ou da org, Configurações → Integrações) com uma chamada barata ao provedor (listar modelos); chave ausente ou recusada (401/403; 400 no Google) → o agente é salvo **desligado** e a resposta traz `warning` (toast amarelo no editor e na lista). Erro de rede não bloqueia.

### Divisão das respostas

Cada **quebra de linha** na resposta do modelo vira uma mensagem separada no WhatsApp. O roteiro deve instruir o agente a escrever uma ideia por linha. O motor acrescenta essa regra automaticamente ao prompt.

### "Digitando..." (humanização)

Aba Configurações, painel **Ritmo e memória**: com **Mostrar "digitando..."** ligado (`typing.enabled`), antes de cada linha o CRM manda a presença de digitação no número do lead e espera um tempo proporcional ao TAMANHO daquela linha — `caracteres × ms_per_char`, entre `min_ms` e `max_ms` (padrões 45 ms/caractere, 0,8 s e 8 s). Mensagem maior = mais tempo digitando. Ligado, ele substitui o **Intervalo entre linhas** (somar os dois deixaria o atendimento arrastado); desligado, tudo continua como antes. A presença depende do provedor: a Evolution (QR) mostra o "digitando" de verdade; na API oficial da Meta só a espera acontece. O tempo entra no orçamento da trava da conversa (`lockSecondsFor`).

### O que o agente sabe do lead

Aba Roteiro, painel **O que ele sabe do lead** (`lead_context`): a **descrição do negócio** e os **campos personalizados** entram no bloco "DADOS DO LEAD" do prompt e podem ser desligados um a um (ambos ligados por padrão). A descrição cabe até 2.500 caracteres (os outros campos, 600), porque costuma guardar o histórico do lead. Além disso, o campo **`deals.ai_context`** — escrito pela integração no cadastro (`POST /deals { ai_context }`) ou depois (`PATCH /deals/{id}`) — entra sempre, junto do contexto que a equipe escreve ao iniciar o atendimento, no bloco "CONTEXTO ADICIONAL INFORMADO PELA EQUIPE". Serve para deixar o contexto pronto no lead mesmo sem ativar a IA naquele momento.

### Mídia do lead (áudio, imagem, figurinha, documento)

Painel **O que ele sabe do lead** → "Mídia que o lead manda" (`media_understanding`, tudo ligado por padrão). Antes de montar a resposta, o motor pega as mensagens novas com arquivo e as transforma em TEXTO usando a **IA do próprio agente** (chave e modelo dele): áudio transcrito (whisper-1 da OpenAI; o Google ouve o arquivo direto), imagem e figurinha descritas pelo modelo (com a legenda do lead junto), PDF/DOCX/TXT extraídos localmente (`unpdf`/`mammoth`, sem custo de IA).

**Chave da OpenAI só para o áudio** (`audio_api_key`, campo dentro do mesmo painel): opcional e usada exclusivamente na transcrição, qualquer que seja o provedor. Existe porque a **Anthropic não transcreve áudio** — com ela, um agente Claude passa a ouvir. A ordem é: chave dedicada do agente → chave do próprio provedor (OpenAI e Google) → chave da OpenAI da organização (Central de I.A.) → nenhuma, e aí o áudio segue como "[áudio]" com um evento `media_skipped` na execução. Como a chave da API do agente, ela nunca volta em claro para a tela (a API devolve só `has_audio_api_key`).

O texto é gravado em `wa_messages.transcription` — o mesmo campo que o chat mostra — então cada arquivo é processado UMA vez e o atendente humano vê o mesmo que o agente. Limites por resposta: 3 arquivos, 14 MB de áudio, 8 MB de imagem, 10 MB de documento e 4.000 caracteres de texto extraído. Falha nunca derruba o atendimento: fica um evento (`media_error`) na execução e a mensagem segue com o marcador. Cada arquivo entendido aparece como `media_understood` no histórico da execução.

### Memória

O agente lê o histórico da própria conversa (`wa_messages`), inclusive o que o atendente humano escreveu (marcado como `[Atendente humano]`), e um estado curto que ele mesmo salva (`salvar_dados`). Não existe tabela de memória separada.

### Quando encerrar

O agente precisa ter um momento claro em que para. Isso mora em dois campos da configuração, sem depender de o roteiro lembrar de dizer:

- **Quando encerrar** (`stop_rules`, aba Roteiro, logo abaixo do roteiro): as regras de encerramento em linguagem natural (ex.: "encerrar quando tiver nome, cidade e resumo do caso" ou "quando a pessoa pedir para falar com alguém da equipe") e o que dizer na mensagem final. O motor injeta o texto no prompt como bloco `# QUANDO ENCERRAR` logo depois do roteiro (com as mesmas variáveis e marcadores `[[acao:...]]`/`[[midia:...]]`) e acrescenta às instruções do sistema que essas regras são **obrigatórias**: assim que uma delas se cumprir, o agente escreve a mensagem final e chama `encerrar_atendimento` na mesma resposta, escolhendo um dos resultados da aba Ações. Agentes novos já vêm com um texto padrão (`DEFAULT_STOP_RULES`); agentes criados antes continuam com a seção de encerramento dentro do próprio roteiro (o campo fica vazio e nada muda para eles até alguém preencher).
- **Limite de respostas por atendimento** (`max_replies`, aba Roteiro, dentro de "Quando encerrar"; 0 = sem limite): teto de respostas do agente numa mesma conversa, contado em `ai_state.respostas`. Na resposta que atinge o teto, o motor avisa o modelo que aquela é a última mensagem (`LIMITE DE RESPOSTAS ATINGIDO`) e pede a mensagem final com `encerrar_atendimento`, com o resultado mais adequado ao que ele já sabe; sem resultados configurados (ou se o modelo não chamar a ferramenta), o CRM encerra o atendimento sozinho depois dessa resposta. É a garantia de que o agente sempre para.

### Esteira (vários agentes)

O agente encerra chamando a ferramenta `encerrar_atendimento(resultado, resumo)`. As ações do resultado decidem o que acontece:

- **Passar para outro agente**: o próximo assume a mesma conversa com um resumo de passagem e responde na hora. A memória é contínua: ele enxerga o mesmo histórico da conversa (limite de mensagens dele) e os dados salvos pelo agente anterior (`salvar_dados`); só o contador de respostas zera.
- **Pedir aprovação humana**: a conversa fica "aguardando aprovação"; o chat mostra o resumo com **Aprovar** (o próximo agente assume) e **Recusar** (o agente para e o humano assume).
- **Encerrar**: o agente para e a conversa fica com o atendente.

As demais ações do resultado (e das ações durante a conversa) mexem no negócio: nota, mover etapa, rótulo, marcar perdido, atribuir responsável, **cadastrar produto** (`set_product`: lança um produto do catálogo como item do negócio, sem duplicar se já estiver lá), **escrever na descrição do lead** (`append_description`: anexa o resumo do encerramento — ou os detalhes da ação durante a conversa — numa linha nova da descrição do negócio, com um texto de abertura opcional), criar tarefa e chamar webhook.

### Follow-ups (lead sem responder)

Na aba Gatilhos do agente, painel **Follow-ups**: regras "depois de N min/h/dias sem resposta do lead → o agente manda uma mensagem (com instrução opcional) ou um robô entra em ação". O tick de 30 s (`processFollowups`) olha as conversas ativas do agente em que a última mensagem é dele; o relógio conta da primeira mensagem enviada depois da última recebida (nunca antes de o agente entrar). Cada regra dispara uma vez por ciclo de silêncio (`ai_state.followups`); o lead respondeu, a régua recomeça. Regra do agente num número da API oficial só roda dentro da janela de 24 h (opção "só dentro da janela"); fora dela é pulada, e a saída é uma regra com robô que mande um **Modelo de mensagem**. O robô roda preso à conversa **sem parar o agente**: enquanto o robô estiver esperando resposta (Modelo com botões, Esperar resposta), a resposta do lead vai para o robô; quando o robô termina, a próxima mensagem do lead volta para o agente. Para o agente responder na hora (sem esperar o lead escrever de novo), termine o robô com **Entregar a agente** apontando para o mesmo agente — ele preserva dados salvos, follow-ups feitos e memória; robôs com gatilho **Follow-up do agente de IA** só entram por essas regras (os manuais também podem ser escolhidos). Execução registrada com gatilho "Follow-up".

### Pausa e parada no chat

- Atendente responde pelo CRM ou pelo celular → o agente **pausa** por N minutos (configurável) e retoma sozinho lendo o que foi dito no meio tempo. Se o atendente continuar falando, o relógio reinicia.
- A faixa acima do campo de texto só aparece enquanto há algo em andamento: **Pausar / Retomar**, **Parar** (encerra de vez nesta conversa; vale também para o agente externo, o n8n via API), **Cancelar robô** (interrompe o robô em andamento) e **Aprovar / Recusar**. Com tudo parado, a faixa some.
- **Automações** (botão ✨ ao lado do emoji/anexo no compositor): abre a lista de agentes de IA **e** de robôs ligados. Escolher um agente mostra um passo de confirmação com **Contexto adicional (opcional)** (robô não tem contexto: usa só o card e a conversa): um texto escrito pela equipe que entra no prompt do agente como fato conhecido (bloco "CONTEXTO ADICIONAL INFORMADO PELA EQUIPE") e vira a variável `{{contexto_extra}}` nas mensagens do robô (e segue para o agente quando o robô entrega). Ao iniciar um robô, o agente da conversa, se houver, para. Com agente ou robô em andamento, o popover só avisa (pare pela faixa para trocar).
- **Limpar memória do agente nesta conversa** (rodapé do popover Automações): o agente para, esquece o que veio antes (só enxerga mensagens a partir daquele momento, `ai_state.memoria_desde`) e a conversa volta a "sem agente", como um contato novo. O histórico do chat continua visível para a equipe. Serve para recomeçar um teste do zero.
- **Ao ser ativado** (Configurações do agente): **Já envia a primeira mensagem** (padrão) ou **Espera a próxima mensagem do contato**. Vale para Automações no chat e para o início pelo pipeline: no segundo modo a conversa fica ativa com o agente e ele só fala quando o contato escrever. Por palavra-chave ele sempre responde à mensagem que o ativou.
- Quando o agente chama `encerrar_atendimento` com um resultado válido, a conversa fica **parada** (o chat mostra que ele não está mais ativo), mesmo que o resultado não tenha a ação "parar".

### Gatilhos do agente

| Gatilho | Configuração | O que acontece |
|---|---|---|
| Mensagem recebida (qualquer) | padrão | Conversa nova num número vinculado inicia o agente. Só em conversa **sem estado** (que nunca teve agente) |
| Mensagem recebida (específica) | palavras-chave | Só inicia se a mensagem contiver alguma das palavras. Também **assume** uma conversa de agente externo ativo (n8n via API), que passa a receber 409 |
| Nunca por mensagem | | O agente só entra por passagem de outro agente, pelo pipeline ou na mão |
| Cadastro no pipeline | negócio criado (quadro opcional) ou entrou numa etapa + número que envia | O agente **manda a primeira mensagem sozinho**, com os dados do cadastro (título, valor, etapa, rótulos, descrição e campos personalizados) no contexto, sem perguntar o que já consta. Também assume uma conversa de agente externo ativo |

Conversa **parada** (pelo botão Parar, por um encerramento do próprio agente ou pela API) **nunca é reaberta por gatilho automático**: quem já foi atendido pela IA só volta a ser atendido se alguém, na mão, usar **Limpar memória** e/ou iniciar um agente ou robô pelo botão Automações. Conversa pausada (atendente na conversa) também não recebe gatilho.

### Ações durante a conversa

Além do encerramento, o agente pode executar ações **no meio** da conversa: você descreve em linguagem natural quando acontece ("o cliente disse que já tem advogado", "o cliente pediu para falar com humano") e o que fazer (webhook com corpo personalizável, nota, etapa, rótulo, responsável, tarefa, marcar perdido). O modelo chama a ferramenta `executar_acao` no momento certo e segue a conversa. O evento `custom_action` também dispara os webhooks por evento do agente.

### Conhecimento, mídias, auxiliares e ferramentas

- **Base de conhecimento**: envie PDF, DOCX, TXT ou Markdown na aba "Conhecimento e mídias". O CRM extrai o texto, divide em trechos e indexa (busca vetorial quando há chave OpenAI ou Google; senão, busca por texto em português). Os trechos relevantes para a última mensagem do lead entram sozinhos no contexto; o agente também pode pesquisar com `consultar_documentos`. Arquivos ficam num bucket privado, acessível só pelo servidor.
- **Mídias**: imagem, vídeo, áudio ou PDF com uma descrição de quando enviar. O agente envia com `enviar_midia` (ou no ponto do roteiro marcado com `[[midia:nome]]`).
- **Agentes auxiliares**: outros agentes que este pode consultar durante a conversa (`consultar_agente`), por exemplo um especialista jurídico que responde com base nos próprios documentos.
- **Calculadora**: `calcular` para contas (parcelas, prazos, percentuais), sem o modelo "chutar" números.
- **Marcadores no roteiro**: `[[acao:chave]]` marca o momento exato de uma ação durante a conversa; `[[midia:nome]]` o momento de enviar uma mídia. Os chips do editor podem ser clicados ou arrastados para dentro do texto.

### Base de conhecimento (RAG)

Upload (PDF, DOCX, TXT, MD) → extração de texto → trechos por parágrafo/frase (~900 caracteres, sobreposição de 150) → embeddings (OpenAI text-embedding-3-small ou Google gemini-embedding-001, 1536 dims, com a chave da org) → busca vetorial (`wa_ai_match_chunks`, limiar por provedor) com reserva por texto (`wa_ai_search_chunks`). A pergunta do cliente é buscada automaticamente a cada resposta e o agente ainda tem a ferramenta `consultar_documentos`. **Metadados por documento** (lápis na lista): título, descrição e etiquetas. Eles viram o cabeçalho de cada trecho na hora de vetorizar ("Documento: título. descrição [etiquetas]" + trecho — o vetor sabe de que assunto o trecho é) e entram na lista "Documentos da base de conhecimento" do prompt (o agente sabe o que cada um cobre). Salvar metadados reprocessa o documento. Precisa da migração `20260827120000_wa_ai_agent_documents_metadata` (colunas title/description/tags); sem ela o resto funciona e a edição avisa.

### Contexto oculto

Sem escrever nada no roteiro, o CRM já injeta: data e hora, nome e telefone do lead, dados do negócio (etapa, valor, rótulos, campos personalizados), histórico da conversa (inclusive o que atendentes humanos escreveram) e os trechos da base de conhecimento. O roteiro fica só com papel, condução, regras e tom.

### Ajustar com IA

No painel de teste do agente, descreva o que ele fez de errado ("se apresentou duas vezes", "ofereceu desconto") e a IA reescreve o roteiro aplicando a correção, mantendo o resto igual. Usa a chave de IA da organização.

## Robôs (sem IA)

**Números do robô** (`connection_ids`): o robô atende SÓ os números marcados na barra do editor (dá para marcar vários). Ele não entra em conversa de outro número — o menu Automações do chat nem oferece, e a API devolve 409 `BOT_CONNECTION_NOT_ALLOWED`. Na API, `connection_id` escolhe por qual número iniciar; omitido, vale o primeiro do robô (antes ia pelo número da conversa/padrão da org, e um robô do número oficial acabava falando pelo QR). Robôs criados antes da mudança seguem com o número único que tinham.

**Número que inicia pelo gatilho**: no nó Gatilho do quadro dá para escolher por qual número a conversa começa quando o robô dispara pelo pipeline (o lead ainda não tem conversa). Vazio = o primeiro número do robô; o escolhido precisa estar entre os números dele. No agente de IA o mesmo campo já existia (aba Gatilhos e números → "Número que inicia a conversa").

**Fora da janela de 24 h** (API oficial): o bloco "Janela de 24 h encerrada" do chat agora traz o menu **Automações** junto do "Reiniciar com um modelo" — dá para iniciar um robô cujo primeiro passo é um **Modelo de mensagem**, que sai como template aprovado e reabre a conversa. Robô que comece com texto comum continua falhando fora da janela (regra da Meta).

Fluxo de mensagens predefinidas montado num **quadro visual** (estilo Typebot/ManyChat): **balões** com vários blocos empilhados, ligados por setas. Disparado quando um negócio é **criado** (opcionalmente num board) ou **entra numa etapa**, ou na mão. Precisa de um número (conexão) para enviar. O telefone vem do contato do negócio.

- **Robô novo começa vazio**: só o gatilho no quadro (nada de exemplo para ficar excluindo) e **desligado** (rascunho). Arraste um bloco da paleta, clique nele ou use "Começar com uma mensagem"; o primeiro balão já sai ligado ao gatilho. Salvar sem balões ou com o gatilho solto é permitido só com o robô desligado; **ligar** exige o gatilho ligado a um balão (a API recusa com mensagem clara, inclusive pela chave da lista).
- **Balões com vários blocos**: um balão é uma lista ordenada de blocos (Mensagem, embaixo outra Mensagem, depois Esperar, e assim por diante). Blocos lineares (Mensagem com variáveis, Esperar, Mover etapa, Rótulo, Webhook) entram em qualquer posição; blocos com mais de uma saída (Esperar resposta: "Respondeu"/"Sem resposta"; Condição (estilo Typebot/Switch): uma saída por **caminho** + "Senão"; cada caminho tem uma ou mais condições **campo · operador · valor** combinadas por E/OU — campos: última resposta, rótulos, etapa, quadro, nome/telefone do contato, título/valor/origem do negócio, campo personalizado (por chave), contexto adicional; operadores: contém, não contém, igual, diferente, começa/termina com, vazio/não vazio, maior/menor (valor); Modelo de mensagem: uma saída por botão de resposta rápida + "Outra resposta" + "Sem resposta") e terminais (Entregar a um agente de IA, Encerrar) só podem ser o **último** do balão (a interface impede e explica). As saídas do último bloco são as saídas do balão (à direita, no rodapé); a entrada fica à esquerda, no cabeçalho. Clique no bloco abre o painel de propriedades (gaveta à direita no desktop, folha inferior no celular); "+ Adicionar bloco" no rodapé abre o mesmo catálogo da paleta; reordene arrastando pela alça ou com os botões de subir/descer (dá para levar um bloco para outro balão); duplo clique no título renomeia; o menu "⋯" duplica, copia ou exclui. Soltar um bloco da paleta sobre um balão adiciona ao fim dele; no quadro vazio cria um balão novo. Problemas (mensagem vazia, regra sem ligação, bloco de várias saídas fora do fim...) aparecem marcados no próprio balão e no bloco.
- **Digitando**: mostra "digitando..." ao contato por N segundos (1 a 60; presença na Evolution, só espera na API oficial) e segue. **Esperar** aceita segundos (esperas de até 25 s acontecem dentro da execução; acima disso pelo relógio de 30 s). **Iniciar outro robô** (terminal): este robô termina e o outro começa na mesma conversa, com contato/negócio/contexto; até 5 em cadeia.
- **Modelo de mensagem**: bloco que envia um modelo cadastrado em Configurações → Modelos. Modelo do WhatsApp API sai como template de verdade pela Meta (funciona fora da janela de 24 h e leva os botões aprovados; só modelos APROVADOS podem ser escolhidos); modelo geral, ou número conectado por QR, vai como texto preenchido. Variáveis `{{contato.nome}}`, `{{contato.telefone}}`, `{{lead.titulo}}` e `{{lead.etapa}}` vêm do contato e do negócio; as demais ficam "-" na Meta (ela rejeita parâmetro vazio). No chat a mensagem aparece com o texto preenchido. Depois de enviar, o bloco **espera a resposta** (prazo configurável, padrão 24 h): cada **botão de resposta rápida** do modelo vira uma saída do balão (a resposta do lead é comparada ao texto do botão), texto livre sai por "Outra resposta" e o prazo esgotado por "Sem resposta"; botões de link/telefone não geram saída. Por isso o bloco é sempre o último do balão.
- **Copiar, colar, duplicar**: seleção múltipla (Shift + arrastar no fundo, Shift + clique), Ctrl/Cmd+C, Ctrl/Cmd+V (cola com deslocamento de 40 px, ids novos, ligações entre os balões copiados preservadas e ligações externas descartadas), Ctrl/Cmd+D ou "Duplicar" no menu do balão, Delete/Backspace exclui a seleção (o gatilho nunca sai). **Desconectar**: cada seta tem um × no meio que remove só a ligação (os dois balões ficam); selecionar a seta e apertar Delete faz o mesmo. A área de transferência é interna ao editor, com aviso ("2 balões copiados"). Atalhos listados no botão "?" do quadro; paleta recolhível (só ícones) e, no celular, barra inferior; minimapa opcional; ajustar à tela.
- **Como fica salvo**: os passos continuam **planos** em `wa_bots.steps` (o motor não mudou): dentro do balão cada passo aponta para o seguinte por `next_step_id`, e a saída do último bloco aponta para o primeiro passo do balão de destino; `start_step_id` é o primeiro passo do balão ligado ao gatilho. O desenho vai em `wa_bots.layout` (`{ groups: [{ id, name, x, y, step_ids }] }`), que a API confere (todo `step_id` existe, cada passo em no máximo um balão, blocos de várias saídas/terminais só no fim, encadeamento interno batendo com `next_step_id`). Robôs salvos antes dos balões (um passo por nó, `ui` em cada passo) abrem como um balão por passo e passam a gravar `layout` ao salvar; robôs mais antigos ainda, em lista (sem `start_step_id`), continuam sendo convertidos automaticamente para o quadro ao abrir.

## Como roda por baixo

```
mensagem recebida ──trigger trg_wa_ai_agent_ingest──▶ POST /api/wa-agents/ingest (X-Internal-Secret)
                                                        └─ espera o buffer, confere se chegou msg mais nova,
                                                           trava a conversa (wa_ai_claim_lock), monta contexto,
                                                           chama o modelo com as ferramentas, envia linha a linha,
                                                           registra em wa_ai_agent_runs, dispara webhooks, aplica ações

negócio criado / mudou de etapa ──trigger trg_wa_bot_on_deal──▶ wa_bot_runs + POST /api/wa-agents/tick
pg_cron 'wa-agents-tick' (30 s, só se houver algo pendente) ──▶ POST /api/wa-agents/tick
                                                        └─ retoma pausas vencidas, executa passos dos robôs
```

Tabelas novas: `wa_ai_agents` (com `custom_actions`, `triggers`, `helper_agent_ids`, `tools`, `stop_rules`, `max_replies`), `wa_ai_agent_runs`, `wa_ai_agent_deal_starts` (fila dos inícios pelo pipeline), `wa_ai_agent_documents` + `wa_ai_agent_chunks` (base de conhecimento, extensão `vector`), `wa_ai_agent_media`, `wa_bots` (com `start_step_id`), `wa_bot_runs`. Bucket privado `wa-agent-files`.

### Conexão via QR e n8n

No cartão de qualquer número conectado (QR ou API oficial) há **ID da conexão** e **Espelhar webhook**.

- **Espelhar webhook** funciona para todos os provedores. Para números via QR (`evolution`) e API oficial via Evolution (`evolution_business`), a Edge Function `whatsapp-webhook` continua dona do webhook da Evolution e, depois de validar o segredo da URL e achar a conexão, repassa o corpo bruto de cada evento (o JSON original, ex.: `messages.upsert`, `messages.update`, `connection.update`) para a URL salva em `wa_connections.forward_webhook_url`. Headers do repasse: `content-type: application/json`, `user-agent: NossoCRM-Webhook-Mirror/1.0`, `X-Webhook-Secret` (o `webhook_secret` da conexão, o mesmo que fecha a URL do webhook cadastrada na Evolution, para o outro sistema conferir a origem), `X-Connection-Id` (o ID da conexão, para filtrar no n8n) e `X-Evolution-Event` (o `event` do payload). O repasse roda em segundo plano (timeout de 8 s, falha só vai para o log) e nunca altera a resposta à Evolution nem a gravação no CRM; corpos sem `event` não são repassados. Para números da API oficial direta (`meta_cloud`), o repasse é feito pela função `whatsapp-webhook-meta`, assinado com `x-hub-signature-256` como a Meta faz. A URL do espelho precisa ser `https://` e não pode ser do próprio CRM; ligar e desligar é pela rota `PATCH /api/whatsapp/connection/forward` (só admin).
- Para receber no n8n as mensagens já tratadas pelo CRM (de qualquer número), use Configurações → Integrações → Follow-up com os eventos `whatsapp.message.received` / `whatsapp.message.sent` e filtre pelo ID da conexão; para enviar, use a API pública (`POST /api/public/v1/whatsapp/messages` com `connection_id`).

Nada do funcionamento atual muda. Colunas novas em `wa_conversations`: `ai_agent_id`, `ai_resume_at`, `ai_state`, `ai_last_processed_at`, `ai_lock_until`, `ai_approval`; `ai_status` aceita também `stopped` e `awaiting_approval`.

Mensagens enviadas pelo agente têm `source = 'agent'`; pelo robô, `source = 'bot'` (aparecem no webhook `whatsapp.message.sent`).

## O que precisa existir por ambiente

1. **Migrações** `20260825200000_wa_ai_agents_beta.sql`, `20260825230000_wa_ai_agents_triggers.sql`, `20260826000000_wa_ai_agents_knowledge.sql` e `20260826120000_wa_ai_agents_stop_rules.sql` (colunas `stop_rules` e `max_replies` em `wa_ai_agents`) aplicadas (habilitam `pg_net`, `pg_cron` e `vector`).
2. **`platform_config`** com duas linhas (é assim que o banco encontra o CRM):
   - `wa_agents_app_url` = URL base do CRM naquele ambiente (ex.: `https://crm.anunciojuridico.com.br`; no preview, a URL da branch na Vercel).
   - `wa_agents_internal_secret` = o mesmo valor da variável de ambiente abaixo.
3. **Variável de ambiente na Vercel**: `WA_AGENTS_INTERNAL_SECRET` ou, na falta dela, o `CRON_SECRET` já existente (o mesmo valor gravado em `wa_agents_internal_secret`). Sem isso as rotas internas respondem 401 e nada acontece.
4. Chave de IA da organização em Configurações → Central de I.A (ou chave própria no agente).

## Rotas

Sessão (membros da org; escrita só admin): `/api/wa-agents/access`, `/api/wa-agents/agents[/{id}[/test]]`, `/api/wa-agents/runs`, `/api/wa-agents/bots[/{id}[/start]]`, `/api/wa-agents/bot-runs`, `/api/wa-agents/options`, `/api/wa-agents/conversation` (qualquer membro: pausar/retomar/parar/iniciar/aprovar/recusar/iniciar robô/cancelar robô).

Internas (header `X-Internal-Secret`): `POST /api/wa-agents/ingest`, `POST /api/wa-agents/tick`.

Públicas (header `X-Api-Key`, para n8n/Make — só com a beta ligada na org, senão 409 `AGENTS_OFF`):

- `GET /api/public/v1/whatsapp/agents` e `GET /api/public/v1/whatsapp/bots`: descobrem o `agent_id`/`bot_id`.
- `POST /api/public/v1/whatsapp/conversations/agent` `{ phone, action: start|pause|resume|stop|context|reset_memory, agent_id?, context?, append?, connection_id? }` — `connection_id` escolhe por qual número iniciar; omitido, vale o número do gatilho do agente, depois o primeiro número dele, e só então o padrão da org: mesma coisa que os botões do chat fazem com o agente nativo. `context` grava `ai_state.contexto_extra` sem reiniciar o atendimento (`append: true` acrescenta ao que já existe).
- `POST /api/public/v1/whatsapp/conversations/bot` `{ phone, action: start|stop, bot_id?, context?, connection_id? }`: inicia/para um robô na conversa (iniciar para o agente, como no menu Automações).
- `POST /api/public/v1/whatsapp/conversations/ai` continua sendo do agente EXTERNO (n8n como cérebro).

## Fora desta versão (próximas)

Horário de funcionamento e relatórios de custo por agente.
