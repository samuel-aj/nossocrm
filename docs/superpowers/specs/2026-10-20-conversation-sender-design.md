# Número de envio por conversa

Fluxo aprovado por Samuel em 20/10/2026: selecionar o número próprio da conversa ao abrir o lead; confirmar antes do envio se escolher outro; após um envio bem-sucedido, dispensar novos avisos enquanto permanecer nesse número.

## Comportamento

- Conversas presas a uma conexão continuam enviando apenas por ela. Sem conexão disponível, não substituir silenciosamente.
- Conversas unificadas iniciam com o número indicado pela conversa aberta, ou pela mensagem válida mais recente daquele contato. A preferência global de outro atendimento deixa de ser utilizada.
- Polling não sobrescreve uma escolha manual.
- Antes do envio por outro número, mostrar nome do contato, número anterior e número selecionado. Ações: manter o anterior (quando disponível) ou confirmar e enviar. Fechar preserva o rascunho e não envia.
- Sem histórico e com vários números, confirmar o primeiro número de envio. Com um único número disponível, não exigir essa confirmação.
- Aplicar a texto, anexos/figurinhas, áudio e modelo oficial. A autorização pertence a uma tentativa, um destinatário e um remetente; somente sucesso estabelece o novo número de referência.
- Navegar para outro lead/contato, trocar a seleção ou desconectar o remetente invalida uma confirmação pendente. Preparação assíncrona de mídia não pode redirecionar conteúdo.

## Implementação e limites

Reaproveitar ConfirmModal do fluxo de mudança de funil. Separar seleção e autorização em um hook testável; manter o componente de chat como integrador dos tipos de envio. Isolar a sessão do compositor por lead/contato/telefone/grupo/conexão. Não alterar automações, notas, atividades ou a API de envio. Encaminhamento continua no fluxo explícito de seleção de destinos existente.

Testes usam mensagens e conexões fictícias, sem tráfego real. Este pedido autoriza implementação local, não publicação.
