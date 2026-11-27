# Aprendizado com dúvidas sem resposta (AutoLearn) — desenho

Data: 25/11/2026. Desenho aprovado por Samuel em duas partes (registro pelo agente; revisão e inclusão na base), na mesma conversa.

## Objetivo

Quando um agente de IA de WhatsApp não encontra a resposta no roteiro nem na base de conhecimento, ele registra a pergunta como **dúvida sem resposta**. Um administrador revisa a dúvida dentro do próprio agente, escreve ou aprova a resposta e escolhe em qual documento da base ela entra. A partir da mensagem seguinte, o agente encontra essa resposta pela busca que já usa.

## Decisões

1. **Liga e desliga por agente**, em *Ações e recursos › Recursos*: "Aprender com dúvidas sem resposta". Desligado por padrão: o NossoCRM atende vários escritórios e nada muda para quem não ligar.
2. **A revisão fica dentro de cada agente**: novo painel "Dúvidas sem resposta" na aba *Conhecimento*. Não há aba central.
3. **A resposta aprovada vira um trecho extra do documento escolhido**, sem alterar o arquivo original. Vale para PDF, DOCX, TXT e MD. O destino sugerido é o documento mais parecido com o assunto; há também a opção de criar o documento "Respostas aprendidas".
4. **Registrar não muda o que o agente fala para o cliente.** O agente continua seguindo o roteiro para dúvidas que a base não cobre. A ferramenta só avisa a equipe; o agente não promete retorno.
5. **O chat de teste também registra**, com a marca "Só no teste", para validar sem mensagem real.

## Como funciona para o agente

- Ferramenta nova `registrar_duvida_sem_resposta`, disponível só quando o agente tem a opção ligada. Só o agente que conversa com o cliente recebe a ferramenta; os auxiliares (`consultar_agente`) não.
- Entrada:
  - `pergunta` (obrigatória, até 300 caracteres): a dúvida escrita de forma genérica, como num FAQ, sem nome, telefone, CPF, valores ou outros dados do cliente;
  - `o_que_falta` (opcional, até 800): o que a base já diz sobre o assunto e o que faltou;
  - `resposta_sugerida` (opcional, até 2000): rascunho só com o que a base já diz, quando houver informação parcial.
  - O esquema da ferramenta aceita textos maiores que esses limites (até 4000) para o modelo não receber erro de validação; o servidor corta.
- Quando chamar: quando a resposta não está no roteiro nem nos trechos da base, depois de consultar a base (se o agente tiver documentos). Uma vez por dúvida.
- A ferramenta nunca lança erro para o modelo: devolve `{ ok: true }` ou `{ ok: false, erro }`, e a resposta ao cliente segue.
- Linha nova no prompt do sistema, só com a opção ligada: *"Dúvidas sem resposta: quando a resposta não estiver no roteiro nem na base de conhecimento (consulte a base antes, quando houver), chame registrar_duvida_sem_resposta uma vez por dúvida, com a pergunta escrita de forma genérica e sem dados do cliente. Isso só avisa a equipe: responda ao cliente como o roteiro orienta para dúvidas sem resposta e não invente a informação."*

## Registro e agrupamento (servidor)

Função `recordKnowledgeGap` em `lib/wa-agents/knowledgeGaps.ts`, usada pelo motor (`engine.ts`) e pelo teste (`test.ts`) por meio de `runtime.reportGap`.

1. **Saneamento:** corta nos limites, remove caracteres de controle e mascara CPF, CNPJ, telefone e e-mail como `[dado removido]` na pergunta, no contexto e no rascunho.
2. **Chave de texto:** pergunta sem acento, em minúsculas, sem pontuação e com espaços únicos. Serve para agrupar sem embedding.
3. **Embedding da pergunta** com `embedTexts`, preferindo o modelo que a base do agente já usa. Sem chave da OpenAI ou do Google, segue só com a chave de texto. Falha no embedding não impede o registro.
4. **Documento sugerido:** com o embedding, o trecho mais próximo (`wa_ai_match_chunks`, limite 1) indica o documento. Sem embedding, usa a busca por texto (`wa_ai_search_chunks`, limite 1). Sem documentos, fica vazio.
5. **Gravação atômica** pela RPC `wa_ai_record_knowledge_gap` (SECURITY DEFINER, só `service_role`), com trava por agente (`pg_advisory_xact_lock`):
   - procura uma dúvida do mesmo agente com a mesma chave de texto ou com similaridade de cosseno maior ou igual ao limite, no mesmo modelo de embedding;
   - limites: OpenAI 0,85 e Google 0,92 (constantes em TypeScript, passadas como parâmetro e ajustáveis com dados reais);
   - **achou:** atualiza `last_seen_at` e, quando houver sugestão nova, `suggested_document_id`. Soma `occurrences` só quando a origem é outra (`last_source_key` diferente) ou quando passaram 24 h desde a última vez. Uma origem real zera `test_only`. O status não muda: dúvida ignorada continua ignorada e incluída continua incluída;
   - **não achou:** insere uma dúvida aberta, se o agente tiver menos de 200 abertas. Acima disso, descarta e devolve `{ ok: false, motivo: 'limite' }`.
