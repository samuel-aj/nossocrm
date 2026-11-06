# ZapSign: contratos com conferência antes do envio

## Criar pelo agente de WhatsApp (ajuste local de 06/11/2026)

O recurso fica **desativado** até o escritório escolher um modelo para aquele agente. Ele não altera a conexão da ZapSign; o acesso à configuração da integração continua reservado ao Mestre/superadministrador.

1. Abra **Configurações → IA e Automações → Agentes de IA**, edite o agente e acesse **Ações e recursos → Recursos → Modelo de contrato da ZapSign**.
2. Escolha um modelo ativo da conta do escritório. Em **Configurar campos do modelo**, associe cada variável a um dado do CRM (inclusive um campo personalizado) ou a um texto fixo do escritório. Salve o agente.
3. No atendimento, a IA pede os dados pessoais que faltarem, apresenta o resumo e pede a confirmação. Uma resposta como “sim” ou “pode criar”, diretamente a esse resumo, autoriza a criação. Se os termos ou o modelo mudarem, apresenta outro resumo. Valores e condições comerciais vêm do cadastro ou do mapeamento do escritório. O atendimento precisa estar ativo e a conversa vinculada ao lead certo.
4. Depois da criação, o documento aparece em **Lead → Contrato**, aguardando assinatura. O link fica ali: criar não envia convite e não marca como assinado. Quando já existe uma conferência humana pendente para o mesmo modelo, o agente aponta para a aba Contrato. Um timeout não gera outra tentativa automática; o webhook autenticado pode recuperar a referência se a ZapSign informar o ID externo.

**Roteiro sugerido para o campo de instruções do agente:** “Quando o cliente quiser contratar, prepare o contrato do modelo do escritório. Peça só os dados que faltam e apresente o resumo para confirmação. Se faltar uma condição comercial, encaminhe à equipe. Após o aceite, crie o contrato e informe apenas o resultado confirmado. Não envie o link.”

**Homologação:** use **Testar** no editor. O painel pode ler o modelo escolhido, mas usa um lead fictício e simula a criação sem gravar assinatura nem enviar mensagem. Para conferir a configuração de um escritório específico, teste ali com os nomes reais das variáveis e dados fictícios.

Estado em 28/10/2026: branch `feat/zapsign` e preview `staging`. Não está em produção.

## O que a pessoa vê

- **Aba Contrato** na tela do lead, ao lado de Mensagem, Nota interna e Atividade. Só aparece quando a organização tem a ZapSign conectada (Configurações > Integrações > ZapSign). Versão enxuta (pedido do Samuel em 29/10): documento mais recente ou contrato aguardando conferência numa faixa, signatário numa linha, a seção "Envio e assinatura" aberta (como recebe o link, autenticação, CPF, mensagem do WhatsApp, nome do documento; "Ocultar" deixa só o resumo), o modelo por último e o cartão "O que vai no contrato" que abre o modal "Preencher o contrato" com o valor de cada variável (editável, com a origem no CRM ao lado). O botão de envio fica fixo embaixo.
- **Mensagem do WhatsApp** (aba Contrato, modal de conferência e janela da etapa): botões "+ Primeiro nome", "+ Nome completo", "+ Nome do documento", "+ Link de assinatura" e "+ Título do lead" inserem a variável no ponto do cursor, e uma prévia logo abaixo mostra como o cliente vai receber (com os dados do lead; na etapa, com um exemplo). Sem `{{link}}` no texto, o servidor põe o link numa linha ao final (`ensureSignLink` em `lib/zapsign/message.ts`), e a prévia avisa. Variável que o CRM não conhece aparece marcada em âmbar e vai em branco.
- **Conferência ao mudar de etapa**. Mover um lead (Kanban, lista, tela do lead, chat) para uma etapa com "Contrato ao entrar" abre o modal "Conferir contrato antes de enviar". Botões: Cancelar (o lead não sai do lugar), Mover sem enviar (o contrato fica aguardando na aba Contrato) e Mover e enviar contrato. Se a etapa já teve um contrato para aquele lead, o modal avisa e a opção principal passa a ser mover sem enviar de novo.
- Campos em branco ficam marcados em âmbar; para enviar assim mesmo é preciso marcar a confirmação. Contato sem nome bloqueia; WhatsApp do CRM sem conversa avisa que o link vai ficar só no lead.

