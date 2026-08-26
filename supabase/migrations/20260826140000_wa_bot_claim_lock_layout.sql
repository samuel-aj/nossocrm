-- =============================================================================
-- Robôs (beta):
-- 1) Trava da execução via RPC. O PATCH do PostgREST com filtro `or`
--    (lock_until.is.null,lock_until.lt.<data>) dá 42703 neste banco (mesmo caso
--    da cura do webhook, wa_claim_heal), então a trava nunca era obtida e a
--    execução ficava "running" sem rodar. UPDATE ... atômico numa função SQL.
-- 2) Coluna `layout` (jsonb) para o quadro do robô: balões (grupos) com vários
--    blocos empilhados, posição e nome. Os passos continuam planos em `steps`
--    (o motor não muda); o layout é só desenho.
-- Tudo aditivo e idempotente.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.wa_bot_claim_lock(p_org UUID, p_run UUID, p_seconds INTEGER DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n INTEGER; secs INTEGER := LEAST(GREATEST(COALESCE(p_seconds, 120), 1), 900);
BEGIN
  UPDATE public.wa_bot_runs
    SET lock_until = now() + make_interval(secs => secs)
  WHERE id = p_run AND organization_id = p_org
    AND (lock_until IS NULL OR lock_until < now());
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;
REVOKE ALL ON FUNCTION public.wa_bot_claim_lock(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wa_bot_claim_lock(uuid, uuid, integer) TO service_role;

ALTER TABLE public.wa_bots
  ADD COLUMN IF NOT EXISTS layout JSONB NOT NULL DEFAULT '{}'::jsonb;
COMMENT ON COLUMN public.wa_bots.layout IS 'desenho do quadro: { groups: [{ id, name, x, y, step_ids: [...] }] }; os passos continuam em steps';
