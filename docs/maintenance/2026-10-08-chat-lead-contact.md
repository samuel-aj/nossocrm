# Criar lead pelo chat e trocar contato do lead

Implementação em `codex/chat-lead-contact-fix`, baseada em `4ad2be58ed29a3825d6bfe61f039c9392f0e96df`. Publicação autorizada pelo usuário em 2026-10-08 após a validação local.

## Comportamento

- Depois de uma consulta bem-sucedida sem lead, o chat oferece **Criar lead**. A busca automática de leads existentes permanece ativa e falhas reais continuam oferecendo nova tentativa.
- A seção **Contato** das propriedades do lead oferece **Trocar contato** para quem pode editar o lead. A busca paginada aceita nome, telefone e email; exclui contatos removidos e exige selecionar e salvar o novo contato.
- Ao salvar, os dados do contato são atualizados na tela. Vínculos incompatíveis com conversas privadas são removidos na mesma transação, preservando mensagens, etiquetas, grupos e a escolha do modo manual.
- O salvamento rejeita contatos excluídos ou de outra organização e preserva as permissões existentes.

## Causa do erro do chat

O resolvedor já devolvia HTTP 200 e `deal_id: null` para o caso sem lead. A escrita de cache pelo prefixo `['waConversations']` também alcançava `['waConversations', 'unread']`, cujo valor tem formato `{ total }`. O acesso a `old.data.map` lançava uma exceção e convertia a consulta bem-sucedida em erro na interface. O novo helper atualiza somente caches de lista e mantém o contador intacto, inclusive após criar e vincular um lead manualmente.

## Validação

- 124 testes focais passaram em 16 arquivos: chats, criação/vinculação, troca de contato, permissões, cancelamento/erros, serviço, cache, paginação e rotas de conversa.
- Typecheck e lint dos arquivos alterados passaram.
- Build de produção passou.
- Migração e regressão SQL passaram em PGlite 0.3.15 em memória, com fixtures e funções/triggers reais de etiquetas. Não substitui teste de concorrência em PostgreSQL remoto.
- Suíte completa: 1.206 testes passaram; 12 falharam e 5 foram ignorados. As mesmas 12 falhas foram reproduzidas em uma cópia sem alterações da base: `cache-integrity` (5), `CreateBoardModal.stages` (5), `US-001-abrir-deal-no-boards` (1), `supabaseMiddleware` (1). A validação focal final inclui os três novos testes de paginação adicionados depois da suíte completa.
- Lint global apresenta um aviso em `components/navigation/NavigationRail.tsx:39` (`next/no-img-element`), também reproduzido na base original.
- Revisão independente identificou a oferta de contatos excluídos; corrigida com filtro opcional no servidor antes da paginação.

## Publicação

Migração aplicada antes do código da interface no projeto Supabase `pldknngsszuxiuweivdz` (AJ Project). O arquivo `supabase/migrations/20261008142444_reassign_lead_contact_links.sql` usa a versão efetivamente registrada pelo servidor. Os três triggers estão habilitados; execução direta por anon/authenticated permanece revogada; zero vínculos inconsistentes após aplicação. A interface segue pela publicação deste código no projeto Vercel nossocrm.

Após a publicação, verificar que um contato sem lead exibe **Criar lead**; que um contato com lead continua resolvendo o vínculo; e que a troca de contato salva, atualiza o painel e remove somente os vínculos privados incompatíveis. Os registros reais de João/Cíntia não foram modificados como teste.
