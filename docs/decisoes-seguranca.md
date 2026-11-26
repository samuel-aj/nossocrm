# Decisões de segurança do NossoCRM

Este documento registra **por que cada regra de segurança existe**: o que ela faz, o motivo, quem aprovou, quando entrou, onde fica no código e o que acontece se alguém tirar.

Serve para duas coisas: entender uma regra antes de mexer nela, e não remover por engano uma proteção que parece sobrar.

- O que mudou em cada publicação está no [CHANGELOG.md](../CHANGELOG.md).
- Como voltar uma versão está em [restauracao.md](restauracao.md).

## Como registrar uma decisão nova

Toda mudança em regra de segurança (acesso a dados, autenticação, cabeçalhos e CORS, segredos, validação de webhook, limites, registro de eventos) entra aqui no mesmo merge que a aplica. Copie o modelo e use o próximo número:

```markdown
### DS-00 · Título curto
- **Regra:** o que passa a valer.
- **Por quê:** o risco ou o problema que motivou.
- **Aprovado por / quando:** quem autorizou e a data em que entrou em produção.
- **Onde fica:** arquivo, migração ou tela de painel.
- **Se remover:** o que volta a ficar exposto ou o que quebra.
```

Regras do registro:

- Decisão revista não é apagada: marque a antiga como **Substituída por DS-xx** e escreva a nova.
- Antes de afrouxar ou tirar uma regra, leia a entrada dela. Se a entrada disser que algo quebra, resolva isso antes.
- Fraquezas ainda não corrigidas **não** entram neste arquivo, porque o repositório é público. Elas ficam em `docs/security/`, pasta que o Git ignora.

## Índice

| Área | Decisões |
|---|---|
| Acesso aos dados no banco | DS-01 a DS-11 |
| Segredos e chaves | DS-12 a DS-17 e DS-34 |
| Autenticação e contas | DS-18 a DS-20 |
| Entrada e saída de rede | DS-21 a DS-27 |
| Registro, operação e publicação | DS-28 a DS-33 |

---

## Acesso aos dados no banco

### DS-01 · Cada conta só enxerga os escritórios de que é membro
- **Regra:** a tabela de escritórios só mostra a cada usuário os escritórios em que ele tem vínculo. Super admin vê todos. Gravar em escritório é só pelo servidor do CRM.
- **Por quê:** a regra antiga deixava qualquer conta logada ler, renomear e desativar todos os escritórios.
- **Aprovado por / quando:** Samuel, que rodou o SQL em produção em 23/11/2026.
- **Onde fica:** migração `20261123100000_seguranca_parte1.sql`, item 4.
- **Se remover:** um vendedor de um escritório volta a ver e alterar os dados cadastrais dos outros.

### DS-02 · Perfil visível só para a própria pessoa e para os colegas de escritório
- **Regra:** nome, e-mail e telefone de um usuário aparecem só para ele e para quem divide um escritório com ele. Super admin vê todos.
- **Por quê:** qualquer conta logada lia os dados de todos os usuários de todos os escritórios.
- **Aprovado por / quando:** Samuel, SQL em produção em 23/11/2026.
- **Onde fica:** migração `20261123100000_seguranca_parte1.sql`, item 5. A regra usa a função `user_org_ids()` dos dois lados da comparação.
- **Se remover:** vaza a lista de usuários. **Não troque `user_org_ids()` por uma subconsulta direta em `user_organizations`:** a regra daquela tabela só mostra o próprio vínculo, e os colegas sumiriam da tela de equipe.

### DS-03 · Tabelas antigas fora do CRM ficam fechadas para o navegador
- **Regra:** as tabelas herdadas de ferramentas anteriores (Lovable, n8n, campanhas) não aceitam leitura nem gravação com a chave pública nem com conta logada. A exceção é `reps_config`, que mantém **só leitura**.
- **Por quê:** estavam liberadas para qualquer um, e algumas sem proteção nenhuma. Nenhuma é usada pelo código do CRM.
- **Aprovado por / quando:** Samuel, SQL em produção em 23/11/2026.
- **Onde fica:** migração `20261123100000_seguranca_parte1.sql`, itens 1 a 3.
- **Se remover:** dados antigos de clientes voltam a ficar acessíveis pela internet. **Não revogue a leitura de `reps_config`:** uma automação do n8n lê essa tabela com a chave pública e pararia.

