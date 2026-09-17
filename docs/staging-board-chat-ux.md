# Board e chat — STAGING (15/09/2026)

Base: staging `3890616`. Publicar primeiro em STAGING; MAIN depende da validação do usuário.

- Etapas com 280 px no desktop (antes mínimo de 320 px); largura mobile preservada.
- Um contêiner de rolagem vertical/horizontal para o board; cabeçalhos fixos durante a rolagem. Removida a conversão da roda vertical em deslocamento horizontal.
- Menu Editar nas mensagens de texto enviadas pelo próprio usuário, já confirmadas, em conexões Evolution QR, dentro de 15 minutos. Endpoint valida sessão, organização, acesso à conversa/número, autoria e prazo; destinatário e ID do provedor são obtidos no servidor.
- Edição passa pelo provedor antes de atualizar o CRM; mantém datas/status originais, grava edited_at e atualiza a prévia apenas quando ainda é a última mensagem. Falhas parciais são informadas. Sem novas migrações.
- Colar/arrastar uma imagem abre a prévia de anexo existente; não envia automaticamente. Texto puro mantém colagem normal. Múltiplas imagens são recusadas com aviso, sem descartar silenciosamente as demais.

Validação: 28 testes de WhatsApp (incluindo 14 novos), typecheck e lint dos arquivos alterados. Layout do componente real KanbanBoard com cards de teste verificado em Chromium e WebKit: largura 280, rolagem conjunta de 300 px, cabeçalhos fixos, ausência de scroll vertical nas colunas, sem overflow da página no mobile. Nenhuma mensagem real enviada ou editada durante a verificação; confirmação com a conexão real deve ser feita no STAGING.

Referências de integração: Evolution `POST /chat/updateMessage/{instance}` (src/api/routes/chat.router.ts e UpdateMessageDto em src/api/dto/chat.dto.ts, repositório EvolutionAPI/evolution-api). Prazo de edição: https://faq.whatsapp.com/iphone/chats/how-to-delete-messages/?lang=pt_br.

## Demonstração solicitada após a validação

Largura e rolagem aprovadas. O usuário não conseguiu testar o chat porque o banco de STAGING tem apenas a conexão fictícia `staging_teste_etiquetas`, cadastrada como Meta Cloud; a janela fechada corresponde a esse cadastro. A mensagem da captura estava identificada como externa, sem autoria CRM elegível para edição.

O usuário escolheu uma demonstração simulada, sem mensagens reais. `/chats/demo` reutiliza `MessageBubble`, `EditMessageModal`, `useChatImageTransfer` e a regra de prazo de edição. Texto, arquivos e alterações permanecem em memória no navegador; não utiliza o hook de envio nem endpoints/storage. Imagens usam URLs blob locais, liberadas no descarte/reinício/desmontagem. A página exige login e só renderiza com `VERCEL_ENV=preview` e `VERCEL_GIT_COMMIT_REF=staging`; em produção retorna 404. Não altera a conexão Meta nem os dados existentes.

A simulação permite validar menu, edição, prévia por colagem/arraste e envio local. Não comprova entrega/edição por um provedor real. Dois testes cobrem as interações com os componentes reais e confirmam ausência de chamadas fetch.

## 16/09 — teste dentro de Chats

O usuário voltou à tela `/chats`, onde a conexão fictícia Meta continuava bloqueada. A simulação agora abre automaticamente nessa tela em STAGING e fica fixada na primeira linha da lista como **Número de teste · QR**, identificada como simulada e sem envio real. É possível alternar para conversas existentes e voltar ao teste; no mobile há o botão Contatos. O teste reaproveita a demonstração local, com texto inicial recente/editável, anexos por colagem/arraste e reinício. A conexão Meta e suas regras permanecem intactas.

A habilitação é calculada no servidor, exclusivamente para preview da branch staging. Em produção o comportamento de Chats permanece igual. Testes de integração verificam abertura automática, menu Editar, alternância e ausência da simulação sem a flag de staging.

Base remota encontrada: `57d8fdf`, que já não continha os commits anteriores `0d79b73` e `00acef9`. Ambos foram reaplicados em cima dessa base, sem conflitos, preservando a correção de conexões duplicadas. Validação: 23 testes específicos, incluindo os de deduplicação; TypeScript e lint dos arquivos modificados.
