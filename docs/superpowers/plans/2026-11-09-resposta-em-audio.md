# Respostas em áudio no WhatsApp

Samuel aprovou duas formas independentes de responder por voz. A chave em Modelo e resposta se aplica quando a última mensagem recebida é um áudio. No roteiro, o trecho entre `[audio]` e `[/audio]` é a fala literal que a equipe escolheu para aquele momento.

1. Validar pares de marcadores ao salvar e testar o agente. Inserir os marcadores ao redor da seleção. Persistir a chave no JSON de configuração de mídias já existente, desligada por padrão.
2. Associar cada trecho a uma ferramenta que aceita apenas a referência do roteiro. Preparar uma única sequência de falas, textos e mídias após validar a saída. Preservar links clicáveis e a ordem das mensagens.
3. Gerar voz com a chave OpenAI do agente ou da organização, registrar o consumo na conta do atendimento, conferir o texto da fala e entregar pelo provedor de WhatsApp da conversa. Registrar o áudio no histórico.
4. Reusar a decisão de formato no simulador com uma transcrição digitada. A opção Ouvir prévia sintetiza a fala na conta de teste sem gravar na conversa. Exercitar os dois controles, combinações, duplicidade, links, configuração antiga, erro do provedor e consumo usando serviços simulados.
