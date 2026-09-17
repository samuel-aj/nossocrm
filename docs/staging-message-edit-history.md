# Histórico visual de edição — STAGING, 17/09/2026

Base: staging 478ac9b. Aprovação: nome do lead em uma linha com reticências e nome completo no hover; texto original riscado, texto atual abaixo e rótulo "Editada HH:mm" (hora da edição).

- DealCard mantém o título inteiro no cadastro e usa truncate/title na exibição.
- original_body preserva o primeiro texto observado antes da edição por trigger atômico SECURITY INVOKER, em wa_messages com as mesmas permissões/RLS. Não reconstrói edições antigas que já perderam o original.
- A captura vale para edição pelo CRM e updates dos webhooks existentes, incluindo o Meta. Sem mudança no webhook Meta nesta tarefa.
- Evolution: normalização compartilhada de messages.edited, send.message.update e protocolMessage nos envelopes messages.upsert/messages.update. IDs internos da mensagem editada têm prioridade sobre IDs de envelope. Status normais continuam no fluxo existente. Escrita por organização/conexão, compare-and-set e timestamps rejeitam eventos anteriores/repetidos. Falha na gravação retorna 500 em vez de confirmar silenciosamente.
- Endpoint e cache de edição devolvem original_body; bolhas de mensagens recebidas e enviadas exibem o texto original e a hora da edição.
- Demonstração de Chats contém exemplo de mensagem recebida editada.

Migração aplicada SOMENTE em mggvzlmquzqcloprxmoe, Supabase de STAGING. Edge Function whatsapp-webhook atualizada ali de v12 para v13, mantendo autenticação pelo secret do webhook. MAIN e banco/função de produção não alterados. Na promoção futura, aplicar a migração e publicar a função (index.ts + edits.ts) também na produção; o deploy Vercel sozinho não atualiza o receptor.

Validação: testes unitários de envelopes diretos/aninhados, status, idempotência, eventos antigos, escopo de organização/conexão, modal, cache e bolha recebida. Teste transacional com rollback validou preservação do original, datas/status e segunda edição. Teste HTTP na função publicada usou organização/conexão temporárias sem token/encaminhamento e mensagem fictícia: edição aninhada, segunda edição, evento antigo e repetição retornaram 200; banco manteve original "Beleza", texto atual "Beleza Samuel!" e prévia correta. Fixtures removidas; nenhuma mensagem real enviada ou editada. Chromium/WebKit verificaram interface e imagens, desktop/mobile sem overflow. TypeScript e lint dos arquivos da aplicação passaram.
