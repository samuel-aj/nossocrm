-- Controller runs on reviewed staging migration. Every fixture and setting rolls back.
BEGIN;
CREATE FUNCTION pg_temp.expect_group_links_error(statement text, expected_state text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = expected_state THEN RETURN; END IF;
    RAISE EXCEPTION 'Expected %, got %: %', expected_state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'Expected SQLSTATE %, statement succeeded', expected_state;
END;
$$;
DO $$
DECLARE
  org uuid := gen_random_uuid(); other_org uuid := gen_random_uuid();
  contact uuid := gen_random_uuid(); other_contact uuid := gen_random_uuid();
  deal uuid := gen_random_uuid(); other_deal uuid := gen_random_uuid();
  conn uuid := gen_random_uuid(); conn2 uuid := gen_random_uuid();
  conv uuid := gen_random_uuid(); conv2 uuid := gen_random_uuid(); duplicate_conv uuid := gen_random_uuid();
  private_conv uuid := gen_random_uuid();
  group1 uuid; group2 uuid;
  jid1 text := '120363012345678901@g.us'; jid2 text := '55119999-1234@g.us';
  role_name text; table_name text;
BEGIN
  INSERT INTO public.organizations(id, name) VALUES (org, 'Group links rollback verification'), (other_org, 'Cross-org rollback verification');
  -- handle_new_organization already creates settings and a default board.
  INSERT INTO public.organization_settings(organization_id) VALUES (org), (other_org)
    ON CONFLICT (organization_id) DO NOTHING;
  INSERT INTO public.contacts(id, organization_id, name) VALUES (contact, org, 'Group links contact'), (other_contact, other_org, 'Other contact');
  INSERT INTO public.deals(id, organization_id, title, contact_id) VALUES (deal, org, 'Group links lead', contact), (other_deal, other_org, 'Other lead', other_contact);
  INSERT INTO public.wa_connections(id, organization_id, provider, instance_name) VALUES
    (conn, org, 'evolution', 'group-links-' || conn), (conn2, org, 'evolution', 'group-links-' || conn2);
  INSERT INTO public.wa_conversations(id, organization_id, connection_id, wa_phone, group_jid, is_group, wa_name) VALUES
    (conv, org, conn, jid1, jid1, true, 'Original'), (conv2, org, conn, jid2, jid2, true, 'Second'),
    (duplicate_conv, org, conn2, jid1, jid1, true, 'Same identity on another connection'),
    (private_conv, org, conn, '5511999999999', null, false, 'Private');
  IF public.deal_whatsapp_group_field(org, deal) <> '{}'::jsonb THEN RAISE EXCEPTION 'New setting must default off'; END IF;
  PERFORM pg_temp.expect_group_links_error(format('SELECT public.mutate_whatsapp_group_link(%L,%L,''deal'',%L,''link'')', org, conv, deal), '55000');
  UPDATE public.organization_settings SET wa_group_links_enabled = true WHERE organization_id = org;
  IF public.deal_whatsapp_group_field(org, deal) <> '{"whatsapp_group_id":null}'::jsonb THEN RAISE EXCEPTION 'Enabled unlinked field must be null'; END IF;
  PERFORM public.mutate_whatsapp_group_link(org, conv, 'deal', deal, 'link');
  SELECT id INTO STRICT group1 FROM public.wa_group_entities WHERE organization_id = org AND external_id = jid1 AND provider = 'evolution';
  IF public.deal_whatsapp_group_field(org, deal) <> jsonb_build_object('whatsapp_group_id', jid1) THEN RAISE EXCEPTION 'First link must be principal and preserve JID'; END IF;
  PERFORM public.mutate_whatsapp_group_link(org, conv2, 'deal', deal, 'link');
  SELECT id INTO STRICT group2 FROM public.wa_group_entities WHERE organization_id = org AND external_id = jid2 AND provider = 'evolution';
  IF (SELECT count(*) FROM public.wa_group_deal_links WHERE organization_id = org AND deal_id = deal) <> 2 OR
     (SELECT count(*) FROM public.wa_group_deal_links WHERE organization_id = org AND deal_id = deal AND is_primary) <> 1 THEN RAISE EXCEPTION 'Multiple links need exactly one first principal'; END IF;
  PERFORM public.mutate_whatsapp_group_link(org, conv2, 'deal', deal, 'set_primary');
  PERFORM public.mutate_whatsapp_group_link(org, conv, 'deal', deal, 'link');
  PERFORM public.mutate_whatsapp_group_link(org, duplicate_conv, 'deal', deal, 'link');
  IF public.deal_whatsapp_group_field(org, deal) <> jsonb_build_object('whatsapp_group_id', jid2) THEN RAISE EXCEPTION 'Duplicate inclusion must not promote'; END IF;
  IF (SELECT count(*) FROM public.wa_group_entities WHERE organization_id = org AND external_id = jid1) <> 1 THEN RAISE EXCEPTION 'Identity must span connections'; END IF;
  UPDATE public.wa_conversations SET wa_name = 'Renamed' WHERE id = conv;
  IF (SELECT external_id FROM public.wa_group_entities WHERE id = group1) <> jid1 THEN RAISE EXCEPTION 'Rename must preserve identity'; END IF;
  PERFORM public.mutate_whatsapp_group_link(org, conv, 'contact', contact, 'link');
  PERFORM public.mutate_whatsapp_group_link(org, conv2, 'contact', contact, 'link');
  PERFORM public.mutate_whatsapp_group_link(org, conv, 'contact', contact, 'link');
  IF (SELECT count(*) FROM public.wa_group_contact_links WHERE organization_id = org AND contact_id = contact) <> 2 THEN RAISE EXCEPTION 'Contact links must be many-to-many and idempotent'; END IF;
  PERFORM pg_temp.expect_group_links_error(format('UPDATE public.wa_group_deal_links SET is_primary=true WHERE group_id=%L AND deal_id=%L', group1, deal), '23505');
  PERFORM pg_temp.expect_group_links_error(format('INSERT INTO public.wa_group_contact_links(organization_id,group_id,contact_id) VALUES(%L,%L,%L)', org, group1, other_contact), '23503');
  PERFORM pg_temp.expect_group_links_error(format('INSERT INTO public.wa_group_deal_links(organization_id,group_id,deal_id) VALUES(%L,%L,%L)', org, group1, other_deal), '23503');
  PERFORM pg_temp.expect_group_links_error(format('INSERT INTO public.wa_group_contact_links(organization_id,group_id,contact_id) VALUES(%L,%L,%L)', other_org, group1, other_contact), '23503');
  PERFORM pg_temp.expect_group_links_error(format('UPDATE public.contacts SET organization_id=%L WHERE id=%L', other_org, contact), '23503');
  PERFORM pg_temp.expect_group_links_error(format('UPDATE public.deals SET organization_id=%L WHERE id=%L', other_org, deal), '23503');
  PERFORM pg_temp.expect_group_links_error(format('UPDATE public.wa_group_entities SET organization_id=%L WHERE id=%L', other_org, group1), '23503');
  PERFORM pg_temp.expect_group_links_error(format('SELECT public.mutate_whatsapp_group_link(%L,%L,''deal'',%L,''link'')', org, private_conv, deal), '22023');
  PERFORM pg_temp.expect_group_links_error(format('SELECT public.mutate_whatsapp_group_link(%L,%L,''deal'',%L,''link'')', org, conv, other_deal), '22023');
  PERFORM pg_temp.expect_group_links_error(format('SELECT public.mutate_whatsapp_group_link(%L,%L,''contact'',%L,''set_primary'')', org, conv, contact), '22023');
  UPDATE public.wa_conversations SET group_jid = '@g.us' WHERE id = private_conv;
  UPDATE public.wa_conversations SET is_group = true WHERE id = private_conv;
  PERFORM pg_temp.expect_group_links_error(format('SELECT public.mutate_whatsapp_group_link(%L,%L,''deal'',%L,''link'')', org, private_conv, deal), '22023');
  PERFORM pg_temp.expect_group_links_error(format('INSERT INTO public.wa_group_entities(organization_id,provider,external_id) VALUES(%L,''evolution'',''@g.us'')', org), '23514');
  IF public.deal_whatsapp_group_field(other_org, deal) <> '{}'::jsonb THEN RAISE EXCEPTION 'Cross-org field must not leak while disabled'; END IF;
  UPDATE public.organization_settings SET wa_group_links_enabled = true WHERE organization_id = other_org;
  IF public.deal_whatsapp_group_field(other_org, deal) <> '{"whatsapp_group_id":null}'::jsonb THEN RAISE EXCEPTION 'Cross-org field must not leak while enabled'; END IF;
  UPDATE public.organization_settings SET wa_group_links_enabled = false WHERE organization_id = org;
  IF public.deal_whatsapp_group_field(org, deal) <> '{}'::jsonb THEN RAISE EXCEPTION 'Disabled field must be omitted'; END IF;
  PERFORM pg_temp.expect_group_links_error(format('SELECT public.mutate_whatsapp_group_link(%L,%L,''deal'',%L,''unlink'')', org, conv, deal), '55000');
  UPDATE public.organization_settings SET wa_group_links_enabled = true WHERE organization_id = org;
  IF public.deal_whatsapp_group_field(org, deal) <> jsonb_build_object('whatsapp_group_id', jid2) THEN RAISE EXCEPTION 'Reactivation must preserve principal'; END IF;
  PERFORM public.mutate_whatsapp_group_link(org, conv2, 'deal', deal, 'unlink');
  IF public.deal_whatsapp_group_field(org, deal) <> '{"whatsapp_group_id":null}'::jsonb THEN RAISE EXCEPTION 'Unlink principal must not promote remaining links'; END IF;
  PERFORM public.mutate_whatsapp_group_link(org, conv, 'deal', deal, 'link');
  IF public.deal_whatsapp_group_field(org, deal) <> '{"whatsapp_group_id":null}'::jsonb THEN RAISE EXCEPTION 'Duplicate link after principal removal must not promote'; END IF;
  PERFORM pg_temp.expect_group_links_error(format('SELECT public.mutate_whatsapp_group_link(%L,%L,''deal'',%L,''set_primary'')', org, conv2, deal), '22023');
  PERFORM public.mutate_whatsapp_group_link(org, conv, 'deal', deal, 'set_primary');
  IF public.deal_whatsapp_group_field(org, deal) <> jsonb_build_object('whatsapp_group_id', jid1) THEN RAISE EXCEPTION 'Explicit principal selection must restore JID'; END IF;
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(role_name, 'public.deal_whatsapp_group_field(uuid,uuid)', 'EXECUTE') OR
       has_function_privilege(role_name, 'public.mutate_whatsapp_group_link(uuid,uuid,text,uuid,text)', 'EXECUTE') THEN RAISE EXCEPTION 'Untrusted RPC privilege for %', role_name; END IF;
    FOREACH table_name IN ARRAY ARRAY['wa_group_entities','wa_group_contact_links','wa_group_deal_links'] LOOP
      IF has_table_privilege(role_name, 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Untrusted table privilege for % on %', role_name, table_name; END IF;
    END LOOP;
  END LOOP;
  IF NOT has_function_privilege('service_role', 'public.deal_whatsapp_group_field(uuid,uuid)', 'EXECUTE') OR
     NOT has_function_privilege('service_role', 'public.mutate_whatsapp_group_link(uuid,uuid,text,uuid,text)', 'EXECUTE') THEN RAISE EXCEPTION 'Missing service RPC grant'; END IF;
  IF EXISTS(SELECT 1 FROM pg_class WHERE oid IN ('public.wa_group_entities'::regclass, 'public.wa_group_contact_links'::regclass, 'public.wa_group_deal_links'::regclass) AND NOT relrowsecurity) THEN RAISE EXCEPTION 'Missing RLS'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE oid IN ('public.deal_whatsapp_group_field(uuid,uuid)'::regprocedure,'public.mutate_whatsapp_group_link(uuid,uuid,text,uuid,text)'::regprocedure) AND (prosecdef OR NOT coalesce(proconfig @> ARRAY['search_path=""'],false))) THEN RAISE EXCEPTION 'Functions must be invoker with fixed empty search path'; END IF;
  UPDATE public.deals SET contact_id = null WHERE id = deal;
  DELETE FROM public.contacts WHERE id = contact;
  IF EXISTS(SELECT 1 FROM public.wa_group_contact_links WHERE contact_id = contact) THEN RAISE EXCEPTION 'Contact deletion must cascade links'; END IF;
  DELETE FROM public.deals WHERE id = deal;
  IF EXISTS(SELECT 1 FROM public.wa_group_deal_links WHERE deal_id = deal) THEN RAISE EXCEPTION 'Deal deletion must cascade links'; END IF;
  DELETE FROM public.wa_group_entities WHERE id IN (group1, group2);
END;
$$;
-- pg_net sends only after commit. This transaction always rolls back: request
-- bodies below are inspected in the queue and never delivered externally.
CREATE FUNCTION pg_temp.expect_group_webhook(p_org uuid, p_event text, p_field jsonb)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE event_payload jsonb; queued_payload jsonb; request_id bigint;
BEGIN
  SELECT e.payload, d.request_id INTO STRICT event_payload, request_id
  FROM public.webhook_events_out e JOIN public.webhook_deliveries d ON d.event_id=e.id
  WHERE e.organization_id=p_org AND e.event_type=p_event;
  IF (event_payload->'deal'->'whatsapp_group_id') IS DISTINCT FROM (p_field->'whatsapp_group_id') OR
     (event_payload->'deal' ? 'whatsapp_group_id') IS DISTINCT FROM (p_field ? 'whatsapp_group_id') THEN
    RAISE EXCEPTION 'Wrong group field on %: % expected %', p_event, event_payload, p_field;
  END IF;
  IF request_id IS NULL THEN RAISE EXCEPTION 'Missing pg_net request for %', p_event; END IF;
  SELECT convert_from(q.body, 'UTF8')::jsonb INTO STRICT queued_payload FROM net.http_request_queue q WHERE q.id=request_id;
  IF queued_payload IS DISTINCT FROM event_payload THEN RAISE EXCEPTION 'Stored and queued payloads differ for %', p_event; END IF;
  DELETE FROM public.webhook_events_out WHERE organization_id=p_org;
END;
$$;
DO $$
DECLARE
  org uuid := gen_random_uuid(); lead uuid := gen_random_uuid(); conn uuid := gen_random_uuid();
  conv uuid := gen_random_uuid(); board uuid := gen_random_uuid(); st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid();
  jid text := '120363012345678901@g.us';
BEGIN
  INSERT INTO public.organizations(id,name) VALUES (org,'Group webhook rollback verification');
  INSERT INTO public.boards(id,organization_id,name) VALUES (board,org,'Group webhooks');
  INSERT INTO public.board_stages(id,board_id,organization_id,name,label,"order") VALUES
    (st1,board,org,'One','One',0),(st2,board,org,'Two','Two',1);
  INSERT INTO public.deals(organization_id,title,board_id,stage_id) VALUES (org,'No endpoint',board,st1);
  IF EXISTS(SELECT 1 FROM public.webhook_events_out WHERE organization_id=org) THEN RAISE EXCEPTION 'No-endpoint path should not store events'; END IF;
  INSERT INTO public.integration_outbound_endpoints(organization_id,name,url,secret,events,kind) VALUES
    (org,'Rollback-only capture','https://example.invalid/group-links','rollback-only-secret',ARRAY['deal.created','deal.stage_changed','whatsapp.message.received'],'pipeline');
  INSERT INTO public.deals(id,organization_id,title,board_id,stage_id,custom_fields)
    VALUES (lead,org,'Created while disabled',board,st1,'{"preserved":"custom_fields"}'::jsonb);
  IF (SELECT payload->'deal'->'custom_fields' FROM public.webhook_events_out WHERE organization_id=org AND event_type='deal.created') <> '{"preserved":"custom_fields"}'::jsonb THEN RAISE EXCEPTION 'Created webhook lost deployed custom_fields'; END IF;
  PERFORM pg_temp.expect_group_webhook(org,'deal.created','{}');
  UPDATE public.organization_settings SET wa_group_links_enabled=true WHERE organization_id=org;
  UPDATE public.deals SET stage_id=st2 WHERE id=lead;
  PERFORM pg_temp.expect_group_webhook(org,'deal.stage_changed','{"whatsapp_group_id":null}');
  INSERT INTO public.wa_connections(id,organization_id,provider,instance_name) VALUES (conn,org,'evolution','group-webhook-'||conn);
  INSERT INTO public.wa_conversations(id,organization_id,connection_id,wa_phone,group_jid,is_group,deal_id) VALUES (conv,org,conn,jid,jid,true,lead);
  PERFORM public.mutate_whatsapp_group_link(org,conv,'deal',lead,'link');
  UPDATE public.deals SET stage_id=st1 WHERE id=lead;
  PERFORM pg_temp.expect_group_webhook(org,'deal.stage_changed',jsonb_build_object('whatsapp_group_id',jid));
  INSERT INTO public.wa_messages(organization_id,conversation_id,direction,body) VALUES (org,conv,'in','Rollback-only fixture');
  PERFORM pg_temp.expect_group_webhook(org,'whatsapp.message.received',jsonb_build_object('whatsapp_group_id',jid));
  UPDATE public.organization_settings SET wa_group_links_enabled=false WHERE organization_id=org;
  UPDATE public.deals SET stage_id=st2 WHERE id=lead;
  PERFORM pg_temp.expect_group_webhook(org,'deal.stage_changed','{}');
  INSERT INTO public.wa_messages(organization_id,conversation_id,direction,body) VALUES (org,conv,'in','Disabled rollback fixture');
  PERFORM pg_temp.expect_group_webhook(org,'whatsapp.message.received','{}');
  UPDATE public.organization_settings SET wa_group_links_enabled=true WHERE organization_id=org;
  UPDATE public.deals SET stage_id=st1 WHERE id=lead;
  PERFORM pg_temp.expect_group_webhook(org,'deal.stage_changed',jsonb_build_object('whatsapp_group_id',jid));
END;
$$;
ROLLBACK;
