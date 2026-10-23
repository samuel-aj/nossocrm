# Cores dos alertas de leads e consumo

Samuel solicitou alertas verdes/vermelhos para mensagens e situações do lead, e roxo/lavanda para pausa por limite. Confirmou os quatro locais: card do Kanban, lista de chats, conversa e sino. Implementação local; publicação deste novo escopo será separada.

O bloco existente Ativar alerta ganha escolha Verde (aviso) ou Vermelho (atenção), com verde como padrão para preservar fluxos salvos. Cor acompanha evento e badge. Alertas de novas mensagens permanecem verdes. Avisos críticos do sistema preservam vermelho.

Bloqueio de consumo é uma sinalização independente, derivada de ai_usage_accounts e suas identidades canônicas. Não grava deals.active_alert e não desaparece ao abrir o lead. Texto e ícone distinguem pausa da IA mesmo sem percepção de cor. Pausa por quota recebe IA pausada por limite; falha de medição recebe IA pausada por consumo, sem alegar limite atingido.

As duas sinalizações podem coexistir nos dados. No card e na linha do Kanban, a pausa da IA tem prioridade visual e oculta o alerta comum enquanto estiver ativa. Abrir o lead continua reconhecendo o alerta comum pelo ID esperado; somente a liberação manual resolve o bloqueio de consumo. Concessão não retoma IA nem envia mensagem. Sem mudar quotas, responsáveis, histórico ou regras de envio.

Consulta em lote usa organização e visibilidade já autorizadas. O board acrescenta usageBlocks separado de automations, sem alterar filtro IA ativa. A lista de chats recebe usage_block por conversa e mantém identidades agrupadas. Não buscar saldo com uma chamada por card. Falha nessa informação adicional não deve impedir leitura das conversas.

Paleta: esmeralda para aviso, vermelho para atenção, fundo lavanda com texto violeta e ícone de IA/pausa para consumo. A cor não substitui texto. Tema claro/escuro e espaços compactos precisam continuar legíveis. Faixa na conversa mantém Ver consumo e liberar e Retomar separado.

Refinamento visual de Samuel: a pausa da IA colore o card inteiro em lavanda, com borda roxa, assim como o destaque dos alertas comuns. No lugar do alerta comum aparece somente o ícone de robô com “IA pausada por limite”, em texto simples, sem retângulo/badge. Ao liberar o bloqueio, volta o alerta comum se ainda não reconhecido, ou o estado anterior do lead. A mesma prioridade vale na visualização em lista. Os demais locais conservam sua apresentação.

Aceite: estados isolados e simultâneos nos quatro locais; limite persistente após abrir lead; desaparecimento após concessão por refetch/invalidação; pausas humanas não tratadas como consumo; consultas sem vazamento entre organizações; fluxos antigos verdes; nenhum modelo ou mensagem real em teste.
