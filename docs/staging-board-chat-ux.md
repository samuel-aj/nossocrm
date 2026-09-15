# Board e chat — STAGING (15/09/2026)

Base: staging `3890616`. Publicar primeiro em STAGING; MAIN depende da validação do usuário.

- Etapas com 280 px no desktop (antes mínimo de 320 px); largura mobile preservada.
- Um contêiner de rolagem vertical/horizontal para o board; cabeçalhos fixos durante a rolagem. Removida a conversão da roda vertical em deslocamento horizontal.
- Menu Editar nas mensagens de texto enviadas pelo próprio usuário, já confirmadas, em conexões Evolution QR, dentro de 15 minutos. Endpoint valida sessão, organização, acesso à conversa/número, autoria e prazo; destinatário e ID do provedor são obtidos no servidor.
- Edição passa pelo provedor antes de atualizar o CRM; mantém datas/status originais, grava edited_at e atualiza a prévia apenas quando ainda é a última mensagem. Falhas parciais são informadas. Sem novas migrações.
- Colar/arrastar uma imagem abre a prévia de anexo existente; não envia automaticamente. Texto puro mantém colagem normal. Múltiplas imagens são recusadas com aviso, sem descartar silenciosamente as demais.

Validação: 28 testes de WhatsApp (incluindo 14 novos), typecheck e lint dos arquivos alterados. Layout do componente real KanbanBoard com cards de teste verificado em Chromium e WebKit: largura 280, rolagem conjunta de 300 px, cabeçalhos fixos, ausência de scroll vertical nas colunas, sem overflow da página no mobile. Nenhuma mensagem real enviada ou editada durante a verificação; confirmação com a conexão real deve ser feita no STAGING.

Referências de integração: Evolution `POST /chat/updateMessage/{instance}` (src/api/routes/chat.router.ts e UpdateMessageDto em src/api/dto/chat.dto.ts, repositório EvolutionAPI/evolution-api). Prazo de edição: https://faq.whatsapp.com/iphone/chats/how-to-delete-messages/?lang=pt_br.
