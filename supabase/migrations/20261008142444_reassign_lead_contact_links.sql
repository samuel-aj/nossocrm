-- Keep the existing authenticated deals update and its team/RLS authorization.
-- These internal triggers add invariants in the same transaction, including for
-- service integrations. Never move messages or group relationships to a person.
CREATE OR REPLACE FUNCTION crm_internal.validate_reassigned_deal_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    PERFORM 1 FROM public.contacts
      WHERE id = NEW.contact_id AND organization_id = NEW.organization_id AND deleted_at IS NULL
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Contato indisponível nesta organização' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION crm_internal.unlink_reassigned_deal_conversations()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- The lead row is locked before its conversations, matching the resolver and
  -- label RPCs. Keep labels and deal_link_mode: an explicit manual choice must
  -- not turn into an automatic link to a different lead.
  UPDATE public.wa_conversations SET deal_id = NULL
    WHERE organization_id = NEW.organization_id AND deal_id = NEW.id
      AND NOT coalesce(is_group, false)
      AND (NEW.contact_id IS NULL OR contact_id IS DISTINCT FROM NEW.contact_id);
  RETURN NEW;
END $$;

CREATE TRIGGER validate_reassigned_deal_contact
  BEFORE UPDATE OF contact_id ON public.deals
  FOR EACH ROW WHEN (OLD.contact_id IS DISTINCT FROM NEW.contact_id)
  EXECUTE FUNCTION crm_internal.validate_reassigned_deal_contact();
-- Run before unified_labels_deal_after, so a combined contact/tag change cannot
-- propagate the new contact's lead tags into the previous contact's chats.
CREATE TRIGGER reassign_deal_contact_conversations
  AFTER UPDATE OF contact_id ON public.deals
  FOR EACH ROW WHEN (OLD.contact_id IS DISTINCT FROM NEW.contact_id)
  EXECUTE FUNCTION crm_internal.unlink_reassigned_deal_conversations();

-- Close the race between a chat endpoint's access check and its link write.
-- Legacy chats without contact_id remain supported; changing a lead's contact
-- unlinks them above because their identity cannot be verified.
CREATE OR REPLACE FUNCTION crm_internal.validate_conversation_deal_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE linked_contact uuid;
BEGIN
  IF NEW.deal_id IS NULL OR NEW.is_group OR NEW.contact_id IS NULL THEN RETURN NEW; END IF;
  SELECT contact_id INTO linked_contact FROM public.deals
    WHERE id = NEW.deal_id AND organization_id = NEW.organization_id AND deleted_at IS NULL
    FOR UPDATE;
  IF NOT FOUND OR linked_contact IS DISTINCT FROM NEW.contact_id THEN
    RAISE EXCEPTION 'Lead indisponível para este contato; atualize a conversa' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_conversation_deal_contact
  BEFORE INSERT OR UPDATE OF deal_id, contact_id ON public.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION crm_internal.validate_conversation_deal_contact();

REVOKE ALL ON FUNCTION crm_internal.validate_reassigned_deal_contact(),
  crm_internal.unlink_reassigned_deal_conversations(), crm_internal.validate_conversation_deal_contact()
  FROM PUBLIC, anon, authenticated;
