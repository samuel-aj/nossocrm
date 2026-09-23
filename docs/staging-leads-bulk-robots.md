# Leads ao vivo, criação manual e robôs em lote — staging

Base de 23/09/2026: main 235cce4; staging estava em cc96dad (8 commits atrás).
Destino autorizado: staging / Supabase mggvzlmquzqcloprxmoe. Não promover para produção sem validação do usuário.

## Correções
- O contexto que alimenta o card aberto agora lê DEALS_VIEW_KEY, a mesma fonte do Kanban. Antes lia outro cache, que não recebia os UPDATEs em tempo real.
- Todos os campos do payload de negócio são normalizados, inclusive custom_fields, contact_id e owner_id. INSERT busca o registro completo e o contato; produtos já associados são preservados e dados de outra organização ignorados. O CRM escuta contatos também; reconexão recupera mudanças perdidas.
- Rodízio não seleciona superadministradores, coerente com o critério `member` de /api/org/members. A regra de acesso existente continua em vigor. Reproduzido no staging com sessão authenticated: entrada antiga de superadmin no rodízio gerava SQLSTATE 42501 / Responsável inválido. Não era título duplicado.
- Erros de criação chegam ao board/chat; o registro otimista é removido quando a gravação falha. Empresa vazia não é criada implicitamente; empresa explicitamente informada recebe organization_id.

## Lote
Administradores: selecionar leads no Kanban/lista → executar robô → revisar destinatários → confirmar. Até 500 leads, robô ativo, número conectado quando o fluxo exige WhatsApp. Telefone normalizado repetido/ausente e registros inacessíveis são ignorados. Contato já em robô ativo é ignorado na confirmação.

A execução usa wa_bot_runs e o processador existente. batchId persistido + índice único + trava transacional tornam o reenvio da mesma requisição idempotente. A interface distingue fila, espera, conclusão, falha e cancelamento; fechar a janela não interrompe a fila. O endpoint de enfileiramento exige administrador e mesma origem; a função SQL só é executável pela service_role.

## Banco e publicação
Sincronizadas no staging as três migrações 20260918120000, 20260918130000 e 20260918160732, que existiam parcialmente fora do histórico. Aplicadas 20260923212346 e 20260923212610. deal_items e deal_notes habilitados no Realtime.

O cron wa-agents-tick já existia, mas faltavam URL e segredo. Configurados platform_config e WA_AGENTS_INTERNAL_SECRET exclusivamente no preview da branch staging. Antes da ativação, confirmados zero robôs ativos, zero agentes pendentes e zero follow-ups agendados. Nenhuma mensagem real foi enviada nos testes.

## Validação
- TypeScript, lint dos arquivos alterados e build Next.js aprovados.
- 13 testes específicos de cache, conversão de payloads, isolamento de organização, preparação de destinatários, autorização e confirmação em duas etapas.
- 6 assertions transacionais em supabase/tests/leads_bulk_regression.sql, todas aprovadas com ROLLBACK.
- Teste HTTP autenticado com dados temporários: criação manual, revisão sem executar, fila, repetição idempotente, execução real de robô que só encerra, bloqueios 401/403 e limpeza dos fixtures.
- Suíte completa: 543 aprovados, 5 ignorados, 11 falhas. As mesmas 11 falhas foram reproduzidas na main 235cce4 sem alterações (middleware, story antiga, testes estáticos de cache e modal de etapas).