### DS-04 · Fases do ciclo de vida: todos leem, só super admin altera
- **Regra:** a lista de fases (lead, cliente etc.) é uma só para todos os escritórios. Qualquer usuário lê; só super admin cria, renomeia ou apaga. Na tela, quem não é super admin vê a lista só para consulta.
- **Por quê:** um usuário de um escritório renomeava ou apagava uma fase e mudava para todos.
- **Aprovado por / quando:** Samuel, SQL em 23/11/2026 e tela em 24/11/2026.
- **Onde fica:** migração `20261123100000_seguranca_parte1.sql`, item 7; `features/settings/components/LifecycleSettingsModal.tsx`.
- **Se remover:** um escritório volta a conseguir bagunçar a configuração de todos.

### DS-05 · Quadro e etapa só podem ser criados no próprio escritório
- **Regra:** foi retirada uma regra extra que liberava criar quadro e etapa em qualquer escritório. Fica valendo só a regra por escritório.
- **Por quê:** a regra extra anulava a restrição certa.
- **Aprovado por / quando:** Samuel, SQL em produção em 23/11/2026.
- **Onde fica:** migração `20261123100000_seguranca_parte1.sql`, item 6.
- **Se remover:** nada a remover; a recomendação é nunca recriar uma regra de inserção com condição "sempre verdadeiro".

### DS-06 · Funções internas do banco não são chamáveis de fora
- **Regra:** cinco funções que rodam com poder elevado (`seed_default_board`, `cleanup_rate_limits`, `get_platform_user_stats`, `get_contact_stage_counts`, `wa_increment_unread`) só podem ser executadas pela chave de serviço.
- **Por quê:** a chave pública conseguia chamá-las sem nenhuma conferência de quem chamava.
- **Aprovado por / quando:** Samuel, SQL em produção em 23/11/2026.
- **Onde fica:** migração `20261123100000_seguranca_parte1.sql`, item 8.
- **Se remover:** um anônimo volta a poder executar rotinas internas. Função nova com poder elevado deve nascer sem permissão para `anon` e `authenticated`, a menos que confira quem chama.

### DS-07 · O acesso por escritório segue o vínculo, não o escritório ativo
- **Regra:** as regras do banco decidem o que um usuário vê pelas organizações em que ele tem vínculo (`user_org_ids` e `user_admin_org_ids`). No servidor, o cabeçalho `x-org-id` que cada aba envia é conferido contra esses vínculos antes de valer.
- **Por quê:** uma pessoa pode trabalhar em mais de um escritório, em abas diferentes. As regras antigas olhavam só o escritório ativo do perfil.
- **Aprovado por / quando:** Samuel, que aplicou a migração em produção em 13/08/2026.
- **Onde fica:** funções `user_org_ids` e `user_admin_org_ids` no banco; `lib/supabase/tabOrgScope.ts` (`withTabOrg`).
- **Se remover:** ou o usuário de vários escritórios perde acesso, ou o cabeçalho passa a ser aceito sem conferência e vira porta para ler outro escritório. Rota nova que depende de escritório deve passar por `withTabOrg`.

### DS-08 · Permissão de visualização por vendedor é uma regra restritiva de leitura
- **Regra:** o admin pode limitar o que cada vendedor vê (leads, quadros, números e conversas por responsável) e o que pode fazer (criar, editar, excluir, mover). No banco isso é uma regra restritiva só de leitura, mais gatilhos para as ações. Nas rotas de WhatsApp o filtro é feito em código.
- **Por quê:** pedido dos escritórios para vendedor não ver a carteira dos colegas.
- **Aprovado por / quando:** Samuel, em produção em 01/09/2026 (visualização) e 04/09/2026 (ações).
- **Onde fica:** migrações `20260901220000_user_visibility_rules.sql` e `20260904120000_user_action_permissions.sql`; `lib/permissions/server.ts`.
- **Se remover:** todos os vendedores voltam a ver tudo. Três escolhas são de propósito e não devem ser "corrigidas": a regra só vale para leitura (bloquear inserção quebra o rodízio de leads); se a regra de um usuário estiver ausente ou quebrada, ele vê tudo (uma regra com defeito nunca esconde o CRM de alguém); e a tabela não tem chave estrangeira (evita o defeito que derrubou o login em 19/08/2026).

