# ZapSign: contratos com conferência antes do envio

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
