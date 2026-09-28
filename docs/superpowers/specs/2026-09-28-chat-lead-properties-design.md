# Chats e lead: propriedades, notas internas e mudança de funil

Data: 28/09/2026. Produto: NossoCRM.

## Situação e decisões de Samuel

Samuel escolheu a proposta visual 3: seções expansíveis. O painel fica à direita da conversa em Chats e a mesma organização será aplicada à coluna de propriedades do card do lead. Ao selecionar uma conversa, a navegação principal esquerda recolhe para ícones; a lista de conversas permanece visível.

Samuel também pediu confirmação para uma seleção de etapa que transfira o lead para outro funil. A intenção é evitar transferências acidentais no seletor em cascata.

Publicação das alterações aprovadas diretamente no principal, após testes e comparação de desempenho. Staging está reservado a outro trabalho. Esta especificação não representa uma implementação ou publicação.

## Objetivo

Atender a conversa com os dados e as notas do lead correto, sem alternar entre Chats e board, preservando a agilidade do chat e as permissões existentes.

### Base observada no código

- `DealDetailModal` concentra as propriedades e entrega a linha do tempo ao `DealWhatsAppChat`.
- `ChatsPage` usa o mesmo chat, mas não entrega a linha do tempo. Isso explica as notas visíveis no board e ausentes em Chats no caso investigado.
- `DealStageControl` é compartilhado pelas duas telas e usa `useMoveDeal`, responsável pelo movimento e pelas automações associadas.
- `StageCascadePicker` já separa navegar entre funis de selecionar uma etapa. Hoje uma seleção em outro funil chama o movimento imediatamente.
- O histórico atual consulta até 1.000 eventos e 300 notas de API por lead, além de metadados de atividades. O corpo das notas em atividades vem da lista global. A nova integração em Chats precisa de leitura delimitada ao lead e paginação.
- As correções de vínculo publicadas em `3022502` são a base deste trabalho.

## 1. Painel compartilhado — proposta 3

### Organização

Cabeçalho fixo: identificação do lead, situação, etiquetas, funil e etapa. Ações menos frequentes em menu de opções; excluir continua exigindo sua confirmação própria.

Seções, nesta ordem:

1. **Negócio**, inicialmente aberta: valor, responsável, prioridade e descrição. Descrição vazia ocupa uma linha com a ação de adicionar; o editor cresce durante o uso.
2. **Contato**, inicialmente aberta: nome, telefone, e-mail quando disponível e empresa. Preservar copiar dados e abrir o contato.
3. **Campos personalizados**, inicialmente recolhida: preservar tipos, grupos, ordem, validações e visibilidade por funil. O resumo indica quantos campos estão preenchidos. Ao abrir, grupos com dados começam expandidos.
4. **Produtos**, inicialmente recolhida, com quantidade no título: preservar catálogo, item avulso, quantidades, preços e remoção.
5. **UTMs**, inicialmente recolhida: preservar leitura e edição existentes.
6. **Detalhes**, inicialmente recolhida: criação e probabilidade, além dos metadados já existentes. Prioridade fica em Negócio, sem duplicação.

As seções podem ficar abertas ao mesmo tempo. Abrir ou fechar uma seção não salva dados nem refaz consultas de dados já disponíveis. A escolha de expansão permanece enquanto o usuário atende naquele painel; atualizar o lead em tempo real não reinicia a organização.

Edição mostra estado de salvamento e erro recuperável. Só indicar “salvo” depois da confirmação do servidor. Texto digitado deve permanecer em caso de falha. Campos sem permissão são somente leitura.

### Posicionamento e espaço

- Chats no desktop: navegação em ícones, lista de conversas, conversa com maior largura, propriedades à direita. O painel pode ser recolhido e reaberto pelo cabeçalho.
- Card do lead: a coluna de propriedades mantém seu lado atual e adota o mesmo componente e a mesma organização.
- Usar painel lateral de aproximadamente 360 px no desktop. Quando o espaço não comportar a conversa com pelo menos 480 px, abrir propriedades em painel sobreposto, acionado por botão. Não comprimir o compositor para manter todas as colunas abertas.
- Preservar os temas claro e escuro, navegação por teclado, rótulos acessíveis e retorno de foco ao fechar o painel.
- Reorganizar o painel não pode remontar a instância da conversa, apagar rascunhos ou deslocar a rolagem do histórico.

## 2. Confirmação ao mudar de funil

### Regra

- Passar o mouse, usar as setas ou clicar no nome de outro funil apenas apresenta suas etapas.
- Escolher outra etapa **do mesmo funil** mantém o comportamento atual, incluindo o motivo de perda quando aplicável.
- Escolher uma etapa **de outro funil** abre a confirmação antes de qualquer alteração, atividade de movimento ou automação.
- A proteção vale para o seletor compartilhado do card e do chat. Não muda regras de automações nem introduz confirmação em movimentações automáticas.

