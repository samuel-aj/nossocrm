# Como voltar a uma versão anterior

O CRM tem três partes que mudam separadas. Cada uma tem o seu ponto de restauração e o seu jeito de voltar.

| Parte | Ponto de restauração | Como volta | O que se perde |
|---|---|---|---|
| Código (telas e servidor) | Cada publicação fica guardada na Vercel. As versões importantes têm etiqueta `prod-pre-*` no GitHub. | Instant Rollback na Vercel, em segundos | Nada |
| Estrutura do banco (SQL rodado junto com uma versão) | Arquivo de desfazer em `docs/*-rollback.sql` | Rodar o arquivo no SQL Editor do Supabase | Nada, salvo o que o arquivo avisar |
| Dados do banco | Backup automático do Supabase (diário, últimos 7 dias) | Restaurar pelo painel. O CRM fica fora do ar durante a restauração | Tudo o que entrou depois do backup escolhido |

O que **não** tem ponto de restauração está na seção 5.

## 1. Antes de publicar: marcar a versão atual

Toda publicação em produção começa marcando a versão que está no ar:

```bash
npm run checkpoint -- nome-curto      # cria e envia a etiqueta prod-pre-nome-curto
npm run checkpoint -- --list          # lista os pontos existentes
```

A etiqueta aponta para o commit que está em produção naquele momento. Se a publicação nova der problema, é para ela que se volta.

Toda publicação também ganha a sua entrada no [CHANGELOG.md](../CHANGELOG.md), com o nome da etiqueta criada aqui.

Se a publicação inclui SQL, ela vai acompanhada de um arquivo `docs/<assunto>-rollback.sql`. O cabeçalho do arquivo diz quando usar e se o SQL roda antes ou depois de voltar o código. Acrescente a linha na tabela da seção 4.

## 2. Voltar o código

### Caminho rápido: Instant Rollback na Vercel

Não reconstrói nada, só aponta o domínio para uma publicação que já existe.

1. Painel da Vercel, projeto `nossocrm`, aba **Deployments**.
2. Filtre por `main`, ache a publicação desejada (o commit aparece na linha; compare com `npm run checkpoint -- --list`).
3. Menu **⋮** da linha, **Instant Rollback**, confirmar.

Três avisos:

- **Depois de um rollback a Vercel para de publicar sozinha.** Pushes novos na `main` não vão ao ar até alguém promover uma publicação (botão **Manage** no bloco de produção, ou **Promote** em uma publicação). Enquanto isso, quem publicar vai achar que subiu e não subiu.
- **No plano Hobby só dá para voltar à publicação imediatamente anterior.** Para voltar mais longe, use o caminho abaixo. No plano Pro qualquer publicação que já foi produção serve.
- A versão antiga usa as variáveis de ambiente de quando foi construída.

### Caminho pelo Git: desfazer o commit

Serve em qualquer plano e deixa a `main` coerente com o que está no ar. Leva o tempo de uma publicação normal (cerca de um minuto).

```bash
git fetch origin && git checkout main && git merge --ff-only origin/main
git revert -m 1 <commit-do-merge-problemático>   # ou: git revert <commit>
git push origin main
```

Nunca use `git push --force` na `main` nem apague etiquetas `prod-pre-*`: são elas que guardam o caminho de volta.

### Se a versão tinha SQL junto

Leia o cabeçalho do arquivo de desfazer antes. Em alguns casos o código antigo funciona com o banco novo e basta voltar o código. Em outros o SQL tem de ser desfeito primeiro, senão o código antigo quebra.

## 3. Voltar os dados do banco

É o último recurso. Restaurar um backup devolve o banco inteiro ao estado daquele momento: **tudo o que os escritórios fizeram depois se perde** (leads, mensagens, contratos), e o CRM fica fora do ar enquanto a restauração roda.

Antes de restaurar, veja se o problema se resolve corrigindo só o dado errado por SQL.

- Painel: Supabase, projeto de produção, **Database > Backups**.
  https://supabase.com/dashboard/project/pldknngsszuxiuweivdz/database/backups/scheduled
- Plano Pro: um backup por dia, guardados por 7 dias. O pior caso é perder quase um dia de dados.
- Recuperação por horário exato (Point in Time Recovery) é um adicional pago. Com ele a perda máxima cai para cerca de dois minutos.
- Para conferir um dado antigo sem mexer em produção, existe a opção de restaurar o backup em um projeto novo e consultar lá.
- Apagar o projeto no Supabase apaga também os backups. Não tem volta.

A restauração não traz de volta arquivos apagados do Storage (seção 5).

## 4. Pontos marcados e seus arquivos de desfazer

| Etiqueta | O que entrou depois dela | SQL de desfazer |
|---|---|---|
| `prod-pre-zapsign` | Integração ZapSign | `docs/zapsign-rollback.sql` |
| `prod-pre-seguranca-p2` | Segurança parte 2 | `docs/seguranca-p2-rollback.sql` |
| `prod-pre-seg-eventos` | Registro de eventos de segurança | `docs/seguranca-eventos-rollback.sql` |
| `prod-pre-seg-login` | Registro de login no painel de segurança | Não tem SQL |
| `prod-pre-api-limites` | Limite de requisições nas APIs | Não tem SQL |
| `prod-pre-senha-forte` | Regra de senha forte | Não tem SQL (a regra do painel do Supabase se desliga em Authentication > Sign In / Providers > Email) |
| `prod-pre-restauracao` | Este guia e o comando `npm run checkpoint` | Não tem SQL |
| `prod-pre-changelog` | Registro de alterações (`CHANGELOG.md`) e a conferência automática | Não tem SQL |
| `prod-pre-decisoes-seg` | Registro das decisões de segurança (`docs/decisoes-seguranca.md`) | Não tem SQL |
| `prod-pre-frase-retorno` | Confirmação do retorno combinado em linguagem natural | Não tem SQL |

## 5. O que não tem ponto de restauração

| O quê | Situação | O que fazer |
|---|---|---|
| Arquivos do Storage (mídia do WhatsApp, anexos de lead, arquivos dos agentes) | O backup do banco guarda só a lista dos arquivos, não os arquivos. Arquivo apagado não volta. | Não apagar buckets nem limpar arquivos em massa sem cópia antes. |
| Funções do Supabase `whatsapp-webhook` e `whatsapp-webhook-meta` | O Supabase só guarda a versão atual. A cópia de segurança é o código em `supabase/functions/`. | Republicar a partir do commit desejado: `supabase functions deploy <nome> --project-ref pldknngsszuxiuweivdz`. |
| Variáveis de ambiente da Vercel e segredos das funções | Não ficam no Git. | Anotar o valor antigo antes de trocar. |
| Configurações de painel (autenticação do Supabase, domínios, n8n, Evolution) | Não ficam no Git. | Registrar a mudança no arquivo de desfazer ou na descrição do commit. |

## 6. Conferir se a restauração funciona

- **Código:** as publicações marcadas continuam respondendo nos seus endereços próprios na Vercel. Dá para abrir uma versão antiga sem mexer em produção: em **Deployments**, clique na publicação e depois em **Visit**.
- **Banco:** um backup só é confiável depois de restaurado ao menos uma vez. O teste seguro é restaurar em um projeto novo, conferir os dados e apagar o projeto de teste.
