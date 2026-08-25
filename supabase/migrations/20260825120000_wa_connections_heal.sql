-- Webhook da Meta: cura periódica compartilhada + espelho para outro sistema.
--   forward_webhook_url  : URL de outro sistema que também recebe os webhooks
--                          brutos da Meta deste número (assinados com o app secret)
--   last_webhook_heal_at : trava compartilhada entre instâncias da edge function
--                          (só uma cura a cada 10 min por conexão; evita #80008)
--   token_renewed_at     : última renovação do token do Cadastro Embutido (1x/dia)
ALTER TABLE public.wa_connections ADD COLUMN IF NOT EXISTS forward_webhook_url TEXT;
ALTER TABLE public.wa_connections ADD COLUMN IF NOT EXISTS last_webhook_heal_at TIMESTAMPTZ;
ALTER TABLE public.wa_connections ADD COLUMN IF NOT EXISTS token_renewed_at TIMESTAMPTZ;

-- Trava atômica da cura (chamada pela edge function via RPC com service role).
CREATE OR REPLACE FUNCTION public.wa_claim_heal(p_connection_id uuid, p_ttl_seconds int DEFAULT 600)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH u AS (
    UPDATE public.wa_connections
       SET last_webhook_heal_at = now()
     WHERE id = p_connection_id
       AND (last_webhook_heal_at IS NULL OR last_webhook_heal_at < now() - make_interval(secs => p_ttl_seconds))
    RETURNING id
  )
  SELECT EXISTS (SELECT 1 FROM u);
$$;
REVOKE ALL ON FUNCTION public.wa_claim_heal(uuid, int) FROM PUBLIC, anon, authenticated;
