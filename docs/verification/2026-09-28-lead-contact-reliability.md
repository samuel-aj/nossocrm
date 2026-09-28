# Vínculos entre lead, contato e chat — 28/09/2026

## Escopo autorizado

Samuel autorizou correção e publicação direta no principal, com testes, preservando o staging usado por outro trabalho.

## Causas e correções

- Board: um contato ausente da lista local era tratado como sem vínculo; o lead em cache impedia consulta atualizada. Agora lead e contato são revalidados por ID ao abrir, reconectar ou voltar à aba. Carregamento e erro têm estados próprios.
- Chat: conversas antigas podiam ter contato e um único lead, mas `deal_id` nulo. O servidor resolve e persiste a relação ao abrir o chat, contando todos os candidatos da organização e validando acesso. Vários candidatos, grupos e escolhas manuais são preservados. As etiquetas usam os gatilhos existentes.
- Estado: removida a sobreposição local que podia mascarar atualizações confirmadas. Edições no mesmo lead são serializadas, recebem confirmação do servidor e revertem apenas o lead afetado quando falham. Respostas de outra organização são descartadas.
- Trabalho repetido: consultas à lista de contatos compartilham cache; removida a assinatura duplicada de realtime do board. Índice parcial de organização/contato acelera a busca do vínculo. Sem alegação de percentual de ganho.

## Evidências antes da publicação

- 63/63 testes focados em dez arquivos: cache, respostas atrasadas, falhas, troca de organização, contato ausente da lista, modal, chat unificado e autorização das rotas.
- 10/10 cenários SQL em PostgreSQL local (PGlite), com a migration real e gatilhos reais de etiquetas; inclui idempotência e bloqueio de RPC para anon/authenticated.
- Build Next.js de produção (webpack) e TypeScript concluídos.
- ESLint nos arquivos alterados: sem erros ou avisos.
- Suíte geral: 796 aprovados, 11 falhas e 5 ignorados antes dos quatro últimos testes focados. Baseline do main a74e55f: as mesmas 11 falhas (762 aprovados, 5 ignorados). Falhas preexistentes: cache-integrity (4), middleware (1), história US-001 (1), edição de etapas (5).
- Lint geral mantém quatro erros em webhooks e dois avisos em arquivos que não foram alterados.

## Banco de produção

Migration aplicada: `20260928190822_resolve_conversation_deal_links.sql`. Coluna, índice e permissões da RPC conferidos após aplicação. Não houve atualização em lote nem alteração no staging. RPC SECURITY INVOKER, execução exclusiva de service_role; autorização de usuário na rota.

## Repetir teste SQL

Instalar `@electric-sql/pglite@0.5.8` em diretório externo e executar:

```sh
node scripts/test-conversation-links.mjs /caminho/externo/node_modules/@electric-sql/pglite/dist/index.js
```

A dependência não faz parte do pacote da aplicação. O teste usa somente banco em memória.
