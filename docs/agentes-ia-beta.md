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

### Divisão das respostas

Cada **quebra de linha** na resposta do modelo vira uma mensagem separada no WhatsApp. O roteiro deve instruir o agente a escrever uma ideia por linha. O motor acrescenta essa regra automaticamente ao prompt.

### Memória

O agente lê o histórico da própria conversa (`wa_messages`), inclusive o que o atendente humano escreveu (marcado como `[Atendente humano]`), e um estado curto que ele mesmo salva (`salvar_dados`). Não existe tabela de memória separada.

### Quando encerrar

O agente precisa ter um momento claro em que para. Isso mora em dois campos da configuração, sem depender de o roteiro lembrar de dizer:

- **Quando encerrar** (`stop_rules`, aba Roteiro, logo abaixo do roteiro): as regras de encerramento em linguagem natural (ex.: "encerrar quando tiver nome, cidade e resumo do caso" ou "quando a pessoa pedir para falar com alguém da equipe") e o que dizer na mensagem final. O motor injeta o texto no prompt como bloco `# QUANDO ENCERRAR` logo depois do roteiro (com as mesmas variáveis e marcadores `[[acao:...]]`/`[[midia:...]]`) e acrescenta às instruções do sistema que essas regras são **obrigatórias**: assim que uma delas se cumprir, o agente escreve a mensagem final e chama `encerrar_atendimento` na mesma resposta, escolhendo um dos resultados da aba Ações. Agentes novos já vêm com um texto padrão (`DEFAULT_STOP_RULES`); agentes criados antes continuam com a seção de encerramento dentro do próprio roteiro (o campo fica vazio e nada muda para eles até alguém preencher).
- **Limite de respostas por atendimento** (`max_replies`, aba Configurações; 0 = sem limite): teto de respostas do agente numa mesma conversa, contado em `ai_state.respostas`. Na resposta que atinge o teto, o motor avisa o modelo que aquela é a última mensagem (`LIMITE DE RESPOSTAS ATINGIDO`) e pede a mensagem final com `encerrar_atendimento`, com o resultado mais adequado ao que ele já sabe; sem resultados configurados (ou se o modelo não chamar a ferramenta), o CRM encerra o atendimento sozinho depois dessa resposta. É a garantia de que o agente sempre para.

### Esteira (vários agentes)

O agente encerra chamando a ferramenta `encerrar_atendimento(resultado, resumo)`. As ações do resultado decidem o que acontece:

- **Passar para outro agente**: o próximo assume a mesma conversa com um resumo de passagem e responde na hora.
- **Pedir aprovação humana**: a conversa fica "aguardando aprovação"; o chat mostra o resumo com **Aprovar** (o próximo agente assume) e **Recusar** (o agente para e o humano assume).
- **Encerrar**: o agente para e a conversa fica com o atendente.

### Pausa e parada no chat

- Atendente responde pelo CRM ou pelo celular → o agente **pausa** por N minutos (configurável) e retoma sozinho lendo o que foi dito no meio tempo. Se o atendente continuar falando, o relógio reinicia.
- A faixa acima do campo de texto só aparece enquanto há algo em andamento: **Pausar / Retomar**, **Parar** (encerra de vez nesta conversa; vale também para o agente externo, o n8n via API), **Cancelar robô** (interrompe o robô em andamento) e **Aprovar / Recusar**. Com tudo parado, a faixa some.
- **Automações** (botão ✨ ao lado do emoji/anexo no compositor): abre a lista de agentes de IA **e** de robôs ligados. Escolher um mostra um passo de confirmação com **Contexto adicional (opcional)**: um texto escrito pela equipe que entra no prompt do agente como fato conhecido (bloco "CONTEXTO ADICIONAL INFORMADO PELA EQUIPE") e vira a variável `{{contexto_extra}}` nas mensagens do robô (e segue para o agente quando o robô entrega). Ao iniciar um robô, o agente da conversa, se houver, para. Com agente ou robô em andamento, o popover só avisa (pare pela faixa para trocar).
- **Limpar memória do agente nesta conversa** (rodapé do popover Automações): o agente para, esquece o que veio antes (só enxerga mensagens a partir daquele momento, `ai_state.memoria_desde`) e a conversa volta a "sem agente", como um contato novo. O histórico do chat continua visível para a equipe. Serve para recomeçar um teste do zero.
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

### Contexto oculto

Sem escrever nada no roteiro, o CRM já injeta: data e hora, nome e telefone do lead, dados do negócio (etapa, valor, rótulos, campos personalizados), histórico da conversa (inclusive o que atendentes humanos escreveram) e os trechos da base de conhecimento. O roteiro fica só com papel, condução, regras e tom.

### Ajustar com IA

No painel de teste do agente, descreva o que ele fez de errado ("se apresentou duas vezes", "ofereceu desconto") e a IA reescreve o roteiro aplicando a correção, mantendo o resto igual. Usa a chave de IA da organização.

## Robôs (sem IA)

Fluxo de mensagens predefinidas montado num **quadro visual** (estilo Typebot/ManyChat): balões de mensagem e blocos ligados por setas. Disparado quando um negócio é **criado** (opcionalmente num board) ou **entra numa etapa**, ou na mão. Blocos: Mensagem (com variáveis), Esperar, Esperar resposta (saídas "Respondeu" e "Sem resposta"), Condição (uma saída por regra de palavras-chave + "Senão"), Mover etapa, Rótulo, Webhook, Entregar a um agente de IA, Encerrar. Precisa de um número (conexão) para enviar. O telefone vem do contato do negócio. Robôs criados antes (em lista) são convertidos automaticamente para o quadro ao abrir.

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

Sessão (membros da org; escrita só admin): `/api/wa-agents/beta`, `/api/wa-agents/agents[/{id}[/test]]`, `/api/wa-agents/runs`, `/api/wa-agents/bots[/{id}[/start]]`, `/api/wa-agents/bot-runs`, `/api/wa-agents/options`, `/api/wa-agents/conversation` (qualquer membro: pausar/retomar/parar/iniciar/aprovar/recusar/iniciar robô/cancelar robô).

Internas (header `X-Internal-Secret`): `POST /api/wa-agents/ingest`, `POST /api/wa-agents/tick`.

## Fora desta versão (próximas)

Áudio/imagem/PDF recebidos (hoje entram como `[áudio]`/`[imagem]`; a transcrição salva no chat, quando existir, é usada), horário de funcionamento, relatórios de custo por agente.
