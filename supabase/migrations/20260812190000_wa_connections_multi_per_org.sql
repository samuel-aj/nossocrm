-- Múltiplos números de WhatsApp por organização: remove a trava de 1 conexão
-- por org. instance_name segue globalmente único (chave dos upserts/webhooks).
ALTER TABLE public.wa_connections DROP CONSTRAINT IF EXISTS uq_wa_connections_org;
