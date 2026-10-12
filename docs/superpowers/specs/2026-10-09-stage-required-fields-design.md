# Campos obrigatórios ao entrar em uma etapa

Design aprovado pelo usuário em 09/10/2026, com a última alteração de acesso: **Board → Automatizar → menu da coluna → Editar etapa**. O menu de edição novo só aparece no modo Automatizar. Todas as etapas possuem configuração independente. O modal mantém nome, promoção do contato e acrescenta campos obrigatórios: produto, origem, responsável e campos personalizados do negócio.

Ao solicitar uma mudança, verificar somente a etapa de destino. Campos já preenchidos não são pedidos novamente. Pendências são editadas em um único modal; cancelar/fechar não grava campos, produtos, etapa, ganho, histórico ou automações. Salvar preenche os dados e muda a etapa em uma transação. Erros mantêm a etapa de origem e permitem corrigir o formulário. Revalidar a origem para não sobrescrever uma movimentação concorrente.

Reutilizar a regra vigente de ganho/perda e as promoções. O modal deve ser compartilhado pelos movimentos do Kanban e do detalhe do lead. Em lote, tratar leads sequencialmente e contar apenas mudanças confirmadas. Integrações e automações não exibem modal: a validação no banco rejeita movimentos incompletos. Esta entrega exige migração; não aplica regras retroativas nem preenche dados antigos automaticamente. A criação de novos leads continua com seu fluxo existente (esta regra é de movimentação).

Preço do produto é o preço negociado do item, sem modificar catálogo. Quantidade positiva, preço não negativo. Origem vazia/Não informado não satisfaz a exigência. Zero é um valor válido para campos numéricos. Datas e opções devem corresponder ao tipo do campo. Referências de campos personalizados usam ID, independente de rótulo. Excluir um campo usado em exigências pede remover a regra antes.

Somente administradores que já gerenciam o funil configuram exigências. Usuários mantêm as permissões existentes para mover, editar e atribuir responsável. Persistência usa a sessão/RLS, sem credencial privilegiada no navegador. Validação protege transições vindas de qualquer cliente.

Implementação e testes locais autorizados. Publicação desta funcionalidade ainda não solicitada.