### DS-09 · Super admin só é membro de um escritório com vínculo explícito
- **Regra:** a equipe da agência (super admin) não aparece como membro, responsável ou participante do rodízio em um escritório, a não ser que alguém a adicione de propósito.
- **Por quê:** super admins apareciam, ou sumiam, em todos os escritórios dos clientes ao mesmo tempo.
- **Aprovado por / quando:** Samuel, em produção em 28/08/2026.
- **Onde fica:** migração `20260828100000_membership_super_admin_role.sql`; tela `/admin`, menu de escritórios por colaborador.
- **Se remover:** a equipe da agência volta a aparecer como responsável possível em escritórios de clientes.

### DS-10 · Foto de perfil: cada um mexe só na própria
- **Regra:** o usuário só envia, troca ou apaga o arquivo `avatars/<id dele>.<extensão>`, com no máximo 2 MB e só imagem.
- **Por quê:** qualquer usuário de qualquer escritório trocava ou apagava a foto de outro, e o espaço aceitava qualquer tipo de arquivo.
- **Aprovado por / quando:** Samuel, SQL em produção em 24/11/2026.
- **Onde fica:** migração `20261123120000_seguranca_parte2.sql`, item C.
- **Se remover:** volta a ser possível apagar foto alheia e usar o espaço para hospedar arquivo qualquer.

### DS-11 · Link de convite pendente só para admin e para quem gerencia a equipe
- **Regra:** os convites pendentes de um escritório, com o link, só aparecem para o admin e para quem tem permissão de gerenciar a equipe.
- **Por quê:** qualquer membro lia o link dos convites, inclusive o de um convite de admin, e podia usá-lo.
- **Aprovado por / quando:** Samuel, SQL em produção em 24/11/2026.
- **Onde fica:** migração `20261123120000_seguranca_parte2.sql`, item B.
- **Se remover:** um vendedor volta a ler o link de um convite de admin, que dá acesso de admin a quem o usar.

---

## Segredos e chaves

### DS-12 · Chave de IA nunca chega ao navegador
- **Regra:** as chaves de IA do escritório e as de cada agente (IA e áudio) não são legíveis pela sessão do usuário. O servidor do CRM lê com a chave de serviço, depois de conferir o escritório, e devolve à tela só uma máscara.
- **Por quê:** qualquer membro, até vendedor, lia a chave em texto puro. Uma sessão roubada levava a chave junto.
- **Aprovado por / quando:** Samuel, código e SQL em produção em 24/11/2026.
- **Onde fica:** migrações `20261123120000_seguranca_parte2.sql` (item A) e `20261124100000_seguranca_chaves_agentes.sql`; rotas `app/api/settings/ai` e de agentes.
- **Se remover:** as chaves voltam a vazar. **Ordem ao voltar atrás:** desfazer o SQL antes de voltar o código (o código antigo lê a chave pelo navegador e quebra com o banco novo). Ver [seguranca-p2-rollback.sql](seguranca-p2-rollback.sql).

### DS-13 · Token da Meta aparece mascarado na tela
- **Regra:** a tela de conexão do WhatsApp recebe bolinhas no lugar do token. Ao salvar sem mexer nesse campo, o servidor mantém o token que já estava guardado.
- **Por quê:** a rota de conexão devolvia o token inteiro para o navegador.
- **Aprovado por / quando:** Samuel, em produção em 24/11/2026.
- **Onde fica:** `app/api/whatsapp/connection/route.ts`.
- **Se remover:** o token volta a trafegar e a aparecer no navegador de quem abre a tela.

