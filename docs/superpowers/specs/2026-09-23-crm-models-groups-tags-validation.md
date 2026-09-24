# Verificação e publicação — modelos, grupos e etiquetas

Escopo aprovado: entregar em staging. Produção permanece fora desta entrega.

## Ambientes

- Base conferida: main e staging em `e5b1303` antes das mudanças; conferência repetida durante a execução.
- Supabase staging: `mggvzlmquzqcloprxmoe`.
- Alias staging: https://nossocrm-git-staging-samuel-macarios-projects.vercel.app
- `platform_config.main_organization_id` configurado em staging com UUID validado da Anúncio Jurídico (`428e1830-2ff5-425a-b9b1-f9379897c2c6`).

## Evidências reunidas

- Modelos: 39 testes específicos; importação cria cópia independente desligada, preserva caminhos/layout, restringe modelos privados, controla publicação oficial pelo papel real, remove segredos e bloqueia vínculos/roteamento incompletos.
- Grupos: 18 testes de participantes, provedor, seleção/edição de menções e rota de envio; IDs reais de participantes permanecem distintos de números telefônicos e LIDs.
- Etiquetas: regressões SQL reais com rollback cobrem união inicial, várias conversas do mesmo lead, outro lead do mesmo contato intacto, inclusão/remoção bidirecional, vínculo/troca/desvinculação, grupos independentes, rejeição entre organizações, renomeação/exclusão sem ressurreição, recriação deliberada, permissões da RPC e exclusão lógica do lead.
- Migração executada duas vezes: idempotência confirmada. Um registro legado semeado antes da migração preservou seu ID, nome normalizado e cor; conteúdo original ficou no arquivo privado. Dados temporários foram removidos.
- HTTP autenticado contra banco staging: união, adições simultâneas por duas conversas, convergência, integração direta, isolamento e catálogo passaram. Sem mensagens reais; fixtures removidas.
- RLS com papel `authenticated` de administrador comum: INSERT/UPDATE/DELETE direto pela view legada funcionou na organização permitida; escrita em organização alheia foi rejeitada. Transação revertida.
- Navegador: biblioteca vazia, criação do zero, ações do editor, formulário de modelo oficial, chats e retorno à AJ conferidos. Cabeçalho acomodou o atalho sem cortes. Conta original restaurada e sessão temporária revogada.
- Suíte geral em `1bedefa`: 613 passaram, 5 ignorados e 11 falharam. As 11 falhas são exatamente as anteriormente reproduzidas na base: middleware, história US-001, verificações estáticas/snapshot de cache e modal de etapas do board.
- Build de produção local em `1bedefa` passou. Regressão posterior `fa5bfa1`: 20 testes focados e 9 casos SQL passaram, incluindo proteção do vínculo autorizado contra alterações concorrentes. Revisão das etiquetas e re-revisão passaram. Tipos e lint dos arquivos alterados passaram nos relatórios das tarefas.

## Limites conhecidos

O staging não tem grupo Evolution conectado. Participantes/menções foram validados com contratos reais do provedor e testes controlados, sem disparo para destinatários reais. A integração com um grupo conectado ainda requer conferência operacional.

Integrações antigas que substituem arrays completos continuam com a última gravação prevalecendo; a nova edição de etiquetas no chat usa deltas atômicos. Chamadores diretos antigos conservam sua responsabilidade de repetir transações abortadas.

A biblioteca começa vazia: modelos podem ser salvos de robôs existentes; superadmins publicam seus snapshots oficiais. Segredos e configuração de webhook devem ser preenchidos no destino.

## Quando produção for autorizada

Aplicar as migrações versionadas de modelos e etiquetas antes do novo código. Configurar `main_organization_id` com o UUID verificado da AJ no ambiente de produção. Conferir histórico/schema, publicar o mesmo código validado, validar isolamento e um grupo com provedor compatível. A migração preserva dados legados num arquivo privado; voltar somente o código antigo não desfaz a unificação do catálogo.

## Revisão final

Revisão geral `e5b1303..4a69187` aprovada para staging, sem achados críticos/importantes. Build final do código `fa5bfa1` e ambos os testes HTTP em modo de produção passaram. Migrações/histórico de staging alinhados às versões `20260924002950` e `20260924010603`.

Observações menores mantidas: contato sem conversa persistida pode criar lead, mas o painel só exibe vínculo quando a conversa existir (lead acessível no board); menções validam membro/identificador real, sem impor igualdade literal do nome exibido. Nenhuma dessas observações altera o isolamento ou a sincronização por vínculo explícito.

## Ajustes aprovados em 24/09 — qualificação, menu e largura

Samuel confirmou que o indicador deve incluir datas estimadas de primeira qualificação no período, inclusive de leads antigos. O gráfico continua usando criação no período e etapa atual. Avançar diretamente para uma etapa após Qualificado conta como qualificação; não exige visita intermediária no CRM. Não adotamos a proposta anterior de igualar a população do indicador à do gráfico.

- Removida a exclusão das datas estimadas no cálculo. Drilldown e PDF explicam a mesma regra; datas sem qualquer registro continuam sem mês atribuído.
- O trigger existente já registra a primeira qualificação ao saltar etapas. Validado no banco de staging com `supabase/tests/qualification_stage_jumps.sql`, dentro de transação revertida: Novo Lead/Em qualificação → Qualificado/Reunião agendada/Contratado; regressões preservam a data; perda não qualifica por estar no fim do funil.
- Consulta somente leitura ao BPC Autista/MPL em produção, setembro/2026, reproduziu 24 qualificações sem estimativas e 31 no gráfico. Incluindo estimativas, o indicador conta 44; 9 dos 31 do gráfico têm data estimada. Não foi necessário alterar dados de produção.
- Menu de organizações em portal acima do lead, com posição acompanhando a sidebar e foco próprio que pausa/restaura o foco do modal.
- Colunas desktop crescem igualmente a partir de 280 px em Em aberto/Todos. Ganhos/Perdidos mantêm largura fixa; regra mobile preservada.

Validação: 53 testes de relatório/menu/atalho + 5 de modal/deep-link; lint dos arquivos alterados; typecheck e build de produção passaram. Navegador autenticado no build local com staging: menu por cima do card e busca focada; três colunas preenchendo a área disponível; Ganhos com colunas de 280 px. Nenhuma mensagem enviada e teste SQL integralmente revertido.
