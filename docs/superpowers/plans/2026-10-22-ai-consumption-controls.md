# AI Consumption Controls — Implementation Plan

## Objetivo e autorização

Opção B aprovada por Samuel em 23/10/2026: medição, trava e painel, com liberação manual pelo responsável e testes sem mensagens reais. Branch `codex/ai-consumption-controls`, base `527b39f47f1d18dca1e477179718a04cf92c2803`. Publicação deste escopo não foi solicitada. A [especificação](../specs/2026-10-22-ai-consumption-controls-design.md) registra o desenho e as referências da reunião SGM.

Arquitetura: registro durável por tentativa, conta de consumo por contato/conversa, concessões adicionais sem apagar histórico e reserva transacional antes da chamada paga. Adaptadores compartilhados pelo motor WhatsApp alimentam trava e painel. Next.js 16, React 19, TypeScript, AI SDK v6, Supabase/Postgres e TanStack Query.

## 1. Identidade e contratos — concluído

- [x] Contexto por organização, conta, conversa, agente, negócio, finalidade e tentativa idempotente; não registrar mensagens, prompts ou credenciais.
- [x] Resolver a mesma conta pelos vínculos existentes, contato verificado e telefone exato; não aproximar telefones ou nomes.
- [x] Agregar contas associadas sem duplicar consumo; trocar número/agente ou limpar memória não cria quota nova.
- [x] Guard de leitura reconhece bloqueios também antes da consolidação das contas associadas.
- [x] Separar tokens de duração de áudio. Modelos/operações sem limite verificável ficam indisponíveis no modo protegido.

Arquivos: `lib/ai-usage/{types,identity,context,budget}.ts`.

## 2. Registro durável e reserva — concluído localmente

- [x] Migração aditiva `20261023141552_ai_usage_controls.sql`: políticas, contas, vínculos, tentativas, concessões e avisos. Sem alterar/excluir cards, mensagens, contatos ou marcos comerciais.
- [x] Reserva e despacho revalidam política e quotas sob bloqueio de linha por organização. O despacho é concedido uma única vez.
- [x] Liquidação idempotente; chamadas possivelmente despachadas mantêm reserva pendente quando falta confirmação. Nenhum vencimento automático libera esse saldo.
- [x] Concessões positivas, com autor, motivo e idempotência; sem zerar consumo ou retomar o agente.
- [x] RLS e funções sensíveis restritas ao servidor; grants e tentativas não podem ser apagados/truncados pelo service role.
- [x] Políticas desativadas por padrão. Ativação requer quotas explícitas por conversa e por organização; janela organizacional móvel de 24 horas.
- [x] 65 verificações SQL isoladas em PGlite: quotas, replay, mudança de política, identidade, unidades, grants, permissões e preservação.
- [ ] Exercitar corrida em duas sessões PostgreSQL reais antes do piloto protegido. Nesta máquina não havia servidor PostgreSQL nem daemon Docker disponível; PGlite executou cenários serializados e os locks foram revisados, sem alegar concorrência física testada.

Fixtures em `supabase/tests/ai_usage*.sql`; runner `scripts/test-ai-usage-db.mjs` recebe um módulo PGlite local e nunca lê credenciais de ambiente.

## 3. Instrumentação — concluído

- [x] Medir cada chamada do modelo principal, ferramentas, revisões, auxiliares, extração de variáveis, imagens, áudio e embeddings.
- [x] Registrar consumo de simulador, configuração e indexação separadamente, sob a política da organização.
- [x] Desativar retries ocultos e fixar limite de saída; uma nova tentativa requer nova reserva.
- [x] Validar limites de entrada nos adaptadores protegidos, inclusive tamanho/duração da mídia. Não executar streaming ou modelo desconhecido sob promessa de teto.
- [x] Normalizar entrada, saída, cache e raciocínio sem duplicação. Falta de usage permanece desconhecida.
- [x] Falha persistente no contexto impede continuar mesmo quando uma ferramenta captura a exceção.
- [x] Tarifas oficiais versionadas para modelos do catálogo, embeddings e Whisper. Custo sem informação suficiente permanece indisponível; não inventar preço nem converter moeda.

