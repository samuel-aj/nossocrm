-- Existing explicit links remain authoritative. Manual unlinking opts out of repair.
CREATE INDEX IF NOT EXISTS deals_active_contact_idx
  ON public.deals (organization_id, contact_id) WHERE deleted_at IS NULL;

ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS deal_link_mode text NOT NULL DEFAULT 'auto'
  CHECK (deal_link_mode IN ('auto', 'manual'));

-- Server-only RPC. The API must authorize the conversation and the proposed lead.
-- Lock the lead before the conversation, matching the existing label functions.
CREATE OR REPLACE FUNCTION public.resolve_conversation_deal_link(
  p_org uuid, p_conversation uuid, p_contact uuid, p_candidate uuid, p_board uuid, p_owner uuid
) RETURNS public.wa_conversations
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE c public.wa_conversations; candidates uuid[];
BEGIN
  PERFORM 1 FROM public.deals
    WHERE organization_id=p_org AND id=p_candidate AND contact_id=p_contact AND deleted_at IS NULL
      AND board_id=p_board AND owner_id IS NOT DISTINCT FROM p_owner
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead changed; retry' USING ERRCODE='40001'; END IF;

  SELECT * INTO c FROM public.wa_conversations
    WHERE organization_id=p_org AND id=p_conversation FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found' USING ERRCODE='P0002'; END IF;
  IF c.deal_id IS NOT NULL OR c.deal_link_mode='manual' OR c.is_group
    OR c.contact_id IS DISTINCT FROM p_contact THEN RETURN c; END IF;

  SELECT array_agg(d.id) INTO candidates FROM (
    SELECT id FROM public.deals
    WHERE organization_id=p_org AND contact_id=p_contact AND deleted_at IS NULL LIMIT 2
  ) d;
  IF cardinality(candidates) IS DISTINCT FROM 1 OR candidates[1] IS DISTINCT FROM p_candidate THEN RETURN c; END IF;

  -- The existing label triggers merge tags and synchronize linked conversations.
  UPDATE public.wa_conversations SET deal_id=p_candidate
    WHERE id=c.id AND organization_id=p_org RETURNING * INTO c;
  RETURN c;
END $$;
REVOKE ALL ON FUNCTION public.resolve_conversation_deal_link(uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_conversation_deal_link(uuid,uuid,uuid,uuid,uuid,uuid) TO service_role;
