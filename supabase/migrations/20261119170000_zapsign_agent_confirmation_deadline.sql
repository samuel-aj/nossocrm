BEGIN;

ALTER TABLE public.deal_signatures
  ADD COLUMN confirmation_timed_out_at timestamptz,
  ADD COLUMN confirmation_delivery_suppressed boolean NOT NULL DEFAULT false;

-- Only new reservations explicitly request this flow. The old signature worker
-- still cannot claim these rows (agent reservations have no queue or lease).
CREATE INDEX deal_signatures_waiting_for_provider ON public.deal_signatures(created_at, id)
WHERE origin = 'agent' AND request->>'await_provider_confirmation' = 'true'
  AND confirmation_timed_out_at IS NULL AND NOT confirmation_delivery_suppressed
  AND (status = 'processing' OR (status = 'pending' AND sign_url IS NULL AND agent_client_signed_at IS NULL));

CREATE FUNCTION crm_internal.guard_zapsign_confirmation_deadline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  cutoff timestamptz := OLD.created_at + interval '5 minutes';
  decision_at timestamptz := clock_timestamp();
  complete boolean := NEW.status IN ('pending','signed') AND NEW.doc_token IS NOT NULL AND
    (NEW.sign_url IS NOT NULL OR NEW.agent_client_signed_at IS NOT NULL OR NEW.status = 'signed');
  conv public.wa_conversations%ROWTYPE;
  handoff_details jsonb := '{}'::jsonb;
  moved_to uuid;
  reason constant text := 'A ZapSign não confirmou o contrato com link de assinatura em cinco minutos. Confira o documento antes de qualquer novo pedido.';
BEGIN
  IF NOT complete AND decision_at < cutoff THEN RETURN NEW; END IF;

  -- Serialize the decision with an operator pausing, resuming, or transferring
  -- this conversation. The reservation belongs to exactly this service session.
  SELECT * INTO conv FROM public.wa_conversations c
    WHERE c.organization_id = OLD.organization_id AND c.id = (OLD.request->>'conversation_id')::uuid
      AND c.deal_id = OLD.deal_id AND c.contact_id = OLD.contact_id
      AND c.connection_id = (OLD.request->>'connection_id')::uuid AND c.wa_phone = OLD.request->>'recipient'
      AND NOT c.is_group AND c.ai_agent_id = (OLD.request->>'agent_id')::uuid
      AND c.ai_status = 'active' AND c.ai_paused_by IS NULL AND c.ai_approval IS NULL
      AND OLD.request ? 'confirmation_agent_state_at'
      AND c.ai_status_changed_at IS NOT DISTINCT FROM (OLD.request->>'confirmation_agent_state_at')::timestamptz
    FOR UPDATE;
  IF NOT FOUND OR EXISTS (
    SELECT 1 FROM public.wa_messages m
    WHERE m.organization_id = OLD.organization_id AND m.conversation_id = conv.id
      AND m.created_at >= OLD.created_at AND m.direction = 'out' AND m.source = 'crm'
  ) THEN
    NEW.confirmation_delivery_suppressed := true;
  END IF;

  IF decision_at >= cutoff THEN
    -- Store the deadline, even if a delayed callback won the row lock before
    -- the next cron tick. Keep its verified document/status for the team.
    NEW.confirmation_timed_out_at := cutoff;
    IF NEW.status = 'processing' THEN NEW.status := 'failed'; END IF;
    NEW.last_error := reason;
    IF NOT NEW.confirmation_delivery_suppressed THEN
      UPDATE public.wa_conversations SET ai_status = 'paused', ai_resume_at = NULL,
        ai_status_changed_at = clock_timestamp() WHERE id = conv.id AND organization_id = OLD.organization_id;
      -- Only apply the configured stage movement, with the original lead/stage
      -- still in place. Other outcome actions belong to an explicit agent turn.
      IF OLD.stage_id IS NOT NULL THEN
        BEGIN
          WITH outcomes AS (
            SELECT o FROM public.wa_ai_agents a CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(a.outcomes)='array' THEN a.outcomes ELSE '[]'::jsonb END) o
            WHERE a.id=conv.ai_agent_id AND a.organization_id=OLD.organization_id
              AND EXISTS (SELECT 1 FROM (VALUES (o->>'key'),(o->>'label')) names(name)
                WHERE regexp_replace(translate(lower(trim(name)),'áàãâí','aaaai'),'[[:space:]_-]+','-','g')='analise-humana')
          ), moves AS (
            SELECT act->>'stage_id' AS stage FROM outcomes CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(o->'actions')='array' THEN o->'actions' ELSE '[]'::jsonb END) act
            WHERE (SELECT count(*) FROM outcomes)=1 AND act->>'type'='move_stage'
          )
          UPDATE public.deals d SET stage_id=s.id, last_stage_change_date=decision_at, updated_at=decision_at
          FROM moves JOIN public.board_stages s ON s.id::text=moves.stage
            JOIN public.boards b ON b.id=s.board_id AND b.organization_id=s.organization_id
            CROSS JOIN LATERAL crm_internal.deal_stage_rules(b.id,b.organization_id,s.id) r
          WHERE (SELECT count(*) FROM moves)=1 AND d.id=OLD.deal_id AND d.organization_id=OLD.organization_id
            AND d.contact_id=OLD.contact_id AND d.stage_id=OLD.stage_id AND s.id<>OLD.stage_id
            AND d.deleted_at IS NULL AND NOT d.is_won AND NOT d.is_lost
            AND d.board_id=b.id AND b.organization_id=OLD.organization_id AND b.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM public.board_stages src WHERE src.id=OLD.stage_id
              AND src.board_id=b.id AND src.organization_id=b.organization_id)
            AND b.linked_lifecycle_stage IS DISTINCT FROM 'CUSTOMER' AND s.id IS DISTINCT FROM b.won_stage_id
            AND NOT r.won AND NOT r.lost AND NOT crm_internal.deal_customer_phase(b.id,b.organization_id,s.id)
          RETURNING d.stage_id INTO moved_to;
          IF FOUND THEN handoff_details := jsonb_build_object('stage_id',moved_to); END IF;
        EXCEPTION WHEN OTHERS THEN
          -- The pause and the internal bell must survive a pipeline trigger failure.
          handoff_details := jsonb_build_object('stage_move_error',SQLSTATE);
        END;
      END IF;
      -- Existing AFTER INSERT trigger turns this handoff into one bell event.
      INSERT INTO public.wa_ai_agent_runs(organization_id,agent_id,conversation_id,trigger,status,reason,events)
      VALUES (OLD.organization_id,conv.ai_agent_id,conv.id,'contract_confirmation_timeout','error',reason,
        jsonb_build_array(jsonb_build_object('type','human_handoff','code','ZAPSIGN_CONFIRMATION_TIMEOUT',
          'signature_id',OLD.id,'due_at',cutoff) || handoff_details));
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION crm_internal.guard_zapsign_confirmation_deadline() FROM PUBLIC,anon,authenticated;

