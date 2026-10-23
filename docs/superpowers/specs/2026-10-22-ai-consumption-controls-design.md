# Consumo e limites da IA — opção B aprovada

Pesquisa: 22/10/2026. Aprovação: 23/10/2026. Status: opção B implementada e validada localmente. Testes sem mensagens reais; publicação e ativação de quotas ainda não executadas.

## Pedido e decisão confirmada

Samuel pediu recuperar o que foi discutido com o SGM, medir o consumo de tokens e permitir um teto por conversa. Confirmou em 22/10: ao atingir o teto, pausar a IA, avisar o responsável dentro do CRM e liberar novamente **somente por ação manual do responsável**. O atendimento humano continua disponível.

A publicação anterior de etapas cumulativas está concluída: PR42, main `527b39f47f1d18dca1e477179718a04cf92c2803`, comparação de produção 78/78 aprovada. Esta proposta não altera o relatório comercial nem seus critérios.

## O que foi discutido no SGM

Fonte: [Análise mensal — Marcelo Miranda (SGM), 15/10/2026](https://app.fireflies.ai/view/01M4TXFZV64P938XVPBN718ZB9). A transcrição foi lida; os pontos abaixo são paráfrases, não auditoria da cobrança de outro fornecedor.

| Momento | Discussão | Requisito que decorre dela |
|---|---|---|
| [13:07–14:07](https://app.fireflies.ai/view/01M4TXFZV64P938XVPBN718ZB9?t=787) | Samuel diz que ainda faltava acompanhar o consumo no CRM. | Medição visível e consultável dentro do produto. |
| [14:38–16:07](https://app.fireflies.ai/view/01M4TXFZV64P938XVPBN718ZB9?t=878) | Marcelo diferencia atendimento superficial de todo o trabalho até fechar contrato, incluindo follow-up; pede previsibilidade. | Medir atendimento e consumo até o fechamento com denominadores claros. |
| [19:26–21:43](https://app.fireflies.ai/view/01M4TXFZV64P938XVPBN718ZB9?t=1166) | Discussão de chave própria do cliente; Samuel mostra que essa opção já existe. | Preservar chave própria e identificar o provedor/modelo usado, sem expor segredos. |
| [22:47–24:14](https://app.fireflies.ai/view/01M4TXFZV64P938XVPBN718ZB9?t=1367) | Gezer relata uma conversa entre duas IAs que teria provocado cobrança inesperada; relata adoção de limitador por conversa. | Interromper consumo automático excessivo; não depender apenas de um alerta posterior. |
| [24:15–24:31](https://app.fireflies.ai/view/01M4TXFZV64P938XVPBN718ZB9?t=1455) | Samuel propõe medição, médias, dashboard e configuração de limitação. | Painel e regras de limite como parte do mesmo recurso. |
| [26:11–26:35](https://app.fireflies.ai/view/01M4TXFZV64P938XVPBN718ZB9?t=1571) | Samuel propõe disponibilizar chave própria e pelo menos o limitador antes do teste. | Piloto protegido; chave própria já existe, trava completa ainda precisa ser construída. |

**Não transportar os números da outra plataforma diretamente.** A fala alterna créditos e tokens, com referências a 150, 200, 500 e 600. Isso não comprova a equivalência com tokens reais de API nem define o teto do NossoCRM. O relato de R$20 mil não foi verificado externamente.

Também não adotar a ideia de API ilimitada por assinatura do ChatGPT: são faturamentos separados, conforme [documentação oficial da OpenAI](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform). A [referência de usage](https://developers.openai.com/api/reference/resources/responses/methods/create) distingue entrada, saída e detalhes de cache. A [documentação de contagem](https://developers.openai.com/api/docs/guides/token-counting) esclarece que a saída pode incluir tokens não visíveis; contar caracteres da resposta não substitui o consumo informado pelo provedor.

## Auditoria anterior à implementação

Leitura do checkout `nossocrm-performance-fix`, HEAD `21e7737`, conteúdo da funcionalidade anterior já publicado por squash. Não foram feitas chamadas de IA nem alterações de configuração em produção nesta auditoria.

| Existe hoje | Limitação | Evidência |
|---|---|---|
| Tokens da resposta principal e revisão de segurança em `wa_ai_agent_runs`. | Registro parcial, sem medição de todas as operações pagas. | `lib/wa-agents/replyGeneration.ts:66`, `lib/wa-agents/runs.ts:18`. |
| Coluna Tokens nas execuções e tokens no simulador. | Não há painel consolidado de consumo/limites. | `features/wa-agents/RunsList.tsx:56`, `features/wa-agents/AgentTestChat.tsx:36`. |
| Orçamento padrão no código de 5 milhões de tokens/org nas últimas 24h; variável global pode mudar ou desativar. | Não confirmado o valor da variável em produção. Checa o passado sem reservar saldo; em erro de consulta permite continuar; pausa atual volta após uma hora. | `lib/wa-agents/engine.ts:104`, `:154`, `:616`. |
| Trava por conversa, 20 execuções recebidas/10min e seis passos na geração principal. | Não equivalem a teto de tokens por atendimento. | `lib/wa-agents/engine.ts:92`, `lib/wa-agents/replyGeneration.ts:28`. |
| Backend aceita teto de respostas. | Editor força `max_replies=0`, sem limite. | `features/wa-agents/AgentEditor.tsx:174`, `:191`. |
| Chave por organização ou agente, OpenAI/Anthropic/Google. | A medição precisa acompanhar a chave efetivamente usada, sem armazená-la no histórico de consumo. | `lib/wa-agents/model.ts:90`. |

Operações que hoje deixam consumo fora da soma principal: auxiliares (`helpers.ts:98`), variáveis por IA (`actionVars.ts:118`), compreensão de áudio/imagem (`mediaIn.ts:111`, `:141`) e embeddings (`knowledge.ts:323`). Todos esses caminhos ficam em `lib/wa-agents/`. A mídia é processada antes da trava diária (`engine.ts:595`). Testes têm uso registrado, mas não atravessam a mesma trava (`lib/wa-agents/test.ts`). O log atual pode falhar sem interromper o processamento e é apagado em cascata se a conversa for excluída; não deve ser o único registro para controle de quota.

Outros caminhos de IA existem fora desse motor: transcrição manual (`app/api/whatsapp/transcribe/route.ts`), Pilot (`app/api/ai/chat/route.ts`), ações do CRM (`app/api/ai/actions/route.ts` e `app/api/ai/tasks/`) e o caminho Google no navegador em `features/ai-hub/hooks/useCRMAgent.ts`. Cobrir toda IA do CRM exigirá instrumentá-los e levar chamadas do navegador para o servidor. Esta primeira proposta não promete controlar esses gastos. Robôs determinísticos e mensagens prontas não são consumo de tokens de IA.

## Três caminhos possíveis

| Opção | Entrega | Avaliação |
|---|---|---|
| A — Medição e painel | Consolidar consumo e exibir médias/alertas. | Mais curta, mas não atende à necessidade de parar uma conversa excessiva. |
| **B — Medição, trava e painel** | Registro completo do atendimento automático, teto por conversa, liberação manual, visão de consumo e reserva de saldo. | **Recomendada:** atende o pedido e a condição de teste discutida com o SGM. |
| C — Gestão financeira completa da IA | B mais orçamento por departamento, repasse de cobrança, franquias e planos comerciais. | Escopo maior; não necessário para esta primeira entrega. |

## Desenho recomendado — opção B

### 1. Onde aparece

- **Configurações → IA e Automações → Consumo e limites**: painel e regras gerais da organização, junto de Central de IA, agentes e execuções.
- **Na conversa**: consumo acumulado do atendimento, saldo de quota, situação da IA e motivo da pausa. Botão de liberar cota adicional para o responsável autorizado e administradores.
- **No agente**: referência à regra da organização; eventual limite mais restritivo por agente é evolução posterior. Trocar de agente não reinicia orçamento.
- Primeira versão identificada como consumo do **atendimento automático WhatsApp e seus recursos auxiliares**. Não chamar de gasto total de toda IA do CRM enquanto assistente interno, aplicações externas e outras rotas não estiverem instrumentados.

### 2. Como funciona a trava

O administrador define um número positivo de tokens por atendimento. Não será criado um valor supostamente aprovado a partir dos “600” da reunião. A escolha inicial deve considerar amostras reais de atendimento e o modelo usado; a configuração mostra a unidade e compara o teto com a média e a distribuição de consumo dos atendimentos medidos.

Antes de cada operação paga, o servidor verifica a quota e reserva o máximo autorizado para aquela operação. A soma de consumo confirmado e reservas não pode ultrapassar o saldo concedido. Duas execuções concorrentes não podem gastar o mesmo saldo. Cada chamada limita sua saída e as entradas aceitas, incluindo novas chamadas dentro de ferramentas, revisões e retries.

Quando não cabe a próxima operação, a IA pausa por limite, registra a ocorrência e avisa internamente. Novas mensagens, cron, follow-up, início manual genérico, troca de agente e limpeza de memória não desfazem esse bloqueio. Não há resposta automática ao contato por causa do limite. Não se encerra o lead nem se altera sua etapa.

**Confirmado por Samuel:** retomada somente manual pelo responsável. **Mecanismo aprovado com a opção B:** o responsável recebe a opção de acrescentar uma quota positiva, vendo o acumulado antes de confirmar. Registrar quem liberou, quando, quantidade e motivo. Conceder quota adicional preserva todo o consumo anterior e não desliga o limite. Não usar o botão genérico de retomar como autorização implícita de gasto adicional. A permissão administrativa alternativa faz parte da opção B aprovada em 23/10; não foi atribuída como fala da reunião.

O orçamento pertence ao atendimento da conversa, compartilhado entre agentes. Troca de conexão de envio dentro do mesmo atendimento mantém a quota. Se a implementação atual representar a mesma conversa lógica com vários IDs físicos, o resolvedor de identidade deverá uni-los antes de habilitar a trava; não consolidar contatos diferentes por nome/telefone aproximado. Atendimento novo e encerramento precisam de eventos explícitos e auditáveis; não abrir automaticamente um novo orçamento porque o anterior acabou.

### 3. Medição e confiabilidade

Registrar cada tentativa com organização, atendimento/conversa, execução, agente, negócio quando conhecido, provedor, modelo, finalidade, horário, identificador idempotente, resultado e consumo. Não copiar prompts, mensagens ou chaves para esse registro.

- Entrada e saída reais informadas pelo provedor. Cache e raciocínio são detalhes, não parcelas somadas novamente ao total quando já o compõem.
- Operações auxiliares, análise de mídia, embeddings de consulta, follow-ups e revisões pertencem ao atendimento que os causou. Upload/indexação de documentos, criação de roteiros e simulador aparecem separados como configuração/teste, com proteção de quota própria da organização, sem inflar consumo do lead.
- Tentativas falhas também podem custar. Timeout após despacho ou ausência de usage fica como **consumo pendente de confirmação**, nunca zero. A reserva permanece bloqueada até conciliação ou decisão administrativa auditada; não liberar apenas por expiração do relógio.
- Se o banco não consegue autorizar/reservar, não iniciar uma nova chamada paga. O atendimento humano continua funcionando.
- Serviços sem unidade de token, como certas transcrições, têm medição por unidade própria e reserva de custo/quota correspondente. Sem adaptador capaz de limitar a operação, o atendimento protegido não dispara esse serviço: encaminha a pendência ao humano. Isso evita prometer proteção financeira baseada só em tokens.
- Chamadas externas, por exemplo n8n usando a chave fora do CRM, não são bloqueadas por esta trava. O painel delimita sua cobertura.
- Histórico antigo permanece intacto. Dados legados podem ser exibidos em seção de cobertura parcial; não preencher chamadas inexistentes nem reconstruir valores financeiros fictícios.

### 4. Painel proposto

Cards: tokens no período, custo estimado coberto, média por atendimento, atendimentos bloqueados e consumo aguardando confirmação. Mostrar entrada/saída, modelo, agente e data; ranking das conversas que mais consumiram; evolução diária; acesso aos detalhes de cada atendimento. Usar período no fuso da organização e intervalos sem dupla contagem de fronteira.

Definições para evitar a confusão dos relatórios comerciais anteriores:

- **Tokens no período:** soma dos eventos ocorridos no intervalo selecionado, independentemente da criação do lead.
- **Média por atendimento no período:** tokens dessas operações com atendimento dividido pela quantidade de atendimentos distintos que consumiram no mesmo período. Não incluir simulador ou indexação administrativa no numerador.
- **Consumo até o contrato:** selecionar negócios distintos cujo primeiro marco de ganho em Cliente ocorreu no período. Somar, uma única vez, as operações de todos os atendimentos inequivocamente vinculados a cada negócio, até esse marco. A média divide essa soma pela quantidade de negócios com cobertura integral; mostrar também quantos foram excluídos por cobertura parcial ou vínculo ambíguo. Um gasto não pode ser atribuído a dois negócios. Não alterar o marco de ganho nem as datas do CRM, e não contar reabertura como outro primeiro ganho.
- **Saldo do atendimento:** todas as quotas concedidas menos consumo confirmado e reservas pendentes, sem depender do filtro de datas do painel.
- **Custo estimado:** tarifas versionadas por modelo, provedor e unidade na moeda de origem; cache contabilizado na tarifa correta. Tarifa ausente significa estimativa indisponível, não custo zero. Não apresentar estimativa como fatura oficial nem converter para reais com câmbio inventado.

Alerta em 80% é uma sugestão de produto, não decisão da reunião. A interrupção efetiva considera se a próxima operação cabe no saldo restante, podendo ocorrer antes de atingir exatamente 100%.

### 5. Permissões e preservação

Administradores configuram limites. O responsável pela conversa pode conceder quota adicional no atendimento que tem permissão de atender; administradores podem fazê-lo dentro da própria organização. Conversa sem responsável avisa administradores. Nunca confiar em organization_id enviado pelo navegador.

Registro de consumo, concessões e bloqueios separado do texto das conversas; sem exclusão em cascata de consumo quando um agente/conversa é removido. Histórico de despesas sujeito à política de retenção da organização. Novas tabelas/funções e migrações aditivas; nenhum backfill que apague/regrave conversas, leads ou datas.

## Critérios de aceite da proposta

1. Painel e trava consultam a mesma base de consumo, com detalhes reconciliáveis.
2. Uma conversa em limite não dispara chamadas de IA por nenhuma entrada do agente.
3. Liberação manual acrescenta quota e mantém o acumulado; tentativa sem permissão falha.
4. Concorrência, retries e timeouts não liberam saldo indevido nem duplicam contabilização.
5. Mídia/auxiliares não ficam fora da proteção; unidades sem token são explicitadas.
6. Chamadas de teste são identificadas e protegidas, sem mensagens reais.
7. Conversas, mensagens, cards e marcos históricos permanecem preservados.
8. Piloto com política explícita antes de ampliar; nada de habilitar uma trava arbitrária para todos os clientes.

## Estado da decisão

Samuel aprovou a implementação da opção B em 23/10/2026, mantendo liberação manual e testes sem mensagens reais. Medição, bloqueio, concessão adicional, painel e permissões foram implementados localmente. O valor numérico será configurado explicitamente por organização. Não houve publicação, migração remota, ativação de quotas, chamada paga ou envio real neste escopo. O plano de implementação registra os testes e a limitação do ensaio de concorrência SQL.