### DS-14 · A chave de serviço do Supabase só existe no servidor
- **Regra:** a chave que ignora as regras do banco é usada só em código de servidor. O arquivo que cria esse cliente é marcado como exclusivo de servidor, então a publicação falha se uma tela tentar importá-lo.
- **Por quê:** quem tem essa chave lê e altera o banco inteiro.
- **Aprovado por / quando:** vem do projeto original; mantido na auditoria de 23/11/2026.
- **Onde fica:** `lib/supabase/server.ts` (`import 'server-only'`, `createStaticAdminClient`).
- **Se remover:** a chave pode acabar empacotada no código que vai para o navegador. Toda rota que usa esse cliente precisa conferir antes quem está chamando e de qual escritório.

### DS-15 · Chave da API pública é guardada só como resumo criptográfico
- **Regra:** o banco guarda o prefixo e o SHA-256 da chave. A chave completa aparece uma única vez, na criação.
- **Por quê:** um vazamento do banco não entrega as chaves das integrações.
- **Aprovado por / quando:** vem do projeto original.
- **Onde fica:** tabela `api_keys` (coluna `key_hash`) e função `validate_api_key`, em `20251201000000_schema_init.sql`.
- **Se remover:** as chaves passam a poder ser lidas por quem acessa o banco.

### DS-16 · Rotas internas exigem segredo próprio
- **Regra:** as rotas chamadas pelo próprio banco e pelo agendador (`/api/cron/*`, `/api/wa-agents/ingest` e `/tick`) só respondem com o segredo certo no cabeçalho. O módulo de agentes tem segredo dedicado, comparado em tempo constante.
- **Por quê:** são rotas sem login, que disparam robôs e reenvios.
- **Aprovado por / quando:** entrou com os agentes de IA, em agosto de 2026.
- **Onde fica:** `lib/wa-agents/internalAuth.ts`; variáveis `WA_AGENTS_INTERNAL_SECRET` e `CRON_SECRET` na Vercel.
- **Se remover:** qualquer um na internet consegue disparar os robôs.

### DS-17 · Credencial de uma pessoa não se redefine nem se entrega por pedido no chat
- **Regra:** nenhuma sessão de IA redefine senha, gera acesso ou entrega login de uma pessoa nomeada só porque o chat pediu. Exige confirmação de que quem pede é o dono da conta, e a senha nunca é escrita no chat.
- **Por quê:** em 13/08/2026 um pedido no chat levou à troca da senha da conta principal por alguém que não era o dono, e a senha ficou exposta no histórico.
- **Aprovado por / quando:** Samuel, 13/08/2026.
- **Onde fica:** regra de trabalho das sessões de IA. No CRM, a troca de senha de terceiros é só para super admin (`app/api/superadmin/users/[id]/password/route.ts`) e fica registrada (DS-28).
- **Se remover:** quem tiver acesso à máquina consegue tomar a conta de outra pessoa.

---

## Autenticação e contas

### DS-18 · Cadastro aberto desligado: toda conta nasce pelo servidor
- **Regra:** o Supabase não aceita cadastro vindo da internet. Uma conta só é criada por convite, por um admin do escritório ou por super admin, sempre pelo servidor do CRM.
- **Por quê:** com o cadastro aberto, qualquer pessoa criava uma conta logada e passava a enxergar o que as regras antigas deixavam à mostra.
- **Aprovado por / quando:** Samuel, que desligou no painel de produção em 23/11/2026.
- **Onde fica:** painel do Supabase, Authentication > Sign In / Providers ("Allow new users to sign up" desligado).
- **Se remover:** estranhos voltam a criar conta. Religar não ajuda em nada: o CRM não usa o cadastro do Supabase.