### Texto do modal

**Deseja mudar lead de funil?**

Você vai mover **{nome do lead}** para outro funil.

**De:** {funil atual} → {etapa atual}

**Para:** {funil de destino} → {etapa de destino}

Botões: **Cancelar** e **Confirmar mudança de funil**.

Quando houver efeitos relevantes já conhecidos da etapa selecionada, explicar em uma linha: encerramento como ganho/perdido, reabertura de um lead encerrado ou automação configurada para a etapa. Não inventar consequências nem prometer reversão de mensagens enviadas por automações.

### Comportamento e integridade

- Cancelar, Escape e clique fora antes da confirmação deixam os dados intactos e devolvem o foco ao seletor.
- Se o destino exigir motivo de perda, a confirmação de funil vem primeiro; o motivo vem depois. Cancelar qualquer uma das etapas não move o lead.
- Ao confirmar, executar uma única vez pelo caminho existente de `useMoveDeal`. Bloquear clique repetido durante o envio.
- Se lead, funil, etapa de origem ou destino mudarem enquanto o modal estiver aberto, descartar a seleção pendente e pedir que a pessoa selecione novamente. A confirmação antiga não pode mover outro lead.
- Manter as permissões atuais e a validação do servidor. A confirmação visual não concede acesso.
- Em falha, apresentar erro e recuperar o estado confirmado sem sobrescrever mudanças posteriores de outro registro.

## 3. Lead vinculado e notas internas

- O painel e a linha do tempo usam o mesmo identificador do lead vinculado à conversa. Um título parecido ou telefone parcial não escolhe outro lead.
- Manter a resolução de vínculo já publicada: ambiguidade não gera escolha silenciosa e um desvínculo manual não é revertido automaticamente.
- Ao selecionar explicitamente outro lead, trocar propriedades e notas juntas. Respostas atrasadas da seleção anterior são ignoradas.
- Conversa sem lead mantém ações de criar/vincular conforme permissões. Carregamento e falha são estados distintos de ausência de vínculo.
- Grupos de WhatsApp mantêm seu fluxo próprio, sem passar a receber lead, contato individual ou notas de uma pessoa por engano.
- Exibir notas de atividades (`NOTE` e `note`) e notas existentes da API, com identificação de origem para não duplicar registros. Manter autoria, data e indicação de edição disponíveis.
- Notas aparecem em ordem cronológica junto das mensagens, com rótulo e estilo de nota interna. Criar, editar ou excluir uma nota usa as permissões existentes e nunca chama o envio do WhatsApp.
- Preservar a edição disponível para cada origem de nota; não transformar notas de API atualmente somente leitura em notas editáveis sem um fluxo compatível.
- Preservar atividades e eventos já visíveis no board. Compartilhar a apresentação com Chats sem remover o histórico que a equipe usa.

## 4. Recolhimento da navegação

Ao selecionar uma conversa diferente, recolher apenas o menu principal. A pessoa pode reabrir o menu manualmente enquanto atende. Receber mensagens, carregar propriedades ou atualizar a conversa selecionada não recolhe o menu de novo.

Ao sair de Chats, restaurar o estado anterior ao recolhimento automático se a pessoa não tiver escolhido outro estado manualmente durante o atendimento. Usar o estado existente em `CRMContext`; não criar uma segunda preferência concorrente.

## 5. Componentes e fluxo de dados

### Limites de responsabilidade

- **Painel de propriedades compartilhado:** campos, seções, editores e estados de salvamento. Recebe o lead confirmado e os mesmos serviços/permissões já usados pelo card.
- **Integração da conversa:** resolve o lead selecionado e conecta painel, linha do tempo e compositores. Mantém identidade e rascunhos da conversa separados do estado de expansão das propriedades.
- **Linha do tempo compartilhada:** normaliza notas, atividades e eventos, ordena e deduplica. Reutiliza apresentação de `LeadTimeline` e compositores de `LeadComposers`.
- **Leitura paginada por lead:** busca somente o histórico do lead autorizado; delimita a primeira página e permite buscar registros anteriores explicitamente.
- **Controle de etapa compartilhado:** mantém uma seleção pendente local e chama `useMoveDeal` somente depois das confirmações exigidas.

### Carregamento e cache

