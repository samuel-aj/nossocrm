# Grupos do WhatsApp vinculados ao CRM

Em **Configurações → CRM → Recursos opcionais**, um administrador ativa **Vincular grupos a contatos e leads**. A opção começa desativada por organização. A opção existente **Grupos do WhatsApp no chat**, na tela Conexão, continua independente e precisa estar ativa para os grupos aparecerem nos Chats.

Abra a conversa de um grupo e expanda **Relacionados no CRM**. Busque contatos e leads e vincule ou desvincule cada item. Um grupo aceita vários contatos e leads. Os participantes do WhatsApp não são cadastrados nem vinculados automaticamente. O grupo mantém sua própria entrada nos Chats, junto das conversas privadas.

O cadastro de contato e o painel de propriedades do lead mostram **Grupos relacionados**, com atalhos para as conversas. No lead, **ID do grupo no WhatsApp** é somente leitura e possui ação de copiar. O primeiro grupo vinculado vira principal. Para mudar, clique em **Usar … como principal**. Remover o principal deixa o ID vazio até uma escolha explícita, mesmo quando sobra apenas um grupo.

O ID completo do provedor é preservado, incluindo `@g.us` na Evolution. Renomear o grupo ou usar outra conexão do mesmo provedor não muda sua identidade nem seus vínculos.

## Webhook para AJ Ops

Com o recurso ativo e um principal definido, o payload padrão inclui:

```json
{ "deal": { "whatsapp_group_id": "120363012345678901@g.us" } }
```

O seletor de variáveis dos webhooks de etapas, agentes e robôs oferece `{{deal.whatsapp_group_id}}` apenas enquanto o recurso está ativo. Para mapear ao campo do AJ Ops, use este corpo personalizado:

```json
{ "whatsappGroupId": "{{deal.whatsapp_group_id}}" }
```

Ativo e sem principal: `deal.whatsapp_group_id` é `null`; o mapeamento acima também resolve para `null`. Desativado: a chave padrão e propriedades do corpo personalizado que dependem dessa variável são omitidas. Valores derivados em textos e arrays são removidos. Templates salvos continuam editáveis e recebem um aviso. O servidor consulta a configuração atual ao entregar webhooks, inclusive testes e retentativas; requisições já entregues ou em trânsito não podem ser revertidas.

Desativar oculta os vínculos e o ID nas telas, retira a variável dos seletores e bloqueia a edição. As associações permanecem armazenadas para reativação.

## Acesso

Somente administradores alteram a opção. Consultas, escolhas e alterações exigem acesso à organização, à conversa e ao contato/lead. Vincular não concede acesso adicional. Alterações são feitas individualmente para preservar vínculos que o operador não pode visualizar. O servidor resolve o ID principal; não há campo de texto editável para definir esse ID.

Esta entrega disponibiliza o dado no NossoCRM. Nenhum receptor do AJ Ops foi criado ou implantado.
