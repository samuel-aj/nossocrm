# Cumprimento cumulativo das etapas

Regra definida explicitamente por Samuel em 21/10/2026: avançar no processo confirma as etapas anteriores, mesmo quando o cartão não passou individualmente por elas. Um salto de Novo lead para Protocolado no dia 13 registra no dia 13 todos os marcos ainda sem data, inclusive qualificação e ganho. Datas anteriores são preservadas. Não adicionar aviso.

## Comportamento

- A ordem configurada do funil define o processo. Uma chegada real avançada, criação ou entrada em outro funil confirma o prefixo normal do funil de destino.
- CUSTOMER continua identificando o marco comercial. Alcançar esse marco ou uma etapa posterior confirma ganho. O protocolo mantém sua data própria.
- Etapas Perdido não integram o prefixo normal. Uma perda, reabertura explícita ou simples edição sem movimento não confirma etapas anteriores.
- Preservar primeiras datas conhecidas e não duplicar confirmações ao repetir, voltar ou avançar novamente. Regras de novos episódios após perda/reabertura continuam aplicáveis.
- A data vem da transação real, não de uma data digitada pelo cliente. Qualificação ausente pode ser completada em um avanço posterior, mas uma data já registrada permanece.
- Registrar o cumprimento acumulado no ledger como `stage_completed`, separado de `stage_changed`. Não movimentar o cartão pelas etapas intermediárias nem disparar suas automações.
- Relatórios reconhecem esses registros e suas datas. Confirmar uma etapa não pode mudar a população de entradas, simular transferência, redefinir a etapa atual ou encerrar um episódio de ganho.

## Limites desta entrega

A migration é prospectiva: não faz backfill nem reinterpreta automaticamente eventos antigos na leitura do relatório. Regularizações históricas exigem escopo explícito, datas comprovadas no histórico e preservação dos campos existentes. A publicação e a regularização de dois registros específicos foram autorizadas separadamente em 22/10/2026; os dados operacionais e scripts direcionados permanecem fora do repositório público.

## Verificação

Salto direto antes de MQL para pós-Cliente, avanço sequencial, datas preexistentes, confirmação única por etapa, perda, reabertura, regressão, transferência de funil, funil de serviços e múltiplas organizações. Comparar os números diários/mensais com o mesmo histórico; testar SQL em PGlite e aplicação com fetch bloqueado.
