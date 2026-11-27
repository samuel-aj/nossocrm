# Registro de alterações do NossoCRM

Tudo o que entra em produção fica registrado aqui: o que mudou, por quê, quem fez, se mexeu no banco e como voltar atrás. As entradas mais novas ficam em cima.

## Como registrar

Toda publicação na `main` leva a sua entrada, no mesmo merge. Copie o modelo, preencha e cole **logo abaixo da linha marcada**:

```markdown
### DD/MM/AAAA · Título curto, em linguagem de quem usa o CRM
- **Tipo:** Novo | Melhoria | Correção | Segurança | Infraestrutura
- **O que mudou:** o que a pessoa vê ou o que passou a acontecer.
- **Por quê:** o problema ou o pedido que motivou.
- **Quem:** quem pediu e quem fez (pessoa, Claude Code, Codex).
- **Banco:** "sem SQL" ou o nome da migração e do arquivo de desfazer.
- **Para voltar:** a etiqueta `prod-pre-...` criada com `npm run checkpoint`.
```

Regras:

- Uma entrada por publicação. Correções pequenas do mesmo assunto, no mesmo dia, podem ir juntas.
- Escreva para quem não programa. Nome de arquivo e de função só quando ajudar a achar a mudança.
- Não apague nem reescreva entradas antigas. Se algo foi desfeito, registre uma entrada nova dizendo isso.
- Mudança só de documentação ou de testes não precisa de entrada.
- O GitHub confere isso sozinho a cada publicação (verificação "Registro de alterações"). Para dispensar de propósito, escreva `[sem-changelog]` no título do PR ou do commit.

Como voltar a uma versão anterior: [docs/restauracao.md](docs/restauracao.md).

<!-- NOVAS ENTRADAS LOGO ABAIXO DESTA LINHA -->

### 27/11/2026 · Menos consultas automáticas do sino
- **Tipo:** Correção
- **O que mudou:** o sino consulta novos avisos a cada minuto e atualiza ao abrir ou voltar para o CRM, com proteção contra consultas seguidas. As preferências deixam de ser consultadas continuamente. Sem internet as consultas param, e falhas repetidas aumentam o intervalo entre tentativas. Ao voltar, o sino recupera até 24 horas desde a última consulta concluída, sem repetir sons de avisos antigos.
- **Por quê:** o ciclo anterior consultava o servidor a cada quatro segundos por aba e elevava o consumo de infraestrutura mesmo sem novidades.
- **Quem:** solicitado por Samuel e implementado por Codex.
- **Banco:** sem SQL.
- **Para voltar:** `prod-pre-sino-consumo` (criar na publicação).

### 27/11/2026 · Sino de notificações no celular
- **Tipo:** Melhoria
- **O que mudou:** o sino abre com até cinco avisos recentes por grupo, dos últimos sete dias. Alertas em andamento e alertas críticos ainda não lidos continuam visíveis. Em “Ver anteriores” você encontra os demais avisos do painel. Os atalhos de preferências e conexão ficaram maiores, e a opção de ativar notificações neste aparelho aparece no topo das preferências.
- **Por quê:** facilitar a leitura dos avisos recentes e a ativação das notificações no celular.
- **Quem:** solicitado por Samuel, implementado por Claude Code e revisado por Codex.
- **Banco:** sem SQL.
- **Para voltar:** `prod-pre-painel-notificacoes-mobile` (criar na publicação).

### 26/11/2026 · Acompanhamento dos agentes de atendimento pelo AgentMaker
- **Tipo:** Novo
- **O que mudou:** o administrador escolhe quais agentes o squad pode acompanhar. O Monitor consulta os atendimentos, e uma chave separada permite ao Engenheiro revisar ou restaurar o roteiro. O CRM registra o original e as alterações manuais e do squad.
- **Por quê:** revisar atendimentos e melhorar o roteiro com histórico e controle de acesso por escritório.
- **Quem:** solicitado por Samuel e implementado por Codex.
- **Banco:** `20261126210000_mcp_ai_agents.sql` e `docs/mcp-ai-agents-rollback.sql`.
- **Para voltar:** `prod-pre-mcp-agentes-ia` (criar na publicação).

