# Cabeçalho integrado, seletores e citações — direção aprovada

Samuel escolheu a proposta 2 (Integrado) e autorizou corrigir as citações sem impacto negativo no uso diário. A padronização de dropdowns foi solicitada na mesma revisão. A autorização anterior de testes e publicação direta no principal permanece válida; staging está reservado a outro trabalho.

## Interface

- Um cabeçalho com identidade do contato na primeira linha; pesquisa e Propriedades à direita. Segunda linha com lead, acesso ao card, funil/etapa, responsável e etiquetas. Preservar cores, Rubik, mensagens e compositor atuais; as imagens servem para organizar o cabeçalho.
- Reutilizar o cabeçalho de DealWhatsAppChat por slots independentes da timeline; a busca e o compositor permanecem montados. Chats fornece apenas controles/contexto do CRM. O board mantém seus controles atuais.
- Prever grupo sem lead, contato sem lead, múltiplos leads, vínculo carregando/indisponível, títulos longos, propriedades abertas e telas pequenas. Grupos não viram lead. Não duplicar responsável/etapa quando o painel está aberto.
- Preservar confirmação entre funis com título exato “Deseja mudar lead de funil?”, menu principal recolhido e rascunhos.
- Consolidar menus de seleção sobre Radix já instalado. Campo vazio, opções desabilitadas, grupos, integração com formulários, erro, teclado, foco, dark mode, rolagem e portal dentro de modal precisam funcionar. Opções longas devem caber na tela. Busca local em listas grandes, montada apenas ao abrir, sem novas leituras de rede.
- Migrar seletores nativos ativos por área, incluindo propriedades, Chats, boards, atividades, contatos, agentes, configurações e administração. Não alterar laboratório ou módulos comprovadamente não usados; registrar exclusões. Preservar menus especializados como funil/etapa e contatos, alinhando aparência quando necessário, sem reescrever suas regras.

## Citações

- A mensagem HOPE `fa39a6c0-50c1-4ce3-bc30-76be53b0387e` está sem `quoted` e `quoted_message_id`. Confirmar o formato real no provedor e a versão publicada antes de atribuir a causa.
- Corrigir a recepção e persistência usando a estrutura existente. Texto curto até 300 caracteres, autor e mídia quando conhecidos; não inventar direção/autoria.
- Manter a prévia mesmo se a original estiver fora da página carregada; uma citação apagada deve indicar indisponibilidade quando o apagamento é conhecido.
- Vínculo original deve respeitar organização, conversa e conexão. Idempotência sem duplicar mensagens; não sobrescrever texto/status/edições/exclusões ao enriquecer uma citação.
- Zero novas chamadas ao provedor na abertura do chat. Zero consultas por bolha no navegador. Sem polling novo, sem busca global de notas/mensagens e sem download de mídia para a prévia. Usar os campos já retornados na lista; resolução de originais em lote se necessária.
- Recuperação histórica pontual apenas quando o provedor retornar a referência exata; nunca associar por semelhança de texto. Sem reimportação em massa.

## Verificação e publicação

- Comparar referência `d4e2d8b` e candidata com mesmo método: 10 aberturas frias e 10 retornos, janela de 10 s, contagem Fetch/XHR, bytes e seleção→conversa utilizável. Registrar distribuição e picos.
- Interface não deve introduzir consultas na seleção/abertura de menus com dados já carregados. Citações não devem adicionar consultas na API de leitura nem no navegador; eventual leitura na ingestão permanece limitada à citação existente.
- Investigar p90 acima de +10% e +100 ms da referência fria, ou +20 ms no retorno; aumento de requisições ou mais de 10 KiB na mediana precisa ser atribuído por endpoint. Ganhos não justificam picos ocultos.
- Testes de regressão e build, lint alterado, navegador Chromium e WebKit em larguras 1600/1024/390, tema claro/escuro, teclado/modal e rascunhos. Nenhuma mensagem real ou mudança de etapa de cliente para teste.
- Publicar no principal somente após revisão e verificação. Deploy do webhook precisa incluir só as mudanças desta correção, preservando produção; comparar contra a função publicada. Não alterar banco/RLS sem necessidade comprovada.