## Como funciona por dentro

1. O gatilho `crm_internal.signature_on_deal_change` (migração `20261028150000_zapsign_review_before_send.sql`) deixou de enfileirar o envio. Ao entrar numa etapa com regra ligada, ele só insere em `deal_signatures` com `status = 'review'` e grava um evento `signature/review` no histórico. Não chama o tick.
2. Pela tela, `useMoveDeal` consulta `GET /api/integrations/zapsign/status` (conectada + etapas com regra) e, antes de mover, pede a conferência ao `SignatureReviewProvider` (mesmo padrão do modal de campos obrigatórios). Ao confirmar: move o lead (o gatilho prepara a linha) e chama `POST /api/integrations/zapsign/send` com `rule_stage_id`; o servidor aproveita a linha em `review` (origem continua `rule`), grava o pedido conferido em `request` e cria o documento na ZapSign na hora.
3. Quando a etapa também tem campos obrigatórios, o modal de pendências vem primeiro (ele faz o movimento) e a conferência do contrato abre em seguida com o lead já na etapa; "Deixar para depois" mantém o contrato aguardando na aba Contrato.
4. Movimentos por API, robô, automação ou webhook não têm quem conferir: o contrato fica em `review` na aba Contrato do lead até alguém enviar ou descartar (`PATCH /api/integrations/zapsign/deal/[dealId]` com `action: 'discard'`). Linha descartada vira `cancelled` e não impede uma nova preparação se o lead entrar de novo na etapa.
5. `sendSignature` usa `request` quando existe (conferência humana) e só cai na regra da etapa quando não existe (fila antiga). Com conferência humana, não cancela por o lead ter mudado de etapa ou ganho.

## Arquivos

- Servidor: `lib/zapsign/signatures.ts` (`createManualSignature` com `ruleStageId`, `discardSignature`), rotas `send` (GET com `stage_id`, `existing`, `review`, `whatsapp`; POST com `rule_stage_id`), `deal/[dealId]` (GET com `stage_id`; PATCH descartar), `status` (nova), `stage-rules` (estatística `review`).
- Tela: `features/zapsign/useSignatureDraft.ts` (estado do envio), `SignatureFields.tsx` (campos), `SignatureReviewProvider.tsx` + `SignatureReviewContext.ts` (modal ao mover), `signatureTypes.ts`; `features/deals/lead/ContractComposer.tsx` (aba Contrato, ligada em `useLeadConversation` e `DealWhatsAppChat`); `lib/query/hooks/useMoveDeal.ts` (interceptação).
- Testes: `lib/zapsign/signatures.test.ts` (15) e o roteiro PGlite do gatilho (scratchpad, 11 verificações).
- Verificação visual (28/10/2026): os componentes reais (aba Contrato, modal de conferência, configuração da etapa e os modais de preenchimento) foram percorridos com Playwright num harness local com a API simulada nos formatos reais, em claro e escuro, desktop e 430 px: 36 prints, 6 fluxos, sem erro de console. Ajustes feitos a partir dos prints: botão de envio sempre visível fora da área rolável, dica de campos em branco no rodapé, resultado do envio levado ao topo, erro do movimento no rodapé do modal, grupo da origem no modal da etapa.

## Para produção

Aplicar `20261027150000_zapsign_integration.sql` e `20261028150000_zapsign_review_before_send.sql` no banco de produção, fazer o merge de `feat/zapsign` em `main` e conectar a conta ZapSign real (plano com API) em Configurações > Integrações.

## Produção (30/10/2026)

- Publicado em produção com a ZapSign **desconectada em todas as organizações**: as tabelas existem, mas `zapsign_settings` está vazia. Enquanto uma organização não conecta, nada de contrato aparece para ela: nem a aba Contrato no lead, nem o card "Contrato ao entrar" no Automatizar, nem a seção na janela da etapa, e o trigger em `deals` sai no primeiro `IF` (sem regra na etapa, nada acontece).
- **Quem conectava nessa publicação**: somente o **super admin** via a aba ZapSign e podia conectar/desconectar. Ver alteração de acesso abaixo.
- **Voltar atrás**: código pela tag `prod-pre-zapsign` (Vercel > Deployments > Instant Rollback, ou `git revert -m 1` do merge); banco com `docs/zapsign-rollback.sql` (o passo 1, só o trigger, já desliga a integração sem perder nada).