### DS-19 · Senha com 8 caracteres, maiúscula, minúscula e número, e nunca uma senha vazada
- **Regra:** vale para toda senha nova, definida pela própria pessoa ou por um admin. As senhas que já existiam continuam valendo.
- **Por quê:** o CRM aceitava 6 caracteres e a recusa de senha vazada estava desligada.
- **Aprovado por / quando:** Samuel, código e painel em produção em 25/11/2026.
- **Onde fica:** painel do Supabase, Authentication > Sign In / Providers > Email (quem aplica de verdade); `lib/security/passwordPolicy.ts` (espelha a regra nas telas e traduz a recusa).
- **Se remover:** voltam as senhas fracas. Ao mudar a regra no painel, ajuste as constantes de `passwordPolicy.ts`, senão as telas passam a informar a regra errada.

### DS-20 · Instalador desligado em produção
- **Regra:** as rotas que montam um CRM do zero respondem "instalador desligado" quando `INSTALLER_ENABLED=false`.
- **Por quê:** elas criam o primeiro administrador e mexem na configuração do projeto.
- **Aprovado por / quando:** vem do projeto original; conferido na auditoria de 23/11/2026.
- **Onde fica:** `app/api/installer/*`; variável `INSTALLER_ENABLED` na Vercel.
- **Se remover:** quem achar a rota pode tentar refazer a instalação.

---

## Entrada e saída de rede

### DS-21 · Cabeçalhos de segurança em todas as páginas
- **Regra:** o CRM não abre dentro de página de outro site, o navegador não adivinha tipo de arquivo, o endereço de origem não vaza para outros sites e câmera, localização, pagamento e USB ficam bloqueados. O microfone fica liberado só para o próprio CRM.
- **Por quê:** só existia o cabeçalho que força HTTPS.
- **Aprovado por / quando:** Samuel, em produção em 24/11/2026.
- **Onde fica:** `next.config.ts`, função `headers()`.
- **Se remover:** o CRM pode ser embutido em uma página falsa para capturar cliques. O microfone tem de continuar liberado: o chat grava áudio e o telefone embutido usa.

### DS-22 · O CRM não aceita chamadas de outros sites
- **Regra:** as rotas do CRM não liberam CORS. Rotas que alteram dados com base no login conferem ainda se o pedido veio do próprio endereço do CRM (85 rotas em 26/11/2026). Integrações de fora usam a API pública, com chave.
- **Por quê:** o login fica em cookie; sem a conferência, um site malicioso aberto em outra aba poderia agir em nome do usuário.
- **Aprovado por / quando:** a conferência de origem vem do projeto original; revisada na auditoria de 23/11/2026.
- **Onde fica:** `lib/security/sameOrigin.ts` (`isAllowedOrigin`), usada nas rotas que alteram dados.
- **Se remover:** abre caminho para ações forjadas por outro site. Rota nova que altera dados com base no login deve chamar `isAllowedOrigin`.

### DS-23 · Webhook de entrada: sem login, mas com segredo por conexão no endereço
- **Regra:** as funções que recebem mensagens do WhatsApp (Evolution e Meta) são públicas, porque quem chama é o servidor do provedor. O que autoriza a chamada é o segredo de cada conexão, que faz parte do endereço. Essas funções liberam CORS para qualquer origem.
- **Por quê:** o provedor não tem como fazer login. As funções rodam com a chave de serviço, então o segredo é o único portão.
- **Aprovado por / quando:** Samuel, com a integração do WhatsApp, em julho e agosto de 2026.
- **Onde fica:** `supabase/functions/whatsapp-webhook` e `whatsapp-webhook-meta`; `supabase/config.toml` (`verify_jwt = false`).
- **Se remover:** tirar a conferência do segredo deixa qualquer um gravar mensagens falsas. Ligar a exigência de login nessas funções para de receber mensagens.

### DS-24 · Endereço interno é recusado como destino
- **Regra:** onde o usuário informa um endereço para o CRM chamar (webhook de saída, servidor da Evolution, webhook de agente), o CRM recusa `localhost`, rede privada, endereço de metadados da nuvem e IP escrito de forma disfarçada. A mesma recusa existe no banco, na gravação do webhook.
- **Por quê:** sem isso, um usuário apontava o CRM para serviços internos e lia a resposta.
- **Aprovado por / quando:** Samuel, código e SQL em produção em 24/11/2026.
- **Onde fica:** `lib/wa-agents/url.ts` (`isPublicHttpUrl`), `lib/webhooks/outbound.ts`, `app/api/whatsapp/connection/route.ts`; migração `20261123120000_seguranca_parte2.sql`, item D.
- **Se remover:** o CRM pode ser usado para alcançar a rede interna da hospedagem.

