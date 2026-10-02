# Grupos do WhatsApp vinculados a contatos e leads

Status: aprovado por Samuel em 2026-10-01. Implementar em branch e preview próprios.

## Objetivo e experiência
O grupo usado para uma reunião de vendas continua como grupo do cliente depois da venda. Chats mantém entradas separadas para grupos e conversas privadas. Um grupo pode ser vinculado explicitamente a vários contatos e leads. O vínculo não transforma participantes em contatos e não concede acesso adicional.

No grupo, exibir e editar contatos/leads relacionados. No contato e no lead, mostrar grupos relacionados com atalho para `/chats?conversation=<id>`. No lead, apresentar o campo nativo somente leitura **ID do grupo no WhatsApp**, derivado do grupo principal. Preservar o JID completo da Evolution, por exemplo `120363012345678901@g.us`.

## Configuração e desativação
Em Configurações → CRM → Recursos opcionais, um administrador pode ativar **Vincular grupos a contatos e leads**. A configuração `wa_group_links_enabled` é por organização e começa desativada. O controle existente de grupos nos Chats continua independente.

Desativado: ocultar vínculos e ID nas telas, negar edição dos vínculos, retirar a variável dos seletores e omitir `deal.whatsapp_group_id` dos payloads. Preservar associações para reativação. Templates antigos não podem enviar um valor desse campo ao desativar: remover propriedades que dependem da variável e remover valores derivados em arrays/textos. Retentativas sanitizam snapshots com a configuração atual. Requisições já entregues ou em trânsito não são reversíveis.

## Identidade, cardinalidade e principal
A identidade de um grupo é organização + provedor + identificador externo completo. Conversas do mesmo grupo em conexões diferentes compartilham vínculos. O nome e a conexão não definem a identidade. Criar a entidade canônica somente ao vincular um grupo conhecido, nunca a partir de entrada arbitrária do cliente.

Um grupo aceita vários contatos e leads; um contato/lead aceita vários grupos. O primeiro grupo de um lead se torna principal automaticamente. Para vários grupos, a pessoa pode escolher explicitamente o principal. Ao remover o principal, nenhum dos demais é escolhido silenciosamente: o ID fica nulo até uma nova escolha. No caso de reenvio da mesma inclusão, não mudar a escolha atual. Alterações são atômicas, com bloqueio por lead e índice que garante no máximo um principal.

## Webhook
Campo padrão `deal.whatsapp_group_id`; variável `{{deal.whatsapp_group_id}}`. Ativo e sem principal: null. Inativo: chave omitida. O valor é resolvido a partir do grupo principal no servidor e jamais aceito como campo livre do lead. Abranger webhooks de pipeline/etapas, agentes/robôs, testes de webhook e retentativas. O AJ Ops já tem o campo `whatsappGroupId`; esta entrega disponibiliza o dado no CRM, sem criar um novo receptor no AJ Ops.

## Permissões e integridade
Todas as consultas e relações são isoladas por organização. Exigir visibilidade da conversa e da entidade relacionada em leitura e edição. Listas de escolhas seguem as mesmas permissões. Contatos sem leads são visíveis apenas a quem já tem acesso completo no modelo existente; os demais seguem visibilidade dos leads do contato. Usar alterações pontuais de vínculo para preservar vínculos que o operador não enxerga. Não alterar `wa_conversations.deal_id`, nem regras atuais de acesso às conversas.

Tabelas novas com RLS e sem grants diretos a anon/authenticated; acesso pelos endpoints existentes com sessão, organização da aba e checagem de permissão. Escritas verificam origem. RPCs privilegiadas com search_path fixo e execução apenas service_role. Sem novos pacotes.

## Validação e entrega
Testar autorização cruzada, recurso desligado, principal sob concorrência, identidade persistente após renomear, links múltiplos, preservação ao desligar/ligar, valores nulo/omitido/real em todos os caminhos de webhook e templates salvos. Executar lint, typecheck, testes e build; verificar interface em navegador desktop e celular. Migrações aditivas no staging de teste; produção e main ficam intactas até validação do preview. Nenhuma mensagem real de WhatsApp em testes.
