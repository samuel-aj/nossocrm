-- Local/staging regression. Fixtures create no messages and all changes roll back.
BEGIN;
DO $$
DECLARE
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  old_contact uuid := gen_random_uuid(); new_contact uuid := gen_random_uuid(); foreign_contact uuid := gen_random_uuid();
  deleted_contact uuid := gen_random_uuid(); lead uuid := gen_random_uuid(); other_lead uuid := gen_random_uuid();
  chat_auto uuid := gen_random_uuid(); chat_manual uuid := gen_random_uuid(); chat_new uuid := gen_random_uuid();
  chat_optout uuid := gen_random_uuid(); chat_other uuid := gen_random_uuid(); chat_orphan uuid := gen_random_uuid();
  grp uuid := gen_random_uuid(); original_labels uuid[]; label uuid;
BEGIN
  INSERT INTO public.organizations(id, name) VALUES (org, 'Contact reassignment regression'), (other_org, 'Other regression organization');
  INSERT INTO public.contacts(id, organization_id, name) VALUES
    (old_contact, org, 'Cintia'), (new_contact, org, 'Joao'), (foreign_contact, other_org, 'Foreign'), (deleted_contact, org, 'Deleted');
  UPDATE public.contacts SET deleted_at = now() WHERE id = deleted_contact;
  INSERT INTO public.deals(id, organization_id, title, contact_id, tags) VALUES
    (lead, org, 'Keep lead title', old_contact, ARRAY['Original']), (other_lead, org, 'Other lead', new_contact, '{}');
  SELECT id INTO label FROM public.wa_labels WHERE organization_id = org AND name = 'Original';
  INSERT INTO public.wa_conversations(id, organization_id, wa_phone, contact_id, deal_id, deal_link_mode, label_ids) VALUES
    (chat_auto, org, 'test-' || chat_auto, old_contact, lead, 'auto', ARRAY[label]),
    (chat_manual, org, 'test-' || chat_manual, old_contact, lead, 'manual', ARRAY[label]),
    (chat_new, org, 'test-' || chat_new, new_contact, NULL, 'auto', '{}'),
    (chat_optout, org, 'test-' || chat_optout, new_contact, NULL, 'manual', '{}'),
    (chat_other, org, 'test-' || chat_other, new_contact, other_lead, 'manual', '{}'),
    (chat_orphan, org, 'test-' || chat_orphan, NULL, lead, 'auto', '{}');
  SELECT label_ids INTO original_labels FROM public.wa_conversations WHERE id = chat_auto;
  INSERT INTO public.wa_group_entities(id, organization_id, provider, external_id) VALUES (grp, org, 'uazapi', grp || '@g.us');
  INSERT INTO public.wa_group_deal_links(organization_id, group_id, deal_id, is_primary) VALUES (org, grp, lead, true);
  INSERT INTO public.wa_group_contact_links(organization_id, group_id, contact_id) VALUES (org, grp, old_contact);

  -- A contact correction and new labels in one request must not change the old chats' labels.
  UPDATE public.deals SET contact_id = new_contact, tags = ARRAY['New contact label'] WHERE id = lead;
  IF EXISTS (SELECT 1 FROM public.wa_conversations WHERE id IN (chat_auto, chat_manual, chat_orphan) AND deal_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Previous contact retained the reassigned lead';
  END IF;
  IF (SELECT label_ids FROM public.wa_conversations WHERE id = chat_auto) IS DISTINCT FROM original_labels OR
    (SELECT label_ids FROM public.wa_conversations WHERE id = chat_manual) IS DISTINCT FROM original_labels THEN
    RAISE EXCEPTION 'Contact correction changed previous chat labels';
  END IF;
  IF (SELECT deal_link_mode FROM public.wa_conversations WHERE id = chat_auto) <> 'auto' OR
    (SELECT deal_link_mode FROM public.wa_conversations WHERE id = chat_manual) <> 'manual' THEN
    RAISE EXCEPTION 'Manual choice or auto policy lost';
  END IF;
  IF (SELECT deal_id FROM public.wa_conversations WHERE id = chat_optout) IS NOT NULL OR
    (SELECT deal_id FROM public.wa_conversations WHERE id = chat_new) IS NOT NULL OR
    (SELECT deal_id FROM public.wa_conversations WHERE id = chat_other) <> other_lead THEN
    RAISE EXCEPTION 'New contact links were overwritten or selected without resolving ambiguity';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.wa_group_deal_links WHERE deal_id = lead AND group_id = grp AND is_primary) OR
    NOT EXISTS (SELECT 1 FROM public.wa_group_contact_links WHERE contact_id = old_contact AND group_id = grp) THEN
    RAISE EXCEPTION 'Group relationships moved or removed';
  END IF;
  IF (SELECT title FROM public.deals WHERE id = lead) <> 'Keep lead title' THEN RAISE EXCEPTION 'Lead content lost'; END IF;

  -- Stale manual-link request arriving after the correction must be rejected.
  BEGIN
    UPDATE public.wa_conversations SET deal_id = lead WHERE id = chat_auto;
    RAISE EXCEPTION 'Stale link request accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.wa_conversations SET deal_id = lead WHERE id = chat_new;
  UPDATE public.deals SET contact_id = new_contact WHERE id = lead;
  IF (SELECT deal_id FROM public.wa_conversations WHERE id = chat_new) <> lead THEN RAISE EXCEPTION 'No-op edit unlinked valid conversation'; END IF;
  BEGIN
    UPDATE public.deals SET contact_id = foreign_contact WHERE id = lead;
    RAISE EXCEPTION 'Cross-organization contact accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.deals SET contact_id = deleted_contact WHERE id = lead;
    RAISE EXCEPTION 'Deleted contact accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT contact_id FROM public.deals WHERE id = lead) <> new_contact OR
    (SELECT deal_id FROM public.wa_conversations WHERE id = chat_new) <> lead THEN RAISE EXCEPTION 'Rejected update did not roll back atomically'; END IF;
  UPDATE public.deals SET contact_id = NULL WHERE id = lead;
  IF (SELECT deal_id FROM public.wa_conversations WHERE id = chat_new) IS NOT NULL THEN RAISE EXCEPTION 'Clearing contact retained chat link'; END IF;
  IF has_function_privilege('authenticated', 'crm_internal.unlink_reassigned_deal_conversations()', 'execute') THEN
    RAISE EXCEPTION 'Internal trigger is exposed';
  END IF;
END $$;
SELECT 'reassign_lead_contact: all assertions passed (rollback)' AS result;
ROLLBACK;
