# Caixa de ajustes e esteira

Qualquer usuário manda ajustes em **Ajustes** (menu) ou pelo botão **Reportar** no topo de qualquer tela: texto, até 10 prints, até 5 arquivos e um áudio de até 3 minutos, transcrito com a IA da Central de I.A. do escritório. Cada pessoa acompanha os próprios pedidos; o super admin vê todos.

## Conectar a esteira (Paperclip)

1. No CRM, **Super Admin → Chaves de operador da AJ**. Escolha **Esteira de ajustes**, dê um nome e crie a chave.
2. Copie o segredo antes de fechar. No Paperclip, configure um conector MCP HTTP para `/api/mcp` do domínio do CRM, com a chave como Bearer, e conceda só aos agentes da esteira.
3. Ferramentas: `crm.feedback.list`, `crm.feedback.get` (anexos com link de 1 hora) e `crm.feedback.update` (status, prioridade, resposta pública, link do tutorial, id da tarefa e mensagem da equipe). A chave da esteira não lê agentes, e a chave do Monitor não lê pedidos.
4. Para cortar o acesso, revogue a chave na mesma tela.

## Status

`recebido` → `em_analise` → `precisa_detalhes` | `na_fila` | `aguardando_aprovacao` → `em_correcao` → `corrigido`, ou `nao_e_bug` / `descartado`. Toda mudança de status avisa quem mandou no sino. Quando a pessoa responde um `precisa_detalhes`, o pedido volta para `recebido`.

## Validação local

`node scripts/test-feedback-db.mjs "<pasta bin do PostgreSQL>"` e `npx vitest run --config vitest.feedback.config.ts`.

## Publicação

Com autorização, aplique na ordem `20261128120000_feedback_requests.sql`, `20261128120100_feedback_bucket.sql` e `20261128120200_feedback_operator.sql` antes de liberar a versão. Se o código for ao ar antes da `...120200`, a chave do Monitor continua funcionando (autenticação antiga) e só a criação da chave da esteira responde que falta a migração. Para voltar: código primeiro, depois [o desfazer](feedback-requests-rollback.sql).