Arquivos: `lib/ai-usage/{meteredModel,normalize,audioBound,pricing}.ts`, integrações em `lib/wa-agents/`. [Fontes e limites das tarifas](../specs/2026-10-23-ai-usage-pricing.md).

## 4. Bloqueio e liberação — concluído

- [x] Conferir bloqueio antes de novas execuções, início por lead, entrada de mensagem, retomadas e cron; verificar falha persistente antes de efeitos e envios.
- [x] Remover o antigo desbloqueio automático por tempo do orçamento; preservar pausas humanas e automações externas.
- [x] Nova mensagem ou botão genérico de retomar não concede saldo. O atendimento humano continua disponível.
- [x] API de concessão valida sessão, organização, mesma origem e permissão de responsável/admin antes da mutação.
- [x] Liberação mantém histórico e não envia mensagem nem retoma a IA automaticamente.
- [x] Aviso interno para responsável/admin com ID estável, independente de webhooks externos.
- [x] Editor preserva max_replies existente, em vez de zerá-lo silenciosamente.

## 5. Painel e interface — concluído

- [x] Configurações → IA e Automações → Consumo e limites; orçamento e concessão na conversa.
- [x] Totais do período, entrada/saída, custo estimado coberto, médias, bloqueios, pendências, evolução diária e ranking de atendimentos.
- [x] Filtros por período, provedor, modelo, finalidade e escopo; conta acumulada não depende do filtro de datas.
- [x] Todas as páginas consultadas com cursor estável e data de corte. Falha de consulta não vira total parcial aparentemente completo.
- [x] Média até contrato por negócio distinto e primeiro ganho; cobertura incompleta, pendências e vínculos ambíguos excluídos e explicados.
- [x] Permissões e isolamento de organização; detalhes somente para conversas autorizadas.
- [x] Prévia local com componentes reais e API simulada: desktop/mobile, vazio, bloqueio, grant, usuário não responsável; sem chamadas externas ou envio real.

Arquivos: `lib/ai-usage/{access,reporting,notifications}.ts`, `app/api/ai-usage/`, `features/ai-usage/`, query keys compartilhadas e integração no chat/Configurações.

## 6. Verificação e entrega

- [x] Configuração offline `test/ai-usage/vitest.config.ts` bloqueia fetch externo e não importa o setup de fixtures remotas. Nunca executar `npm test` genérico para este trabalho.
- [x] Testes focados dos componentes, APIs, adaptadores, guards e SQL concluídos; validação integrada final registrada separadamente.
- [x] Typecheck e build passaram; lint do escopo passou. O lint geral tem warning preexistente em `components/navigation/NavigationRail.tsx:39`.
- [x] Revisão independente de preservação, permissões, chamadas pagas e transições concluída; correções incorporadas.
- [ ] Publicação e aplicação da migração: não executadas neste escopo. Aplicar migração antes do código; sem ela o motor recusa chamadas por não conseguir registrar/reservar.
- [ ] Piloto por organização: escolher valores explícitos e verificar consultas após publicação. Não ativar teto arbitrário para todos.

Recuo: preservar tabelas, tentativas, concessões e bloqueios. Não retornar ao motor anterior sem interromper antes a execução automática, pois ele desconhece os bloqueios duráveis. Preferir correção adiante. Não remover tabelas nem disparar filas ao recuperar uma versão.

## Limites da entrega

Atendimento automático nativo WhatsApp e seus auxiliares, simulador, configuração e indexação. Transcrição manual, Pilot, chamadas do navegador e n8n externo não foram instrumentados. A UI explicita essa cobertura. Estimativa de custo não é fatura nem garantia monetária absoluta. Nenhum backfill financeiro de dados antigos foi executado.

Validação final: 333 testes da aplicação, 65 verificações SQL, TypeScript, lint do escopo, build e prévia aprovados. [Evidências e roteiro de publicação](../specs/2026-10-23-ai-usage-validation.md).
