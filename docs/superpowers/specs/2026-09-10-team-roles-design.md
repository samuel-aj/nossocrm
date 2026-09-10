# Equipe, administrador mestre e funções por funil

Data: 2026-09-10
Destino inicial: staging. Nenhuma promoção para main nesta fase.

## Decisões confirmadas

- Super admins são desenvolvedores da plataforma: não aparecem na equipe do cliente nem na contagem de membros.
- Cada organização pode ter no máximo um administrador mestre. Inicialmente pode não ter nenhum.
- Apenas super admins definem o primeiro mestre e transferem a função, sempre manualmente.
- O mestre gerencia membros, promove/rebaixa administradores e cria, edita e atribui funções personalizadas.
- Administradores comuns têm acesso operacional completo aos funis, mas não gerenciam membros, funções ou permissões.
- Funções personalizadas definem quais funis podem ser acessados e as ações permitidas em cada funil.
- A visibilidade de cada funil pode ser "todos os leads" ou "somente os próprios".
- Em "somente os próprios", leads sem responsável e leads de outros usuários ficam ocultos.
- Criar, editar, mover e excluir leads são permissões independentes, sempre subordinadas à visibilidade.

## Abordagem escolhida para revisão

Evoluir o mecanismo existente de permissões, acrescentando funções reutilizáveis por organização e regras por funil.
Manter somente regras individuais dificultaria administrar vários vendedores; criar um sistema totalmente separado duplicaria os controles atuais.
Cada membro restrito recebe uma função por organização nesta primeira versão. Sem acumular funções ou adicionar exceções individuais novas.
Uma função pode liberar apenas um funil, vários ou nenhum. Funis novos não entram automaticamente em funções já criadas.

## Interface

Em Configurações > Equipe, apresentar membros reais, papel e função, com identificação do mestre.
Mestre e super admin têm ações de convite, alteração de papel e atribuição de função.
Administradores comuns podem consultar a equipe, sem controles de gestão de acesso.
A área de Funções oferece nome, descrição opcional e uma linha por funil: acesso, todos/próprios, criar, editar, mover e excluir.
Desabilitar o acesso a um funil também desabilita suas ações.
Atribuir função mostra um resumo do acesso resultante antes de salvar.
Exibir estados de carregamento, vazio e erro; não apresentar sucesso quando a gravação falhar.
O super admin define ou transfere o mestre na administração da organização. A operação exige um membro ativo e uma confirmação identificando o mestre anterior e o novo.

## Mestre e acesso técnico

Representar o mestre como autoridade vinculada à organização, sem substituir o papel global do perfil.
A transferência deve ser atômica: o novo mestre recebe acesso administrativo e o anterior permanece administrador comum.
Impedir a remoção, suspensão ou rebaixamento do mestre enquanto não houver transferência feita pelo super admin.
Uma organização sem mestre mantém a operação existente; somente super admins podem realizar a gestão de equipe até a definição manual.
Administradores comuns não podem usar convites, endpoints antigos ou gravação direta para promover usuários ou alterar permissões.
Os super admins mantêm o acesso técnico e a capacidade de suporte, sem virar membros por navegar na organização.
Preservar nomes de super admins em registros históricos de autoria e responsabilidade, sem adicioná-los às listas de atribuição de novos responsáveis.

## Aplicação das permissões

O escopo da organização vem da sessão e do contexto validado da aba, nunca de um parâmetro aceito sem validação.
Uma única resolução de permissões alimenta a interface e o servidor; o banco aplica regras equivalentes.
Bloquear também acesso por URL direta, buscas, relatórios, exportações e consultas privilegiadas associadas aos leads.
Os contatos e dados relacionados não podem revelar informações de leads aos quais o usuário não tem acesso.
Preservar as configurações de WhatsApp e contatos existentes; evitar ampliar permissões ao migrar.
Em funções novas, regra ausente ou inválida não libera acesso. Falha de carregamento deve ser tratada como erro, sem fallback para acesso total.
A ação de criar em escopo "próprios" atribui o lead ao criador; não cria um lead sem responsável que desapareceria da lista.
Alterar responsável ou transferir entre funis requer autorização nas origens e destinos, sem permitir assumir um lead oculto.
Depois de uma revogação, requisições novas são bloqueadas e os dados já carregados são removidos da interface na atualização de permissões.

## Dados e arquitetura

Reaproveitar lib/permissions e o mecanismo de organização por aba.
Introduzir vínculo do mestre por organização, funções da organização, permissões da função por funil e atribuição da função aos membros.
As tabelas novas precisam de isolamento por organização e controle de leitura/gravação.
A gestão de membros em app/api/admin/users e convites deve validar autoridade de mestre ou super admin.
Atualizar as rotas de visibilidade, os guards de ações e as políticas de leitura de deals/boards.
Contagem de membros e listagem da equipe devem usar a mesma regra de exclusão dos super admins.
Registrar quem definiu/transferiu o mestre e quem alterou funções ou atribuições.
Não trocar automaticamente mestres, remover usuários ou apagar o histórico existente.

## Transição e staging

Antes de aplicar migrações, confirmar que o banco usado pelo deployment de staging é separado do banco de produção.
Não aplicar alterações de autorização a um banco compartilhado com produção durante os testes.
Preservar papéis administrativos atuais na operação; retirar deles somente a gestão de acesso reservada ao mestre.
Converter as permissões de vendedores sem ampliar o conjunto de funis e ações.
Regras legadas especiais, como visualização de equipe, permanecem compatíveis até serem substituídas explicitamente por uma função.
O escopo legado "próprios" passa a ocultar leads sem responsável, conforme a decisão confirmada.
Usuários novos restritos recebem uma função explicitamente; sem função, ficam sem acesso aos funis.
Remover uma função em uso exige reatribuir seus membros, sem deixá-los com acesso total por ausência de configuração.
Validar tudo em staging e só propor promoção a main após revisão dos testes pelo usuário.

## Critérios de aceitação

1. Super admins não aparecem na equipe, nos totais nem nas opções para novas atribuições; autoria histórica permanece legível.
2. Só super admin define ou transfere o mestre, inclusive por chamada direta à API.
3. Mestre gerencia a equipe; administradores comuns operam todos os funis, mas não alteram acessos.
4. Um vendedor com acesso somente ao funil A não encontra dados do funil B por tela, URL, busca, relatório ou exportação.
5. Em "próprios", apenas owner_id do usuário é visível; owner_id nulo e de terceiros são negados.
6. Em "todos", o usuário vê todos os leads do funil permitido, incluindo os sem responsável.
7. Permissões de criar, editar, mover e excluir funcionam independentemente; visualizar não concede escrita.
8. Mudanças de função refletem nos membros atribuídos, sem atravessar organizações.
9. Migração mantém acessos existentes, exceto as restrições explicitamente confirmadas neste documento.
10. Validar com testes de matriz de permissões, endpoints, banco/RLS e fluxos de interface; incluir chamadas sem autorização e sessões de organizações diferentes.
11. Conferir textos acentuados em UTF-8, acessibilidade, loading e erros no design existente.

## Estado

Especificação consolidada para revisão do usuário. Implementação das novas permissões ainda não iniciada.