### DS-25 · Erro do banco não vai cru para a tela
- **Regra:** erro vindo do banco vira uma frase amigável. O texto técnico fica só no log do servidor.
- **Por quê:** a mensagem original traz nome de tabela, de coluna e às vezes o próprio dado.
- **Aprovado por / quando:** Samuel, em produção em 24/11/2026.
- **Onde fica:** `lib/security/safeError.ts` (`safeErrorMessage`).
- **Se remover:** a estrutura do banco e dados de terceiros passam a aparecer em mensagens de erro. Rota nova deve devolver erro do banco por `safeErrorMessage`.

### DS-26 · Limite de requisições por minuto, contado na memória do servidor
- **Regra:** há teto por minuto na API pública (por chave, e por IP para chave inválida), na IA, no envio de WhatsApp, nos convites e na exportação de contatos. A contagem fica na memória de cada servidor.
- **Por quê:** nenhuma rota tinha limite. A contagem em memória foi escolhida para não gerar nenhuma consulta a mais no banco, que já teve dois incidentes de sobrecarga.
- **Aprovado por / quando:** Samuel, em produção em 25/11/2026.
- **Onde fica:** `lib/security/rateLimit.ts`; valores ajustáveis por variáveis `RATE_LIMIT_*` na Vercel.
- **Se remover:** uma integração em laço volta a poder sobrecarregar o CRM ou gastar a chave de IA de um escritório. As demais rotas com login ficaram sem limite geral de propósito: o CRM consulta o servidor o tempo todo para atualizar o chat, e um teto geral barraria o próprio uso.

### DS-27 · A API pública só mexe em contato e empresa do escritório dono da chave
- **Regra:** quando uma chamada da API pública cita um contato ou uma empresa, o CRM confere se pertencem ao escritório da chave.
- **Por quê:** a API aceitava o identificador de um contato ou de uma empresa sem conferir a que escritório pertencia.
- **Aprovado por / quando:** Samuel, em produção em 24/11/2026.
- **Onde fica:** `lib/public-api/orgRefs.ts`.
- **Se remover:** uma integração de um escritório passa a poder referenciar dados de outro.

---

## Registro, operação e publicação

### DS-28 · Ações sensíveis ficam registradas, e o registro é fechado
- **Regra:** o CRM grava quem fez o quê em mudanças de equipe, chaves de API, IA, WhatsApp, ZapSign, webhooks, exportação de contatos, troca de papel, tentativas com chave inválida e estouro de limite. Só o servidor grava e só super admin lê, pelo painel. O registro nunca guarda segredo, nunca derruba a operação que está registrando e é apagado depois de 180 dias.
- **Por quê:** não havia como saber quem alterou uma configuração sensível nem como perceber abuso.
- **Aprovado por / quando:** Samuel, código em 24/11/2026 e SQL em 25/11/2026.
- **Onde fica:** `lib/security/auditLog.ts`; migração `20261124150000_seguranca_registro_eventos.sql`; painel em `/admin`.
- **Se remover:** some o rastro. Os gatilhos do banco foram feitos para nunca bloquear a gravação original; se um dia bloquearem, o desligamento está em [seguranca-eventos-rollback.sql](seguranca-eventos-rollback.sql).

### DS-29 · O login é registrado pelo próprio CRM
- **Regra:** depois de entrar, a tela avisa o servidor, que grava usuário, escritório, hora e IP. A senha recusada também é gravada, com o e-mail mascarado.
- **Por quê:** o login acontece direto no Supabase, sem passar pelo servidor do CRM, e o Supabase não guarda esse histórico no banco deste projeto.
- **Aprovado por / quando:** Samuel, em produção em 25/11/2026.
- **Onde fica:** `app/api/security/login/route.ts` e `login-failed/route.ts`; chamadas em `app/login/page.tsx`.
- **Se remover:** o painel deixa de mostrar quem entrou. O usuário vem sempre da sessão, nunca do corpo do pedido, para ninguém forjar o login de outro.

