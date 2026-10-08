# Correção dos erros de envio — 08/10/2026

## Diagnóstico

- O envio pelo número Meta final 8956 às 09:15 (Manaus) foi recusado com código 131047: passaram mais de 24 horas desde a última mensagem recebida do contato naquele número. A interface já calculava a janela por remetente, mas a API não fazia essa validação.
- O envio pelo número QR/Evolution final 6666 recebeu status de falha sem motivo armazenado. O webhook anterior ignorava os campos de erro. A causa histórica exata não pôde ser recuperada. Houve novos envios e entregas confirmadas depois, sem intervenção.
- O webhook permitia que falhas atrasadas sobrescrevessem uma entrega e não recuperava mensagens marcadas como falha após confirmação posterior.

## Correção pronta

- Validação no servidor antes de enviar ou encaminhar mensagens comuns pela Meta, por organização, conexão e variantes do telefone. Modelos continuam disponíveis fora da janela; envios QR não recebem essa restrição.
- Preservação dos detalhes de falha disponibilizados pela Evolution, com limite de tamanho e seleção de campos, exibidos no aviso da mensagem.
- Confirmações de entrega/leitura posteriores recuperam mensagens com erro. Eventos de falha não rebaixam mensagens já entregues/lidas.
- Atualizações de status limitadas à organização e conexão corretas; falha de gravação gera resposta HTTP 500.

## Validação

- 43 testes específicos aprovados em oito arquivos.
- TypeScript aprovado; lint dos arquivos alterados aprovado.
- Build Next.js com webpack aprovado, sem credenciais de produção no ambiente local. Não equivale a teste autenticado ponta a ponta.
- Suíte geral após integrar os ajustes de contatos do main: 1.230 testes aprovados, 12 falhas e cinco ignorados. As mesmas 12 falhas foram reproduzidas no commit original de produção em clone separado, nos testes de cache, middleware e telas de negócios.
- Lint geral: um aviso anterior de `no-img-element` em `components/navigation/NavigationRail.tsx`; zero erros. O aviso impede a regra global de zero warnings.
- Nenhuma mensagem real enviada para teste.

## Publicação autorizada

Base integrada: `e6d19c8965cd085b42f5192a1d9f57ef4a228911`; branch `codex/whatsapp-send-errors`. Inclui os ajustes de criação de lead no chat e troca de contato da PR26.

Publicação do aplicativo Vercel e da função Supabase `whatsapp-webhook` autorizada explicitamente pelo usuário em 08/10/2026. Não há alteração de esquema. A revisão independente não encontrou bloqueios; a comparação da função remota versão 28 confirmou os cinco arquivos idênticos byte a byte à base original e ao main integrado, sem mudanças externas a sobrescrever. Autenticação do webhook por segredo preservada, com `verify_jwt=false` como já configurado em produção.

Rollback do webhook: os cinco arquivos anteriores podem ser reconstruídos do commit `4ad2be58ed29a3825d6bfe61f039c9392f0e96df`; hash SHA-256 do bundle live v28 `ca9768d42212c2eef6473508582642c30db55fc767a2065d7ac2b2372dae39b6`. O deploy acrescenta `statuses.ts` e mantém todas as dependências relativas existentes.

A correção previne envios comuns inválidos pela janela conhecida e evita estados de erro incorretos. Não elimina indisponibilidade do provedor nem remove a regra de 24 horas da Meta.