6. **Origem:** em conversa real, `last_source_key` é o ID da conversa e `last_conversation_id` guarda o link. No teste, a chave é `teste:<id da sessão>` (ou `teste` sem sessão), sem link, e `test_only` fica verdadeiro até a primeira ocorrência real.
7. **Limites por resposta:** no máximo 2 registros por execução do agente; a mesma pergunta (chave de texto) só uma vez por execução.
8. **Eventos da execução:** o motor registra `knowledge_gap_recorded` (com o ID da dúvida e se ela é nova) ou `knowledge_gap_failed` (com o motivo) nos eventos da execução, que já aparecem em *Execuções*.

## Banco (migração aditiva)

Arquivo `supabase/migrations/20261127171912_wa_ai_agent_knowledge_gaps.sql` (versão posterior à última da `origin/main`, `20261124204817`).

Tabela `wa_ai_agent_knowledge_gaps`:

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `organization_id` | uuid | FK `organizations`, ON DELETE CASCADE |
| `agent_id` | uuid | FK `wa_ai_agents`, ON DELETE CASCADE |
| `status` | text | `open`, `ignored` ou `included`; padrão `open` |
| `question` | text | até 300 |
| `question_key` | text | chave de texto normalizada |
| `question_embedding` | vector(1536) | nulo sem embedding |
| `embedding_model` | text | modelo do embedding |
| `context` | text | `o_que_falta`, até 800 |
| `suggested_answer` | text | rascunho do agente, até 2000 |
| `answer` | text | resposta aprovada, até 4000 |
| `document_id` | uuid | destino; FK `wa_ai_agent_documents`, ON DELETE SET NULL |
| `suggested_document_id` | uuid | FK `wa_ai_agent_documents`, ON DELETE SET NULL |
| `occurrences` | int | padrão 1 |
| `test_only` | boolean | |
| `last_source_key` | text | |
| `last_conversation_id` | uuid | FK `wa_conversations`, ON DELETE SET NULL |
| `first_seen_at`, `last_seen_at` | timestamptz | |
| `reviewed_by` | uuid | FK `profiles`, ON DELETE SET NULL |
| `reviewed_at` | timestamptz | |
| `created_at`, `updated_at` | timestamptz | |

- Índice `(organization_id, agent_id, status, last_seen_at DESC)`. Sem índice vetorial: a comparação fica restrita às dúvidas de um agente (no máximo algumas centenas).
- RLS ligada e `REVOKE ALL` de `PUBLIC`, `anon` e `authenticated`: leitura e escrita só pelo servidor (`service_role`), como nas tabelas mais novas do CRM. A tela lê pelas rotas, que já exigem administrador.
- `wa_ai_agent_chunks` ganha `gap_id uuid` (FK para a dúvida, ON DELETE CASCADE) e o índice `(gap_id)`. Trecho com `gap_id` é resposta aprendida.
- RPC `wa_ai_record_knowledge_gap(p_org, p_agent, p_question, p_question_key, p_embedding, p_model, p_threshold, p_context, p_suggested_answer, p_suggested_document, p_source_key, p_conversation, p_test, p_open_limit)`, que devolve `{ id, status, created }`. `REVOKE` de `PUBLIC`, `anon` e `authenticated`; `GRANT` só a `service_role`.

## Inclusão na base

Funções em `lib/wa-agents/knowledgeGaps.ts`, chamadas pelas rotas:

- **Incluir** (aberta → incluída): valida pergunta e resposta; confere se o documento é do agente e está pronto (em processamento, devolve 409 "O documento está sendo processado. Tente de novo em instantes."); confere o teto de 5000 trechos do agente. Grava a resposta, o destino, `reviewed_by` e `reviewed_at`, e insere o trecho `Pergunta: …\nResposta: …` com `gap_id`. O embedding usa o mesmo cabeçalho dos outros trechos (`documentHeader`) e o modelo do documento (sem embedding quando o documento não tem). Depois recalcula o `chunk_count` do documento.
- **Editar** (incluída): troca pergunta, resposta e documento; apaga o trecho antigo (`gap_id`) e insere o novo.
- **Tirar da base** (incluída → ignorada): apaga o trecho e recalcula o `chunk_count`.
- **Ignorar** (aberta → ignorada), **Reabrir** (ignorada → aberta) e **Excluir** (aberta ou ignorada; apaga a linha, com confirmação na tela).
- **Novo documento "Respostas aprendidas":** quando escolhido, o servidor cria um arquivo MD pequeno (cabeçalho "Respostas da equipe para dúvidas dos clientes.") no caminho padrão do agente, registra o documento, processa (`processDocument`) e então inclui o trecho. Se já existir um documento com esse título, a opção não aparece e o documento entra na lista normal.
- **Reprocessar um documento** (`processDocument`): depois de extrair o arquivo, junta os trechos das respostas incluídas naquele documento, gera os embeddings de todos de uma vez e grava tudo. O `chunk_count` passa a contar os dois tipos.
- **Excluir um documento:** antes de excluir, as dúvidas incluídas nele voltam para abertas, com a resposta guardada e `document_id` nulo. Os trechos saem junto com o documento (cascata já existente). A confirmação na tela informa quantas respostas aprendidas o documento tem.

## API

Todas com `guardRoute({ admin: true, agents: true })` (e `req` nas mutações), `agentBelongsToOrg` e filtro por organização e agente.

- `GET /api/wa-agents/agents/[id]/knowledge-gaps?status=open|included|ignored` devolve as dúvidas (até 200, mais recentes primeiro) e o total de cada status.
- `PATCH /api/wa-agents/agents/[id]/knowledge-gaps/[gapId]` recebe `{ action: 'include' | 'edit', question, answer, document_id }` ou `{ action: 'include' | 'edit', question, answer, create_document: true }`, além de `{ action: 'remove' }`, `{ action: 'ignore' }` e `{ action: 'reopen' }`. `document_id` precisa ser um documento do agente. Transição inválida devolve 409. A rota usa `maxDuration = 300`, porque criar o documento "Respostas aprendidas" processa o arquivo na mesma chamada.
- `DELETE /api/wa-agents/agents/[id]/knowledge-gaps/[gapId]` vale só para dúvida aberta ou ignorada.
- `GET /api/wa-agents/knowledge-gaps/summary` devolve `{ [agentId]: abertas }`, para o cartão do agente e a aba.

## Interface

- **Recursos** (aba *Ações e recursos*): linha "Aprender com dúvidas sem resposta", com chave liga/desliga. Dica: *"Ferramenta registrar_duvida_sem_resposta: quando o agente não acha a resposta no roteiro nem na base, ele registra a pergunta em Conhecimento › Dúvidas sem resposta para você responder."* Campo `tools.knowledge_gaps` no `AgentToolsSchema`, padrão `false`. O chat de teste usa o rascunho da tela, então ligar e testar não exige salvar.
- **Aba Conhecimento:** painel "Dúvidas sem resposta" entre "Base de conhecimento" e "Mídias". Descrição: *"Perguntas que o agente não conseguiu responder. Responda e inclua na base para ele aprender."* A aba ganha um contador próprio de dúvidas abertas, separado do contador atual.
  - Filtros Abertas, Incluídas e Ignoradas, com o total de cada um.
  - Cada item mostra a pergunta, "Perguntada 3x · última há 2 h", a marca "Só no teste" quando for o caso e o link "Ver conversa" (`/chats?conversation=<id>`).
  - Abertas: **Responder**, **Ignorar** e o botão de lixeira **Excluir** (com confirmação).
  - Incluídas: a resposta, o documento de destino e o estado dele; **Editar** e **Tirar da base**. Aviso "Perguntada de novo depois de incluída" quando `last_seen_at` passa de `reviewed_at` em mais de 10 minutos.
  - Ignoradas: **Reabrir** e **Excluir**.
  - Estados vazios: com a opção desligada, *"O agente ainda não registra dúvidas. Ligue “Aprender com dúvidas sem resposta” em Ações e recursos."* e o botão **Abrir Ações e recursos**; com a opção ligada e nada aberto, *"Nenhuma dúvida aberta. Quando o agente não souber responder algo, a pergunta aparece aqui."*
