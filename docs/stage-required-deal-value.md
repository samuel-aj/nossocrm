# Valor do negócio obrigatório por etapa

Direção aprovada em 16/10/2026: exigir valor do negócio maior que zero ao entrar em uma etapa configurada.

## Uso

Em **Board → Automatizar → menu da coluna → Editar etapa → Campos obrigatórios**, marcar **Valor do negócio** e salvar.

Ao mover um lead com valor vazio, zero ou negativo, o modal **Complete para mudar de etapa** pede **Valor do negócio (R$)** junto das demais pendências. **Salvar e mover** grava os campos e a etapa na mesma transação. Cancelar descarta o preenchimento. Um valor positivo já salvo satisfaz a regra sem pedir preenchimento novamente.

Quando produto e valor são exigidos juntos, o valor informado para o negócio prevalece sobre o subtotal do produto. Um valor positivo já salvo é preservado ao preencher apenas o produto. Se a operação enviar somente produto para um negócio sem valor, seu total positivo também pode satisfazer a validação no banco. Preços e quantidades dos itens continuam separados do valor total informado.

A validação no banco protege também movimentos por integrações e automações. Zero continua válido para preços de produtos e campos personalizados numéricos. A exigência se aplica à entrada na etapa; não altera a criação de leads nem faz atualização retroativa dos que já estão nela.

## Publicação

Aplicar `20261017025100_stage_required_deal_value.sql` antes de disponibilizar o novo frontend. A migração substitui três funções existentes, mantendo assinaturas, permissões e triggers. Não ativa a regra em nenhuma etapa e não modifica negócios existentes.

Validar em homologação: configurar a exigência, cancelar um movimento, concluir outro com centavos, mover um negócio já preenchido e tentar mover sem valor pela integração. A publicação em produção é uma etapa posterior à implementação.

## Verificação local

Passaram 94 testes direcionados da aplicação e 61 verificações PostgreSQL isoladas. ESLint dos arquivos alterados passou sem avisos. A checagem TypeScript (`npm run typecheck`) passou.

Os testes React cobrem configuração, preenchimento, cancelamento, envio conjunto de produto e valor e aproveitamento de valor existente. Os testes do hook verificam a confirmação no cache, ganho, histórico e automação para outro funil.

`scripts/test-stage-requirements-db.mjs` executa as migrações reais em PostgreSQL isolado (PGlite). Cobre valores inválidos, autorização, preservação de permissões, escrita direta por integração, rollback, centavos, valor explícito versus produto e movimentos com origem desatualizada. As funções de autorização preexistentes usam substitutos na fixture; o teste não substitui uma validação autenticada em homologação.