- O chat não espera propriedades secundárias para ficar utilizável. Iniciar leitura de propriedades e histórico em paralelo com a conversa, quando seus identificadores estiverem resolvidos.
- A primeira página do histórico fica limitada a 50 itens de linha do tempo. Usar cursor estável por data, origem e identificador; registros com a mesma data não podem sumir ou se repetir entre páginas.
- Páginas anteriores são carregadas por ação “Carregar histórico anterior”, preservando a posição de leitura. O histórico de WhatsApp mantém sua paginação própria.
- Consultas por organização e lead, canceláveis ao trocar a seleção. Nenhuma busca de todas as notas da organização para renderizar uma conversa.
- Reutilizar os caches canônicos documentados em `AGENTS.md`: `DEALS_VIEW_KEY` para lead enriquecido; listas canônicas para mutações das outras entidades. A paginação é uma visão de leitura compartilhada pelas duas telas, atualizada pelo mesmo caminho de mutação; não adicionar uma cópia otimista independente.
- Eventos de tempo real e salvamentos atualizam o registro afetado. Revalidação após reconexão/foco recupera eventos perdidos; erro de rede aparece como erro recuperável.
- Não adicionar uma assinatura de tempo real por campo ou seção. Não copiar o polling frequente do histórico inteiro para cada painel.
- Controles pesados, catálogo e ferramentas de IA são carregados quando usados. Reutilizar as dependências existentes.
- Toda leitura aplica organização e visibilidade do usuário. Ocultar um painel não substitui autorização no servidor.

## 6. Medição antes e depois

Registrar baseline de `3022502` antes de alterar a implementação. Comparar a versão candidata nas mesmas contas, conversas, navegador, janela, rede e permissões; registrar versão e condições no relatório.

### Métricas

1. **Tempo até conversa utilizável:** seleção da conversa até cabeçalho, mensagens iniciais e compositor disponível conforme a janela/permissão do WhatsApp. Medir propriedades e primeira página de notas separadamente.
2. **Volume transferido:** bytes de respostas na janela de 10 segundos após a seleção, separando dados e recursos estáticos. Registrar respostas servidas por cache e limitações da instrumentação.
3. **Requisições:** quantidade na mesma janela, separando leitura de dados, recursos e conexões de tempo real. Não misturar períodos diferentes de polling.

### Cenários

Primeira abertura sem cache; reabertura com cache; alternância entre duas conversas; troca rápida com respostas fora de ordem; conversa longa; abrir/recolher propriedades; salvar um campo; criar/editar nota. Registrar 10 execuções por cenário de abertura e apresentar mediana, p90 e intervalo observado.

### Critérios de aceitação

- Abrir ou recolher uma seção já carregada não cria requisições adicionais.
- Alternar Chats e card não refaz uma leitura de histórico ainda válida apenas por serem telas distintas.
- A quantidade de dados iniciais de notas é limitada por página, independentemente do histórico total.
- Sem duplicação de consulta causada pelo painel e pelo chat consumirem o mesmo lead.
- Nenhuma regressão repetível no tempo de conversa utilizável pode ser aceita sem investigar e corrigir sua causa; mostrar os valores reais, inclusive o custo adicional necessário das notas.
- Definir um orçamento absoluto em ms e KB a partir da baseline antes de iniciar a implementação e registrar a justificativa no plano. Não usar um percentual arbitrário nem prometer impacto zero.

## 7. Verificação funcional

- Seletor: navegação entre funis sem mutação; mudança no mesmo funil; confirmação de outro funil; cancelar; teclado; clique repetido; perda com motivo; destino ganho; estado alterado enquanto o modal está aberto; falha de salvamento.
- Paridade de campos: título, situação, etiquetas, etapa, valor, responsável, descrição, campos personalizados, produtos, UTMs, contato/empresa, prioridade e probabilidade em ambas as telas.
- Notas: leitura nas duas telas, autoria, criação, edição, exclusão permitida, erros recuperáveis, paginação com datas iguais, atualização por outro usuário e ausência de chamada ao envio de WhatsApp.
- Vínculos: um lead, vários leads, desvinculado manualmente, grupo e troca rápida de conversa/organização. Preservar os testes das correções anteriores.
- Permissões: usuário com acesso de leitura, usuário com edição, lead não visível e organização diferente.
- Layout: desktop amplo, notebook com painel sobreposto, tela estreita, claro/escuro, teclado, rascunho e rolagem preservados.
- Rodar testes direcionados, suíte completa, typecheck, lint dos arquivos alterados e build. Separar falhas já existentes das regressões desta mudança.

## 8. Entrega e publicação

Implementar em commits revisáveis a partir da versão publicada. Produzir relatório com medições antes/depois, testes executados, evidências de paridade e limitações. Publicar no principal conforme autorização existente, com commit anterior identificado para reversão.

Verificação após publicação sem envio de mensagens a clientes e sem movimentar leads reais para experimentar o modal. Mutações de teste usam registros isolados e sem automações de comunicação, com limpeza ao final.

## Fora do escopo

Reescrita do CRM, troca de tecnologia, conversão para low code, mudanças nas regras de grupos, redesign de outras telas e alteração de automações existentes. O esforço de simplificação se concentra nos componentes e consultas envolvidos neste atendimento.