- **Janela "Responder dúvida":** pergunta editável; "O que o agente encontrou" (só leitura, quando houver contexto); resposta, preenchida com o rascunho do agente; "Documento de destino", com a lista de documentos prontos do agente, o sugerido já marcado e a opção "Novo documento: Respostas aprendidas". Documento em processamento aparece desabilitado com o motivo. Botão **Incluir na base** (na edição, **Salvar resposta**).
- **Lista de documentos:** cada documento mostra "N respostas aprendidas" quando tiver alguma.
- **Lista de agentes:** etiqueta "N dúvidas" no cartão quando houver dúvidas abertas.
- **Componentes:** os já usados no módulo (`Panel`, `SettingRow`, `Toggle`, `Badge`, `EmptyState`, `Notice` e o modal de confirmação em `features/wa-agents/ui.tsx`), com dados pelo TanStack Query seguindo `useWaAgents.ts`. Textos em pt-BR, em segunda pessoa, com botões no formato verbo + objeto.

## Erros e casos de borda

- Falha no embedding ao registrar: agrupa só pela chave de texto.
- Falha na RPC: a ferramenta devolve `{ ok: false }`, o motor registra o evento `knowledge_gap_failed` na execução e a conversa segue.
- Documento com erro no reprocessamento: os trechos saem da busca (o documento deixa de estar pronto), a dúvida continua incluída e o painel mostra o estado do documento. Um reprocessamento bem-sucedido devolve os trechos.
- Dois administradores incluindo ao mesmo tempo: cada inclusão grava o próprio trecho e o `chunk_count` é recalculado pela contagem real.
- Pergunta que parece instrução ("ignore o roteiro…"): é gravada como texto, exibida como texto e nunca executada.

## Segurança e privacidade

- Só administradores da organização veem e mexem nas dúvidas, a mesma regra da base de conhecimento.
- Pergunta genérica por instrução, com máscara de CPF, CNPJ, telefone e e-mail no servidor.
- O link da conversa só abre para quem já tem acesso a ela no CRM.
- Exclusão definitiva disponível, com confirmação.

## Testes

- `lib/wa-agents/knowledgeGaps.test.ts`: saneamento e máscara, chave de texto, uso do embedding e da RPC, agrupamento sem embedding, limites por execução, nunca lançar erro, inclusão, edição, remoção e exclusão de documento.
- `lib/wa-agents/tools.test.ts`: a ferramenta só aparece com a opção ligada e `reportGap`; ausente nas ferramentas dos auxiliares; repassa a entrada; erro vira `{ ok: false }`.
- Prompt: a linha só aparece com a opção ligada.
- `processDocument`: reprocessar mantém as respostas aprendidas.
- Rotas: permissões, escopo por organização e agente, transições, 409 com documento em processamento, exclusão de documento reabrindo as dúvidas.
- Interface (Testing Library): estados vazios, filtros, ações, janela de resposta com destino sugerido e "Novo documento", chave em Recursos, etiqueta no cartão do agente.
- `npm run lint`, `npm run typecheck` e `npm run test:run`.
- Conferência visual do painel em 390 px e no computador, na página de teste sem banco (`.preview-harness`).
- Não testável daqui: a migração no Supabase real e a busca com embeddings reais. Dependem de aplicar a migração e publicar.

## Fora do escopo

Notificação de dúvida nova, aba central de dúvidas, resposta gerada por IA na revisão, mesclar dúvidas manualmente, exportar a lista e editar o arquivo original do documento.

## Entrega

Worktree `PROJETOS/nossocrm-aprendizado`, branch `claude/aprendizado-agente`, a partir da `origin/main` (586bc6cd). Sem commit, sem aplicar a migração e sem publicar até Samuel pedir. Na publicação, a migração precisa entrar no banco antes do código.