-- Runs after remember_agent_client_signature, so signing within the window ends
-- the wait even if the envelope has other signers and the link is unavailable.
CREATE TRIGGER zapsign_guard_confirmation_deadline BEFORE UPDATE ON public.deal_signatures
FOR EACH ROW WHEN (OLD.origin = 'agent' AND OLD.request->>'await_provider_confirmation' = 'true'
  AND OLD.request->>'agent_delivery' = 'conversation'
  AND OLD.confirmation_timed_out_at IS NULL AND NOT OLD.confirmation_delivery_suppressed
  AND (OLD.status = 'processing' OR (OLD.status = 'pending' AND OLD.sign_url IS NULL AND OLD.agent_client_signed_at IS NULL)))
EXECUTE FUNCTION crm_internal.guard_zapsign_confirmation_deadline();

DROP TRIGGER enqueue_zapsign_agent_notice ON public.deal_signatures;
CREATE TRIGGER enqueue_zapsign_agent_notice AFTER UPDATE OF status,sign_url,signers ON public.deal_signatures
FOR EACH ROW WHEN (NEW.confirmation_timed_out_at IS NULL AND NOT NEW.confirmation_delivery_suppressed)
EXECUTE FUNCTION crm_internal.enqueue_zapsign_agent_notice();

CREATE FUNCTION crm_internal.expire_zapsign_agent_confirmations() RETURNS void
LANGUAGE sql SET search_path = '' AS $$
  WITH due AS (
    SELECT s.id FROM public.deal_signatures s WHERE s.origin = 'agent'
      AND s.request->>'await_provider_confirmation' = 'true' AND s.request->>'agent_delivery' = 'conversation'
      AND s.confirmation_timed_out_at IS NULL AND NOT s.confirmation_delivery_suppressed
      AND (s.status = 'processing' OR (s.status = 'pending' AND s.sign_url IS NULL AND s.agent_client_signed_at IS NULL))
      AND s.created_at <= statement_timestamp() - interval '5 minutes'
      ORDER BY s.created_at,s.id LIMIT 100 FOR UPDATE SKIP LOCKED
  )
  UPDATE public.deal_signatures s SET updated_at = clock_timestamp() FROM due WHERE s.id = due.id;
$$;
REVOKE ALL ON FUNCTION crm_internal.expire_zapsign_agent_confirmations() FROM PUBLIC,anon,authenticated;

SELECT cron.schedule('zapsign-agent-confirmation-expiry','10 seconds',
  'SELECT crm_internal.expire_zapsign_agent_confirmations()');
COMMIT;