### 26/11/2026 · Confirmação do retorno combinado em linguagem natural
- **Tipo:** Melhoria
- **O que mudou:** quando o lead combina um horário de retorno, a confirmação no WhatsApp sai como "Combinado! Te chamo amanhã (26/11) às 9h.", sem fuso e sem ano (o ano só aparece quando o retorno cai em outro ano). A frase diz "hoje", "amanhã" ou "dia 27/11", e os minutos só aparecem quando não são zero. Se a IA já tinha escrito "Combinado", a palavra não se repete. A instrução da IA foi ajustada para confirmar no mesmo formato. Vale para todos os escritórios que usam retorno combinado.
- **Por quê:** a frase antiga ("Combinado! Vou te chamar em 25/11/2026, 09:00 GMT-3.") soava robótica, e um escritório pediu um formato mais natural.
- **Quem:** pedido de um escritório cliente, Claude Code fez (PR #89).
- **Banco:** sem SQL.
- **Para voltar:** `prod-pre-frase-retorno`.

### 26/11/2026 · Conferência dos dados antes de preparar um contrato
- **Tipo:** Correção
- **O que mudou:** Em resultados configurados para exigir dados, o agente guarda o que o cliente já informou e pergunta apenas o que falta. A equipe recebe uma tarefa de revisão se houver falha ao atualizar o negócio ou preparar o documento.
- **Por quê:** A equipe precisa receber os dados completos antes de orientar a assinatura.
- **Quem:** Samuel solicitou e Codex implementou.
- **Banco:** configuração do resultado do agente, sem mudança na estrutura. Para desfazer, use `docs/dados-encerramento-rollback.sql`.
- **Para voltar:** etiqueta `prod-pre-dados-encerramento-20261126`.

### 26/11/2026 · Cadastro da OAB somente em Conhecimento

- **Tipo:** Melhoria
- **O que mudou:** O administrador agora encontra o cadastro das inscrições da OAB exclusivamente na aba Conhecimento do editor de agentes. As inscrições já confirmadas continuam disponíveis para os agentes do escritório.
- **Por quê:** Concentrar o cadastro no local em que o escritório configura as informações que a IA pode usar.
- **Quem:** Samuel pediu, Codex implementou.
- **Banco:** sem SQL.
- **Para voltar:** `prod-pre-oab-somente-conhecimento-20261126`.

### 26/11/2026 · Inscrições da OAB na aba Conhecimento dos agentes

- **Tipo:** Melhoria
- **O que mudou:** Ao editar um agente, o administrador encontra as inscrições da OAB entre a base de conhecimento e as mídias. É o mesmo cadastro do escritório disponível em Configurações → Geral.
- **Por quê:** Permitir que o escritório confira quais números da OAB seus agentes podem informar enquanto configura o atendimento.
- **Quem:** Samuel pediu, Codex implementou.
- **Banco:** sem SQL.
- **Para voltar:** `prod-pre-oab-conhecimento-20261126`.

### 26/11/2026 · Registro das decisões de segurança
- **Tipo:** Infraestrutura
- **O que mudou:** novo documento [docs/decisoes-seguranca.md](docs/decisoes-seguranca.md) com 33 decisões: o que cada regra faz, por quê, quem aprovou, quando entrou, onde fica e o que acontece se for removida. Regra no `AGENTS.md` para manter o documento em dia.
- **Por quê:** as razões das regras estavam espalhadas em conversas e comentários de código, e uma proteção que parece sobrar podia ser removida por engano.
- **Quem:** Samuel pediu, Claude Code fez.
- **Banco:** sem SQL.
- **Para voltar:** `prod-pre-decisoes-seg`.

As entradas de 24 e 25/11 feitas por outras sessões (Codex e PRs) foram escritas depois, a partir do título e da descrição dos commits.

### 25/11/2026 · Registro de alterações (este arquivo)
- **Tipo:** Infraestrutura
- **O que mudou:** o CRM passa a ter um histórico único das publicações, e o GitHub avisa quando alguém publica sem registrar.
- **Por quê:** o histórico estava espalhado em mensagens de commit técnicas e em conversas, e duas sessões publicam em paralelo sem uma ver o que a outra fez.
- **Quem:** Samuel pediu, Claude Code fez.
- **Banco:** sem SQL.
- **Para voltar:** `prod-pre-changelog`.

### 25/11/2026 · Pontos de restauração e guia de como voltar uma versão
- **Tipo:** Infraestrutura
- **O que mudou:** comando `npm run checkpoint` para marcar a versão que está no ar antes de publicar, guia [docs/restauracao.md](docs/restauracao.md) e regras de publicação no `AGENTS.md`. No GitHub, a `main` ficou protegida contra reescrita forçada e exclusão.
- **Por quê:** os pontos de retorno existiam, mas dependiam de alguém lembrar de criar e não havia instrução escrita de como voltar.
- **Quem:** Samuel pediu, Claude Code fez.
- **Banco:** sem SQL.
- **Para voltar:** `prod-pre-restauracao`. A proteção da `main` se desfaz em Settings > Rules > Rulesets no GitHub.

### 25/11/2026 · Vínculo com id ilegível é recusado em vez de salvo sem vínculo
- **Tipo:** Correção
- **O que mudou:** quando chega um id de vínculo que o CRM não consegue ler, o registro é recusado com erro, em vez de ser gravado solto, sem o vínculo.
- **Por quê:** o registro ficava salvo sem ligação e o problema passava despercebido.
- **Quem:** Claude Code, outra sessão (PR #87).
- **Banco:** sem SQL.
- **Para voltar:** desfazer o commit `fc46e04d`.

### 25/11/2026 · Leads criados pela IA do WhatsApp davam "ID inválido"
- **Tipo:** Correção
- **O que mudou:** o CRM passa a aceitar o formato de id (UUID versão 8) usado nos leads criados pela IA do WhatsApp.
- **Por quê:** esses leads mostravam "Invalid deal id" e "ID inválido" em telas e ações.
- **Quem:** Claude Code, outra sessão (PR #86).
- **Banco:** sem SQL.
- **Para voltar:** desfazer o commit `a34a5e27`.

### 25/11/2026 · Senha forte e bloqueio de senha vazada
- **Tipo:** Segurança
- **O que mudou:** toda senha nova precisa ter 8 caracteres, com maiúscula, minúscula e número, e não pode constar em vazamentos conhecidos. Os avisos aparecem em português. Na tela de convite, o erro de senha aparece dentro do formulário em vez de trocar a tela por "Convite Inválido".
- **Por quê:** o CRM aceitava senha de 6 caracteres e a proteção contra senha vazada do Supabase estava desligada.
- **Quem:** Samuel pediu, Claude Code fez. Samuel ligou as opções no painel do Supabase.
- **Banco:** sem SQL. Configuração no painel do Supabase de produção: Authentication > Sign In / Providers > Email.
- **Para voltar:** `prod-pre-senha-forte`, e desligar as três opções no painel.

### 25/11/2026 · Limite de requisições nas APIs
- **Tipo:** Segurança
- **O que mudou:** limites por minuto na API pública (600 por chave, 20 tentativas com chave inválida por IP), na inteligência artificial (30 por usuário), no envio de WhatsApp (120 por usuário), nos convites (20 por IP) e na exportação de contatos (6 por usuário). Quem passa do limite recebe aviso com o tempo de espera, e o estouro aparece no painel de segurança.
- **Por quê:** nenhuma das 209 rotas tinha limite; uma integração em laço ou um script podia sobrecarregar o CRM ou gastar a chave de IA de um escritório.
- **Quem:** Samuel pediu, Claude Code fez.
- **Banco:** sem SQL. Os limites se ajustam por variáveis `RATE_LIMIT_*` na Vercel.
- **Para voltar:** `prod-pre-api-limites`.

### 25/11/2026 · Login registrado no painel de segurança
- **Tipo:** Segurança
- **O que mudou:** o CRM grava cada login (usuário, organização, hora e IP). No painel "Registro de segurança", o filtro "Mostrar" ganhou a opção "Logins" e a página de super admin ganhou um atalho para o painel. A aba "Acessos" saiu.
- **Por quê:** a aba "Acessos" mostrava sempre zero, porque o Supabase não guarda esse histórico no banco deste projeto.
- **Quem:** Samuel pediu, Claude Code fez.
- **Banco:** sem SQL.
- **Para voltar:** `prod-pre-seg-login`.

### 25/11/2026 · Aviso de instalação do aplicativo: ajustes
- **Tipo:** Correção
- **O que mudou:** ícones de instalação com a logo nova, o aviso deixa de cobrir o logo da tela de login, e foram corrigidos o carregamento no iPhone, as telas de convite e o cache em desenvolvimento.
- **Quem:** Claude Code, outra sessão (PRs #83 e #84).
- **Banco:** sem SQL.
- **Para voltar:** desfazer os commits `0511dcdb` e `8fa4beb4`.

### 24/11/2026 · Notificações push de mensagens
- **Tipo:** Novo
- **O que mudou:** o CRM envia notificação de mensagem nova para o aparelho, configurável por aparelho e por escritório.
- **Quem:** Codex.
- **Banco:** migração `crm_web_push` (commits `125a483e` e `586bc6cd`).
- **Para voltar:** desfazer os dois commits.

### 24/11/2026 · Registro de eventos críticos de segurança
- **Tipo:** Segurança
- **O que mudou:** o CRM grava quem fez o quê nas ações sensíveis: equipe, chaves de API, configuração de IA, WhatsApp, ZapSign, webhooks, exportação de contatos, chave de API inválida e senha recusada. O painel "Registro de segurança" fica na página de super admin. Os registros são guardados por 180 dias e o navegador não tem acesso à tabela. De carona, foi corrigido o deslocamento lateral da página ao abrir listas suspensas.
- **Por quê:** não havia como saber quem alterou uma configuração sensível nem perceber tentativas de abuso.
- **Quem:** Samuel pediu, Claude Code fez.
- **Banco:** migração `20261124150000_seguranca_registro_eventos.sql`. Desfazer: [docs/seguranca-eventos-rollback.sql](docs/seguranca-eventos-rollback.sql).
- **Para voltar:** `prod-pre-seg-eventos`.

### 24/11/2026 · Ficha corrigida do contrato e OAB no cadastro do escritório
- **Tipo:** Melhoria
- **O que mudou:** o agente aceita a confirmação da ficha depois de corrigida, e o cadastro do escritório passa a conferir a OAB.
- **Quem:** Codex.
- **Banco:** migração `organization_oab_registrations` (commits `70b73654` e `cc61cbc3`).
- **Para voltar:** desfazer os dois commits.

### 24/11/2026 · Recuperação de mensagens recebidas no WhatsApp
- **Tipo:** Correção
- **O que mudou:** mensagens que entraram durante uma falha passam a ser recuperadas e atendidas. Antes de responder ao acumulado, o CRM confere se o atendimento ainda está pendente e se outra resposta já saiu, e revalida as entradas atrasadas antes de rodar os robôs. A publicação é interrompida se faltar a rota de entrada da IA.
- **Por quê:** mensagens recebidas durante uma falha ficavam sem atendimento.
- **Quem:** Codex.
- **Banco:** migrações `wa_inbound_work`, `wa_entry_recovery_notifications`, `wa_inbound_recovery_bot_guard`, `wa_inbound_unanswered_only` e `wa_inbound_recovery_dispatch_lock` (commits `a0ad7f38` a `cbf75f18`).
- **Para voltar:** desfazer os commits desse intervalo, do mais novo para o mais antigo.

### 24/11/2026 · Segurança, parte 2
- **Tipo:** Segurança
- **O que mudou:** chaves de IA lidas só pelo servidor, token da Meta mascarado na tela, cabeçalhos de segurança, proteção contra chamadas a endereços internos, correção de injeção de script na página da API, conferência de organização na API pública, teto no chat de IA, redirecionamento seguro do login, logs sem dados sensíveis, erros do banco trocados por frases amigáveis, dependências atualizadas e estágios do ciclo de vida só para consulta fora do super admin. No banco, as regras de acesso foram fechadas e o cadastro aberto foi desligado.
- **Por quê:** achados da auditoria de segurança de 23/11/2026.
- **Quem:** Samuel pediu, Claude Code fez. Samuel rodou o SQL.
- **Banco:** migrações `20261123100000_seguranca_parte1.sql`, `20261123120000_seguranca_parte2.sql` e `20261124100000_seguranca_chaves_agentes.sql`. Desfazer: [docs/seguranca-p2-rollback.sql](docs/seguranca-p2-rollback.sql).
- **Para voltar:** `prod-pre-seguranca-p2`.

## Novembro de 2026, de 01 a 23

Resumo montado a partir do histórico do Git, uma linha por publicação. "SQL" indica que a publicação incluiu migração de banco.

| Data | O que entrou | Quem | SQL | Commit |
|---|---|---|---|---|
| 23/11 | Aguardar até cinco minutos pela confirmação da ZapSign | PR #82 | sim | `27e50260` |
| 19/11 | Preservar respostas válidas e o aviso de revisão do atendimento | PR #81 | não | `ffbf1ee0` |
| 18/11 | Alertas por e-mail de suporte e modais de conexão | PR #80 | sim | `3a9bcb64` |
| 18/11 | Corrigir o acesso aos alertas de conexão pelo sino | PR #79 | não | `1bc66b5d` |
| 18/11 | Histórico por número e configuração dos alertas no sino | PR #78 | sim | `1d6b5489` |
| 18/11 | Consulta à base de conhecimento durante a conversa | PR #77 | sim | `499c14e2` |
| 18/11 | Corrigir o diagnóstico da capacidade de mensagens na Meta | PR #76 | não | `01721728` |
| 18/11 | Monitor de conexão do WhatsApp e recuperação de envios pendentes | PR #75 | sim | `74653d14` |
| 17/11 | Robôs: gatilho "Mensagem recebida" | Claude Code | sim | `3b6a4ac1` |
| 17/11 | Modelos Luna, Terra, Sol e Astra disponíveis nos agentes | PR #74 | não | `2d724286` |
| 17/11 | Aviso à equipe quando a revisão da resposta da IA falha | PR #73 | não | `2d40f551` |
| 16/11 | Corrigir pausa por créditos da API e reserva indevida de tokens | PR #72 | sim | `4c1edbe8` |
| 14/11 | Impedir mídia repetida e limitar a um envio por conversa | PR #71 | sim | `9f60d39a` |
| 14/11 | Corrigir ficha ZapSign, contrato manual e envios duplicados | PR #70 | sim | `0fc1440c` |
| 13/11 | ZapSign: endereço e CPF da ficha confirmada | PR #69 | não | `d99c25dd` |
| 12/11 | ZapSign: destravar modelos compostos e a confirmação da ficha pelo agente | PR #68 | sim | `abafa32f` |
| 11/11 | Reconhecer ganhos históricos quando uma etapa passa a promover para Cliente | PR #67 | não | `738a36f9` |
| 10/11 | Nomes dos participantes e edição do grupo pelo chat | PR #66 | não | `b9b2a6df` |
| 10/11 | Recuperar o envelope da ZapSign, confirmar a ficha e avisar sobre análise humana | PR #65 | sim | `1d1d7098` |
| 10/11 | Corrigir a seleção de modelos PDF na ZapSign | PR #64 | não | `e053039f` |
| 10/11 | Recuperar áudios sem transcrição e preparar a mídia pedida no follow-up | PR #63 | sim | `4f1e5944` |
| 09/11 | Usar os dados confirmados de quem assina e bloquear comandos internos da IA | PR #62 | não | `59c7ce1b` |
| 09/11 | Corrigir a prévia de voz e agrupar os controles de áudio do agente | PR #60 | não | `efdb0d13` |
| 09/11 | Escolher e ouvir a voz de cada agente antes de salvar | PR #58 | não | `12b179b4` |
| 09/11 | Respostas em áudio no agente de WhatsApp | PR #57 | não | `acc4abc4` |
| 09/11 | Ficha sem e-mail e aceite unificado do contrato da ZapSign | PR #56 | não | `b59d61a5` |
| 06/11 | Modelo completo da ZapSign para uma única assinatura | PR #55 | não | `4d897057` |
| 06/11 | Agente cria contratos ZapSign e acompanha a assinatura do cliente | PR #54 | sim | `fc67b1ff` |
| 06/11 | Origem e UTMs de anúncios de clique para WhatsApp no lead | PR #53 | sim | `686411d0` |
| 06/11 | IA preenche o contrato da ZapSign pela conversa e pelas ligações | Claude Code | não | `cb1e5448` |
| 06/11 | Retorno combinado na aba Atendimento e automações | PR #52 | não | `32a44695` |
| 05/11 | Agendar retorno combinado por robô | PR #51 | sim | `a3ebf706` |
| 05/11 | ZapSign: registrar e identificar falhas da conexão | PR #50 | não | `e6438aa9` |
| 05/11 | Horários de follow-up e agente por inatividade da etapa | PR #49 | sim | `b561cfe9` |
| 05/11 | ZapSign: configuração só para o Administrador Mestre | PR #48 | não | `2193874e` |
| 05/11 | Telefonia: confirmar o número antes de ligar e ligar para outro número | Claude Code | não | `d7016204` |
| 04/11 | Telefonia API4com: ligar pelo CRM com telefone embutido | Claude Code | sim | `12f27bf7` |
| 03/11 | IA: figurinha animada pausava a conversa "por consumo" | Claude Code | não | `6dfa9a99` |
| 03/11 | IA: conversa pausava "por consumo" antes do teto | Claude Code | não | `4868f2dd` |
| 03/11 | IA: áudio transcrito pausava a conversa "por consumo" | Claude Code | não | `bd7cae5e` |

## Antes de novembro de 2026

Não foi registrado publicação por publicação. O histórico completo está no Git (`git log --first-parent main`), com 825 commits na `main` de dezembro de 2025 a outubro de 2026. Os marcos principais:

| Quando | Marco |
|---|---|
| 30/10/2026 | Integração ZapSign (contratos). Ponto de retorno `prod-pre-zapsign`, desfazer em [docs/zapsign-rollback.sql](docs/zapsign-rollback.sql) |
| 17/09/2026 | Reforma dos robôs e agentes (execução, ações de lead, construtor) |
| 15 e 16/09/2026 | Super admin altera senha de usuário; número único por conexão; correção da sessão "zumbi" da Evolution |
| 01/09/2026 | Etiquetas no chat; permissões de visualização por vendedor; ações e variáveis dos agentes |
| 31/08/2026 | Nova lista de boards; coexistência do WhatsApp com o aplicativo; automações fora da beta |
| 27 e 28/08/2026 | Responder e encaminhar no chat; grupos do WhatsApp; membresia dos super admins |
| 25 a 27/08/2026 | Agentes de IA e Robôs no WhatsApp (beta) |
| 19/08/2026 | Distribuição automática de leads |
