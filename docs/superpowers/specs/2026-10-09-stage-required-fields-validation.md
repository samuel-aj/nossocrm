# Campos obrigatórios por etapa — validação

Implementação local em `codex/required-stage-fields`, baseada em `4bc7655`. Sem publicação e sem alteração em banco remoto.

## Comportamento

- Board > Automatizar > menu ⋯ de qualquer coluna > Editar etapa.
- Regras independentes: Produto, Origem, Responsável e definições personalizadas por ID estável.
- Campos já preenchidos não são solicitados. Cancelar/ESC não salva produto, valores, movimentação, ganho nem atividades.
- Preenchimento e movimentação em uma RPC invoker, protegida por RLS, permissões e validação no banco. Falha reverte tudo.
- Integrações/robôs que tentarem mover sem preencher os campos recebem erro. A criação de leads permanece como antes.
- Lotes são sequenciais e só contabilizam movimentos confirmados; cancelamento interrompe o lote. Inativos só são reativados após confirmação.
- Excluir uma definição ainda exigida por uma etapa é bloqueado com mensagem; esse erro interrompe a limpeza de valores e evita falso sucesso.

## Verificação

- 60 testes direcionados passaram: helper, configuração, modal em StrictMode, hook de movimento, ganho/perda, controle de etapa, exclusão bloqueada e permissões de configurações.
- 23 verificações PostgreSQL isoladas com PGlite passaram, executando a migração real junto das migrações de histórico/ganho/origem. Incluem ausência de DML de migração em leads, rollback de produto, acesso entre organizações, vendedor com RLS, zero válido e repetição com origem obsoleta. Funções de autorização existentes usam stand-ins na fixture; não substituem validação de deploy em homologação.
- Typecheck e build Next.js/webpack passaram. Lint dos arquivos alterados passou.
- Suíte completa: 1477 testes passaram, 12 falharam, 5 ignorados, antes dos três testes finais de configurações. Em cópia limpa do HEAD anterior, 11 das falhas se repetiram; a 12ª é o teste de AGENTS.md que procura o arquivo no diretório pai e encontra as instruções Opensquad do workspace. Nenhuma dessas falhas veio das novas regras.
- Lint global contém aviso anterior em `components/navigation/NavigationRail.tsx:39` (`no-img-element`); arquivo preservado.
- Conferência no navegador da prévia local com os componentes React reais e persistência fictícia: configuração em Proposta feita, cancelamento após selecionar produto, preenchimento via calendário, salvamento único e fechamento por ESC. O preenchimento programático do input de data pelo navegador de testes não dispara o estado React; a escolha pelo calendário funciona.

## Publicação futura

1. Aplicar `20261009214131_stage_required_fields.sql` antes de publicar o frontend. A migração cria uma coluna vazia nas etapas, funções e triggers; não muda dados de leads existentes.
2. Publicar o frontend e validar em uma organização de teste: configurar uma etapa, cancelar uma movimentação, concluir outra, confirmar produto/histórico e testar uma movimentação rejeitada por integração.
3. Nenhuma regra vem ativada por padrão. Um administrador deve selecionar os campos exigidos em cada etapa desejada.

Prévia local: `http://127.0.0.1:4183/`, servidor Vite em `tmp/stage-preview`, mocks explícitos sem conexão com produção. Os arquivos da prévia e os logs de verificação não fazem parte da aplicação publicada.
