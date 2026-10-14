# WhatsApp Group Eligibility Implementation Plan

**Goal:** Evitar seleção oculta de outro número e tornar a restrição de grupos compreensível.

**Architecture:** Manter o modal e o fluxo de atualização de cache em ChatsPage. Classificar apenas a recusa conhecida no serviço da Meta; a rota traduz isso para 422 e o formulário exibe o erro junto ao número selecionado.

**Tech Stack:** React, Next.js, TypeScript, Vitest/Testing Library. Execução nesta sessão, sem delegação.

- [x] Testar o erro real da Meta em lib/whatsapp/groups.test.ts, incluindo message/error_data.details e erros distintos. Usar fetch simulado e verificar GROUPS_NOT_ELIGIBLE sem alterar tratamento de outros erros.
- [x] Testar app/api/whatsapp/groups/create/route.test.ts: recusa 422 sem upsert/convite, falha desconhecida 502 e QR sem chamada à Meta.
- [x] Ajustar lib/whatsapp/groups.ts e app/api/whatsapp/groups/create/route.ts para retornar a falha de elegibilidade em português e código estável.
- [x] Ajustar features/chats/ChatsPage.tsx: seleção explícita, número sempre visível, orientação por provedor, erro inline e guardas antes do POST. Preservar fluxo de sucesso e cache existentes.
- [x] Testar features/chats/ChatsPage.groups.test.tsx com conexões fictícias e fetch simulado: seleção por filtro/chat, escolha obrigatória quando ambígua, QR, número oficial único, recusa e troca, sucesso.
- [x] Executar testes focados e os testes existentes de ChatsPage e participantes; verificar lint dos arquivos alterados e typecheck. Executar build para validar integração.
- [x] Revisar diff, registrar resultado e preparar a correção para publicação sem enviar mensagens reais.

## Validação — 2026-10-14

- 42 casos pertinentes aprovados: suíte relacionada com 41 casos e novo caso de conexão desconectada validado na repetição dos 10 casos da UI.
- ESLint dos seis arquivos de código/testes, `npm run typecheck`, `git diff --check` e `npm run build` aprovados.
- Seleção de conexão filtrada que ficou desconectada exige nova escolha, mesmo se restar apenas um número oficial conectado.
- Recusa de elegibilidade preserva o nome digitado e impede repetir a mesma tentativa por clique ou Enter; trocar a conexão limpa a mensagem.
- Nenhuma chamada real de criação de grupo ou envio de mensagens. Sem migração ou modificação de dados de produção.
- Publicação em produção depende de autorização específica para esta correção.