### DS-30 · Teste automático não roda contra o banco de produção
- **Regra:** os testes ligados à segurança rodam com configurações isoladas, sem banco real. O ambiente de teste da Vercel usa um banco separado do de produção.
- **Por quê:** a configuração padrão de testes carrega o ambiente local e apaga dados de teste no banco para onde ele aponta.
- **Aprovado por / quando:** prática das sessões de IA; a data de início não foi registrada.
- **Onde fica:** `vitest.security.config.ts` e os outros `vitest.*.config.ts`; projeto Supabase de staging nas variáveis de Preview da Vercel.
- **Se remover:** um teste pode apagar ou criar dados reais.

### DS-31 · SQL em produção é rodado pelo dono, não pela IA
- **Regra:** toda mudança de estrutura no banco de produção é entregue como SQL, testada antes fora de produção, e quem roda é o Samuel no editor do Supabase. Cada SQL sai acompanhado do seu arquivo de desfazer.
- **Por quê:** uma mudança de estrutura errada afeta todos os escritórios de uma vez.
- **Aprovado por / quando:** prática desde 13/08/2026.
- **Onde fica:** `supabase/migrations/` e os arquivos `docs/*-rollback.sql`.
- **Se remover:** perde-se a conferência humana no passo mais difícil de desfazer.

### DS-32 · Publicar exige autorização, ponto de retorno e registro
- **Regra:** nada vai para a `main` sem o ok explícito do dono. Antes de publicar, marca-se a versão que está no ar. Toda publicação é registrada no changelog. A `main` não aceita reescrita forçada nem exclusão.
- **Por quê:** o CRM está em uso por dezenas de escritórios e mais de uma sessão publica ao mesmo tempo.
- **Aprovado por / quando:** Samuel, 25 e 26/11/2026.
- **Onde fica:** `AGENTS.md`; `scripts/checkpoint.mjs`; `.github/workflows/changelog.yml`; regra "Proteger main" nos Rulesets do GitHub.
- **Se remover:** um comando errado pode apagar o histórico e, com ele, os pontos de retorno.

### DS-33 · Dependências atualizadas quando há falha conhecida
- **Regra:** as bibliotecas com falha crítica conhecida foram atualizadas, e a conferência (`npm audit`) faz parte da revisão de segurança.
- **Por quê:** havia falhas críticas em bibliotecas usadas em produção.
- **Aprovado por / quando:** Samuel, em produção em 24/11/2026.
- **Onde fica:** `package.json`.
- **Se remover:** voltar uma dessas bibliotecas para a versão antiga reabre a falha corrigida.

### DS-34 · Chaves do squad por escritório e histórico dos roteiros
- **Regra:** cada chave do squad pertence a um escritório e recebe um perfil de leitura ou leitura e revisão de roteiro. A lista pública de ferramentas e a execução respeitam o mesmo perfil. Mensagens, roteiros e versões só ficam disponíveis para agentes que um administrador habilitou. Cada revisão guarda o texto anterior e identifica a pessoa ou a chave. A referência de aprovação externa acompanha as alterações do squad.
- **Por quê:** o monitor precisa consultar atendimentos. Apenas o perfil que revisa o roteiro precisa gravar uma versão. O isolamento por escritório, a máscara de telefone e a ausência de anexos reduzem os dados compartilhados.
- **Solicitado por / quando:** implementação solicitada por Samuel em 26/11/2026.
- **Onde fica:** autenticação da API pública, registro de ferramentas em `app/api/mcp`, ferramentas em `lib/mcp/aiAgents` e histórico protegido no Postgres.
- **Se remover:** integrações podem receber acesso além do autorizado e alterações concorrentes de roteiro podem sobrescrever a revisão anterior.
