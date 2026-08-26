-- =============================================================================
-- Webhooks de saída: reconciliação das entregas feitas pelo pg_net.
--
-- Os gatilhos (notify_wa_message, notify_deal_*) gravam a entrega como 'queued'
-- e disparam o POST via net.http_post, mas ninguém marcava o resultado; o cron
-- diário /api/cron/webhook-retry reenviava TODAS as 'queued' (inclusive as que
-- já tinham chegado) e o n8n recebia eventos antigos em dobro (agente respondendo
-- de novo, negócio duplicado). Aqui um job a cada 2 min lê net._http_response e
-- fecha as entregas: 2xx -> 'sent'; erro -> agenda a retentativa (next_retry_at)
-- para o cron do app, que passa a pegar só o que foi agendado ou nunca enviado.
-- Aditivo e idempotente.
--
-- Em produção a migração 20260421100000_webhook_retry_columns.sql não tinha sido
-- aplicada (sem next_retry_at o cron de retentativa falhava em silêncio), então as
-- colunas vêm aqui de novo com IF NOT EXISTS.
-- =============================================================================
ALTER TABLE public.webhook_events_out
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE public.webhook_deliveries
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS response_body TEXT,
  ADD COLUMN IF NOT EXISTS duration_ms INT;
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry
  ON public.webhook_deliveries (next_retry_at)
  WHERE status = 'queued' AND next_retry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_request
  ON public.webhook_deliveries (request_id)
  WHERE status = 'queued';

CREATE OR REPLACE FUNCTION public.wa_webhook_reconcile()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n INTEGER := 0;
BEGIN
  -- Sucesso: entrega fechada
  WITH ok AS (
    UPDATE public.webhook_deliveries d
       SET status = 'sent', response_status = r.status_code, attempted_at = COALESCE(r.created, now())
      FROM net._http_response r
     WHERE d.request_id = r.id AND d.status = 'queued' AND d.next_retry_at IS NULL
       AND r.status_code BETWEEN 200 AND 299
    RETURNING d.id
  )
  SELECT count(*) INTO n FROM ok;

  -- Falha (HTTP >= 300, erro de rede ou timeout): retentativa pelo cron do app em 5 min
  UPDATE public.webhook_deliveries d
     SET response_status = r.status_code,
         error = COALESCE(r.error_msg, 'HTTP ' || r.status_code::text),
         next_retry_at = now() + interval '5 minutes'
    FROM net._http_response r
   WHERE d.request_id = r.id AND d.status = 'queued' AND d.next_retry_at IS NULL
     AND (r.status_code IS NULL OR r.status_code >= 300 OR r.error_msg IS NOT NULL);

  -- Eventos cujas entregas todas fecharam com sucesso
  UPDATE public.webhook_events_out e
     SET status = 'delivered'
   WHERE e.status = 'pending'
     AND EXISTS (SELECT 1 FROM public.webhook_deliveries d WHERE d.event_id = e.id AND d.status = 'sent')
     AND NOT EXISTS (SELECT 1 FROM public.webhook_deliveries d WHERE d.event_id = e.id AND d.status = 'queued');
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_webhook_reconcile() FROM PUBLIC, anon, authenticated;

-- Fecha o que já está na fila hoje sem resposta disponível (pg_net guarda ~6 h): entregas
-- 'queued' antigas com request_id, sem retentativa agendada, não voltam a ser reenviadas.
UPDATE public.webhook_deliveries
   SET status = 'sent', error = COALESCE(error, 'reconciliado: enviado pelo pg_net (resposta expirada)')
 WHERE status = 'queued' AND request_id IS NOT NULL AND next_retry_at IS NULL
   AND attempted_at < now() - interval '6 hours';

DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'wa-webhook-reconcile';
  PERFORM cron.schedule('wa-webhook-reconcile', '*/2 * * * *', $cron$ SELECT public.wa_webhook_reconcile() $cron$);
END $$;
