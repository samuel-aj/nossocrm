-- The existing robot queue is durable; the batch id makes retries idempotent.
ALTER TABLE public.wa_bot_runs ADD COLUMN IF NOT EXISTS bulk_batch_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS wa_bot_runs_bulk_recipient
 ON public.wa_bot_runs(organization_id, bulk_batch_id, phone) WHERE bulk_batch_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.enqueue_bulk_bot_runs(p_org uuid, p_bot uuid, p_batch uuid, p_targets jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE t jsonb; existing public.wa_bot_runs; rid uuid; results jsonb := '[]';
BEGIN
 IF p_batch IS NULL OR jsonb_typeof(p_targets) IS DISTINCT FROM 'array' OR jsonb_array_length(p_targets)>500 THEN
  RAISE EXCEPTION 'Lote inválido';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.wa_bots WHERE id=p_bot AND organization_id=p_org AND enabled) THEN
  RAISE EXCEPTION 'Robô não está ativo';
 END IF;
 -- Stable lock order prevents deadlocks across concurrent batches.
 FOR t IN SELECT value FROM jsonb_array_elements(p_targets) ORDER BY value->>'phone' LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || (t->>'phone'),0));
  SELECT * INTO existing FROM public.wa_bot_runs
   WHERE organization_id=p_org AND bulk_batch_id=p_batch AND phone=t->>'phone';
  IF FOUND THEN
   results := results || jsonb_build_array(jsonb_build_object('dealId',t->>'deal_id','runId',existing.id,'status','existing'));
   CONTINUE;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.deals d JOIN public.contacts c ON c.id=d.contact_id AND c.organization_id=p_org
    WHERE d.id=(t->>'deal_id')::uuid AND d.organization_id=p_org AND d.contact_id=(t->>'contact_id')::uuid AND d.deleted_at IS NULL AND c.deleted_at IS NULL)
    OR coalesce(t->>'phone','') !~ '^\+[1-9][0-9]{6,14}$' THEN
   results := results || jsonb_build_array(jsonb_build_object('dealId',t->>'deal_id','status','skipped','reason','Lead ou telefone indisponível'));
   CONTINUE;
  END IF;
  IF EXISTS(SELECT 1 FROM public.wa_bot_runs r LEFT JOIN public.contacts c ON c.id=r.contact_id
    LEFT JOIN public.wa_conversations cv ON cv.id=r.conversation_id
    WHERE r.organization_id=p_org AND r.status IN ('running','waiting_reply')
      AND (r.phone=t->>'phone' OR c.phone=t->>'phone' OR cv.wa_phone=t->>'phone' OR r.contact_id=(t->>'contact_id')::uuid)) THEN
   results := results || jsonb_build_array(jsonb_build_object('dealId',t->>'deal_id','status','skipped','reason','Contato já está em um robô ativo'));
   CONTINUE;
  END IF;
  INSERT INTO public.wa_bot_runs(organization_id,bot_id,deal_id,contact_id,phone,status,wake_at,step_index,vars,log,bulk_batch_id)
   VALUES(p_org,p_bot,(t->>'deal_id')::uuid,(t->>'contact_id')::uuid,t->>'phone','running',now(),0,'{}','[]',p_batch)
   RETURNING id INTO rid;
  results := results || jsonb_build_array(jsonb_build_object('dealId',t->>'deal_id','runId',rid,'status','queued'));
 END LOOP;
 RETURN results;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_bulk_bot_runs(uuid,uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_bulk_bot_runs(uuid,uuid,uuid,jsonb) TO service_role;
NOTIFY pgrst, 'reload schema';
