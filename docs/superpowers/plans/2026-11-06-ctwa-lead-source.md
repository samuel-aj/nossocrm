# Origem CTWA no lead

O primeiro vínculo válido de uma conversa com um lead recebe a referência paga fornecida pela API oficial ou pelo QR. Se a origem do lead está vazia, o CRM grava **Meta Ads**. Origens nativas ou legadas já preenchidas têm prioridade. O histórico do campo também protege a remoção explícita de uma origem anterior.

1. Normalizar apenas o contexto da mensagem direta recebida. Uma publicação orgânica, um anúncio citado ou encaminhado, um eco e um grupo ficam fora. Na integração QR, os campos dependem do que o provedor efetivamente entregar.
2. Guardar o ID da mensagem e os dados disponíveis do anúncio e do clique na conversa. Se ainda falta o lead, aguardar o vínculo explícito feito pelo CRM. A primeira associação consome a referência, inclusive se o lead já tem origem. Uma troca de lead ou uma reentrega não reaproveita o clique.
3. Testar o recebimento e a reentrega nas duas funções com transporte bloqueado, a normalização no Vitest e a migração em PostgreSQL local. A evidência fica em `supabase/functions/_shared/ctwa.test.ts`, `test/verify-ctwa-webhooks.mjs` e `test/verify-ctwa-source.mjs`.

Para publicar, aplicar primeiro a migração `20261106153000_ctwa_lead_source.sql` no banco do CRM. Em seguida publicar **whatsapp-webhook-meta** e **whatsapp-webhook** com o novo módulo compartilhado. A migração atua sobre novas referências. A impressão do relatório na entrada do funil continua usando o histórico na data da entrada.
