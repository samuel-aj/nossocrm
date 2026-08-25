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
| Comportamento | Buffer (segundos que espera para juntar mensagens picadas), histórico (quantas mensagens da conversa o agente lê), intervalo entre linhas, pausa automática quando um atendente responde (minutos; 0 = só retoma na mão), só conversas novas |
| Resultados e ações | Resultados possíveis do encerramento (ex.: qualificado, desqualificado) e o que fazer em cada um: passar para outro agente, pedir aprovação humana, encerrar, registrar nota, mover etapa, adicionar rótulo, marcar perdido, atribuir responsável, criar tarefa |
| Webhooks | Por evento (iniciado, mensagem recebida, resposta enviada, ferramenta usada, encerrado, passado para agente, aguardando aprovação, aprovado, recusado, pausado, retomado, parado, erro), com URL, segredo e corpo personalizável com `{{variáveis}}` |

### Divisão das respostas

Cada **quebra de linha** na resposta do modelo vira uma mensagem separada no WhatsApp. O roteiro deve instruir o agente a escrever uma ideia por linha. O motor acrescenta essa regra automaticamente ao prompt.

### Memória

O agente lê o histórico da própria conversa (`wa_messages`), inclusive o que o atendente humano escreveu (marcado como `[Atendente humano]`), e um estado curto que ele mesmo salva (`salvar_dados`). Não existe tabela de memória separada.

### Esteira (vários agentes)

O agente encerra chamando a ferramenta `encerrar_atendimento(resultado, resumo)`. As ações do resultado decidem o que acontece:

- **Passar para outro agente**: o próximo assume a mesma conversa com um resumo de passagem e responde na hora.
- **Pedir aprovação humana**: a conversa fica "aguardando aprovação"; o chat mostra o resumo com **Aprovar** (o próximo agente assume) e **Recusar** (o agente para e o humano assume).
- **Encerrar**: o agente para e a conversa fica com o atendente.

### Pausa e parada no chat

- Atendente responde pelo CRM ou pelo celular → o agente **pausa** por N minutos (configurável) e retoma sozinho lendo o que foi dito no meio tempo. Se o atendente continuar falando, o relógio reinicia.
- Botões no chat: **Pausar / Retomar**, **Parar** (encerra de vez nesta conversa), **Iniciar agente** (escolhe qual agente assume a conversa), **Aprovar / Recusar**.

## Robôs (sem IA)

Fluxo de mensagens predefinidas, disparado quando um negócio é **criado** (opcionalmente num board) ou **entra numa etapa**, ou na mão. Passos: enviar mensagem (com variáveis), esperar, esperar resposta (com prazo), condição por palavras-chave, mover etapa, adicionar rótulo, entregar a um agente de IA, encerrar. Precisa de um número (conexão) para enviar. O telefone vem do contato do negócio.

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

Tabelas novas: `wa_ai_agents`, `wa_ai_agent_runs`, `wa_bots`, `wa_bot_runs`. Colunas novas em `wa_conversations`: `ai_agent_id`, `ai_resume_at`, `ai_state`, `ai_last_processed_at`, `ai_lock_until`, `ai_approval`; `ai_status` aceita também `stopped` e `awaiting_approval`.

Mensagens enviadas pelo agente têm `source = 'agent'`; pelo robô, `source = 'bot'` (aparecem no webhook `whatsapp.message.sent`).

## O que precisa existir por ambiente

1. **Migração** `supabase/migrations/20260825200000_wa_ai_agents_beta.sql` aplicada (habilita `pg_net` e `pg_cron`).
2. **`platform_config`** com duas linhas (é assim que o banco encontra o CRM):
   - `wa_agents_app_url` = URL base do CRM naquele ambiente (ex.: `https://crm.anunciojuridico.com.br`; no preview, a URL da branch na Vercel).
   - `wa_agents_internal_secret` = o mesmo valor da variável de ambiente abaixo.
3. **Variável de ambiente na Vercel**: `WA_AGENTS_INTERNAL_SECRET` (ou, em produção, o `CRON_SECRET` já existente serve). Sem isso as rotas internas respondem 401 e nada acontece.
4. Chave de IA da organização em Configurações → Central de I.A (ou chave própria no agente).

## Rotas

Sessão (membros da org; escrita só admin): `/api/wa-agents/beta`, `/api/wa-agents/agents[/{id}[/test]]`, `/api/wa-agents/runs`, `/api/wa-agents/bots[/{id}[/start]]`, `/api/wa-agents/bot-runs`, `/api/wa-agents/options`, `/api/wa-agents/conversation` (qualquer membro: pausar/retomar/parar/iniciar/aprovar/recusar).

Internas (header `X-Internal-Secret`): `POST /api/wa-agents/ingest`, `POST /api/wa-agents/tick`.

## Fora desta versão (próximas)

Áudio/imagem/PDF recebidos (hoje entram como `[áudio]`/`[imagem]`; a transcrição salva no chat, quando existir, é usada), horário de funcionamento, relatórios de custo por agente.
