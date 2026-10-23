# Validação dos alertas por cor

Escopo local aprovado em 23/10/2026: verde/vermelho nos alertas comuns; lavanda para bloqueio de consumo no card/lista do Kanban, lista de chats, conversa e sino. Nenhuma publicação, migração remota, concessão real, retomada ou mensagem de teste.

## Comportamento e regressões

- Alertas comuns e bloqueios de IA coexistem. Abrir o lead reconhece somente o alerta comum pelo ID esperado.
- O bloqueio deriva da conta canônica, nunca da simples pausa manual da IA. Identidades usam contato válido, telefone exato, memberships e contas fundidas, conforme o cálculo de orçamento.
- Consultas em lote recebem somente conversas autorizadas e filtram organização em todas as leituras. Vínculo explícito da conversa vence o fallback de contato; uma conversa sem vínculo pode usar o run explícito mais recente autorizado.
- A concessão invalida as projeções de consumo, automações e chats, sem retomar a IA. O sino reconcilia os avisos ainda não resolvidos a cada consulta; limpar avisos comuns não esconde um bloqueio.
- Falhas parciais de consulta preservam o último bloqueio conhecido e sinalizam indisponibilidade. Uma resposta completa vazia remove o aviso. Testes cobrem mudança de organização e lotes parcialmente indisponíveis.
- Alertas antigos continuam verdes. A nova escolha verde/vermelho sobrevive a salvar, reabrir e executar o fluxo; lavanda é reservada à sinalização automática da IA.

## Evidências locais

- **217 testes, 31 arquivos: PASS**, usando exclusivamente `test/ai-usage/vitest.config.ts`, que bloqueia chamadas de rede reais. Inclui APIs, motor de robôs, serialização, ACL, contas canônicas, UI, agrupamento de números e notificações.
- **SQL PGlite: PASS** para nova migração e regressão do RPC antigo antes/depois, preservação do JSON anterior, idempotência, reconhecimento por ID, org/run, ACL e execução como service_role. Runner: `scripts/test-deal-alert-tones-db.mjs`.
- Lint dos arquivos de produção/testes alterados e TypeScript sem emissão: PASS.
- Build Next.js completo: PASS (155 páginas). Permanece o aviso anterior de padrão amplo em `lib/installer/edgeFunctions.ts`, fora deste escopo.
- Prévia interativa: `http://127.0.0.1:4189/`, dados fictícios e componentes reais de alerta, consumo e editor. Fontes e capturas privadas em `tmp/alert-colors-preview/`, fora do commit.
- QA da prévia: desktop 1440 px e celular 390 px; sem overflow, editor de cor funcional, abrir limpa alerta comum e mantém bloqueio, concessão simulada remove bloqueio e conserva pausa. Nenhuma chamada externa, mutação de rede ou erro JavaScript.
- Tema escuro conferido em cards e sino. A prévia não acrescenta eventos de pausa ao histórico nem alertas comuns à lista de chats; esses locais mostram somente os componentes previstos na implementação.
- Refinamento visual posterior: card inteiro e linha do Kanban recebem lavanda com prioridade sobre o alerta comum. Os três testes existentes de coexistência/liberação passaram novamente; QA visual confirmou card lavanda no desktop/celular/escuro e restauração da cor anterior após liberação simulada, mantendo texto do alerta comum e nenhum envio real.

## Publicação futura

Publicar somente com autorização para este escopo. Aplicar primeiro `20261023195718_deal_alert_tones.sql`, depois o aplicativo. A migração adiciona a coluna de cor e um RPC com nome novo; mantém o RPC antigo como wrapper verde e não reescreve `deals.active_alert` existente. Não há backfill de conversas, exclusão de leads, mudança de quotas ou de permissões de concessão.

O código novo requer a migração de cor. O código anterior continua compatível com o banco migrado. A validação em produção deverá usar consultas somente de leitura; não acionar robôs ou mensagens reais.