## Configuração pelo Administrador Mestre (05/11/2026 — alteração local)

- Aba ZapSign e GET/PUT/DELETE de settings autorizam o Administrador Mestre da organização da sessão, identificado por `masterUserId` nas permissões de equipe. O acesso do superadministrador é preservado.
- Administradores comuns e vendedores não recebem acesso à configuração da integração. A API verifica a permissão a cada chamada; falha na consulta bloqueia, sem ler token ou chamar a ZapSign.
- O Mestre é definido em Configurações > Equipe pelo superadministrador. Não se deve promover um usuário a superadministrador para conectar a ZapSign.
- Sem migração ou mudança de cargos. Uso operacional dos contratos no lead permanece igual. Testes de autorização usam banco e provedor simulados.

## IA preenche o contrato (05/11/2026, branch `feat/contrato-ia`, preview `staging`)

- **O que faz**: quando o modelo da ZapSign é escolhido (aba Contrato, modal de conferência ao mudar de etapa ou contrato preparado pelo robô), a IA da organização lê o lead, a conversa do WhatsApp, as ligações da API4com e as notas internas e preenche as variáveis sozinha. Nada é enviado sem a pessoa conferir: a regra da conferência continua igual.
- **Na tela**: faixa "A IA preencheu N campos" (com o que ela leu e o botão "Preencher de novo"), marca **IA** em cada campo que ela mudou e, embaixo, a origem com o trecho ("Da conversa: ...", "Da ligação: ..."). "Restaurar" volta ao valor do CRM. O que a pessoa digita ganha da IA (não é trocado ao preencher de novo). O cartão "O que vai no contrato" da aba mostra "N campos preenchidos pela IA". Texto fixo configurado na etapa nunca é trocado.
- **Quando roda**: uma vez por modelo, assim que o modelo e as variáveis chegam; o resultado fica 10 minutos em cache no navegador (`aiFillKey`). "Preencher de novo" ignora o cache.
- **Ligações**: a gravação (`record_url` da API4com, que redireciona para o MP3; HEAD responde 404, por isso GET) é transcrita logo depois do fim da ligação, só em organizações com a ZapSign conectada (webhook, `transcribeAfterHangup`, tenta de novo após 15 s se a gravação ainda não estiver pronta) ou, se ainda faltar, na hora do preenchimento. O texto fica em `api4com_calls.metadata.transcript` e é reaproveitado. Ligações com menos de 8 s são ignoradas.
- **Áudios do cliente** no WhatsApp ainda sem texto (os 4 mais recentes) são transcritos na hora e gravados em `wa_messages.transcription` (o chat passa a mostrar o texto, como faz o agente).
- **Chave de IA**: a do provedor escolhido em Configurações > Central de I.A.; sem ela, a de outro provedor cadastrado; sem nenhuma, a de um agente de IA da organização (`lib/ai/orgModel.ts`). Transcrição: whisper-1 (chave de áudio de um agente ou chave da OpenAI) ou Gemini (chave do Google); a Anthropic não ouve áudio. Sem chave, a faixa explica onde cadastrar. A chave `ai_contract_fill` em `ai_feature_flags` desliga a função por organização (padrão: ligada). Não usa o interruptor geral do assistente (`ai_enabled`).
- **Arquivos**: `lib/zapsign/aiFill.ts` (contexto, pedido ao modelo, junção da resposta), `lib/api4com/transcript.ts`, `lib/ai/orgModel.ts`, rota `POST /api/integrations/zapsign/ai-fill`, `features/zapsign/AiFillBar.tsx`, `useSignatureDraft` (`ai`, `runAi`), `VariableValueRows` (marcas). Testes: `lib/zapsign/aiFill.test.ts`.
- **Sem migração**: usa colunas que já existem (`api4com_calls.metadata`, `wa_messages.transcription`).
- **Staging**: a organização "Anúncio Jurídico" (428e1830-...) foi ligada à conta SANDBOX da ZapSign (cópia da conexão da organização de demonstração, sem webhook próprio: o status de assinatura dela não volta por webhook). Modelo de teste com 18 campos: `Downloads/modelo-contrato-honorarios-ia.docx`.
