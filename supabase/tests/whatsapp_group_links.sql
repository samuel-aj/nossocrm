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
  conv uuid := gen_random_uuid(); private_conv uuid := gen_random_uuid(); board uuid := gen_random_uuid(); st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid();
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
  IF NOT EXISTS(SELECT 1 FROM public.webhook_events_out WHERE organization_id=org AND event_type='deal.created') THEN RAISE EXCEPTION 'Created webhook event missing; inspect notify_deal_created trigger warnings'; END IF;
  IF (SELECT payload->'deal'->'custom_fields' FROM public.webhook_events_out WHERE organization_id=org AND event_type='deal.created') IS DISTINCT FROM '{"preserved":"custom_fields"}'::jsonb THEN RAISE EXCEPTION 'Created webhook lost deployed custom_fields'; END IF;
  PERFORM pg_temp.expect_group_webhook(org,'deal.created','{}');
  UPDATE public.organization_settings SET wa_group_links_enabled=true WHERE organization_id=org;
  UPDATE public.deals SET stage_id=st2 WHERE id=lead;
  PERFORM pg_temp.expect_group_webhook(org,'deal.stage_changed','{"whatsapp_group_id":null}');
  INSERT INTO public.wa_connections(id,organization_id,provider,instance_name) VALUES (conn,org,'evolution','group-webhook-'||conn);
  INSERT INTO public.wa_conversations(id,organization_id,connection_id,wa_phone,group_jid,is_group,deal_id) VALUES
    (conv,org,conn,jid,jid,true,NULL),
    (private_conv,org,conn,'5511999999900',NULL,false,lead);
  PERFORM public.mutate_whatsapp_group_link(org,conv,'deal',lead,'link');
  UPDATE public.deals SET stage_id=st1 WHERE id=lead;
  PERFORM pg_temp.expect_group_webhook(org,'deal.stage_changed',jsonb_build_object('whatsapp_group_id',jid));
  INSERT INTO public.wa_messages(organization_id,conversation_id,direction,body) VALUES (org,private_conv,'in','Rollback-only fixture');
  PERFORM pg_temp.expect_group_webhook(org,'whatsapp.message.received',jsonb_build_object('whatsapp_group_id',jid));
  UPDATE public.organization_settings SET wa_group_links_enabled=false WHERE organization_id=org;
  UPDATE public.deals SET stage_id=st2 WHERE id=lead;
  PERFORM pg_temp.expect_group_webhook(org,'deal.stage_changed','{}');
  INSERT INTO public.wa_messages(organization_id,conversation_id,direction,body) VALUES (org,private_conv,'in','Disabled rollback fixture');
  PERFORM pg_temp.expect_group_webhook(org,'whatsapp.message.received','{}');
  UPDATE public.organization_settings SET wa_group_links_enabled=true WHERE organization_id=org;
  UPDATE public.deals SET stage_id=st1 WHERE id=lead;
  PERFORM pg_temp.expect_group_webhook(org,'deal.stage_changed',jsonb_build_object('whatsapp_group_id',jid));
END;
$$;
-- A mismatched reference must preserve the underlying row write while producing
-- neither a persisted external event nor a pg_net request for the fixture URL.
CREATE FUNCTION pg_temp.expect_no_group_webhook(p_org uuid, p_url text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.webhook_events_out WHERE organization_id=p_org) OR
     EXISTS(SELECT 1 FROM public.webhook_deliveries WHERE organization_id=p_org) OR
     EXISTS(SELECT 1 FROM net.http_request_queue WHERE url=p_url) THEN
    RAISE EXCEPTION 'Cross-organization reference produced a stored/queued webhook';
  END IF;
END;
$$;
DO $$
DECLARE
  org uuid := gen_random_uuid(); foreign_org uuid := gen_random_uuid();
  board uuid := gen_random_uuid(); foreign_board uuid := gen_random_uuid();
  st1 uuid := gen_random_uuid(); st2 uuid := gen_random_uuid(); foreign_stage uuid := gen_random_uuid();
  contact uuid := gen_random_uuid(); foreign_contact uuid := gen_random_uuid();
  lead uuid := gen_random_uuid(); foreign_lead uuid := gen_random_uuid(); broken_old_stage_lead uuid := gen_random_uuid();
  conn uuid := gen_random_uuid(); foreign_conn uuid := gen_random_uuid();
  conv uuid := gen_random_uuid(); foreign_conv uuid := gen_random_uuid();
  foreign_user uuid := gen_random_uuid(); member_user uuid := gen_random_uuid();
  endpoint uuid := gen_random_uuid(); msg uuid; invalid_lead uuid; scenario text; event_payload jsonb;
  url text := 'https://example.invalid/org-isolation/' || org;
BEGIN
  INSERT INTO public.organizations(id,name) VALUES (org,'Webhook isolation owner'),(foreign_org,'Webhook isolation foreign');
  UPDATE public.organization_settings SET wa_group_links_enabled=true WHERE organization_id=org;
  INSERT INTO public.boards(id,organization_id,name) VALUES (board,org,'Local board'),(foreign_board,foreign_org,'Private foreign board');
  INSERT INTO public.board_stages(id,board_id,organization_id,name,label,"order") VALUES
    (st1,board,org,'One','One',0),(st2,board,org,'Two','Two',1),
    (foreign_stage,foreign_board,foreign_org,'Foreign','Private foreign stage',0);
  INSERT INTO public.contacts(id,organization_id,name,email) VALUES
    (contact,org,'Local contact','local@example.invalid'),(foreign_contact,foreign_org,'Private foreign contact','foreign@example.invalid');
  INSERT INTO public.deals(id,organization_id,title,board_id,stage_id,contact_id) VALUES
    (lead,org,'Local lead',board,st1,contact),(foreign_lead,foreign_org,'Private foreign lead',foreign_board,foreign_stage,foreign_contact);
  INSERT INTO public.wa_connections(id,organization_id,provider,instance_name,profile_name) VALUES
    (conn,org,'evolution','isolation-'||conn,'Local connection'),
    (foreign_conn,foreign_org,'evolution','isolation-'||foreign_conn,'Private foreign connection');
  INSERT INTO public.wa_conversations(id,organization_id,connection_id,wa_phone,wa_name,contact_id,deal_id) VALUES
    (conv,org,conn,'5511999999911','Local conversation',contact,lead),
    (foreign_conv,foreign_org,foreign_conn,'5511999999922','Private foreign conversation',foreign_contact,foreign_lead);
  -- auth trigger creates profiles; explicit upsert keeps these fixtures independent
  -- of its default organization/name behavior. All auth/profile rows roll back.
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES
    (foreign_user,'foreign-'||foreign_user||'@example.invalid',jsonb_build_object('organization_id',foreign_org,'name','Private foreign sender')),
    (member_user,'member-'||member_user||'@example.invalid',jsonb_build_object('organization_id',foreign_org,'name','Authorized multi-org member'));
  INSERT INTO public.profiles(id,organization_id,name,role) VALUES
    (foreign_user,foreign_org,'Private foreign sender','vendedor'),(member_user,foreign_org,'Authorized multi-org member','vendedor')
    ON CONFLICT(id) DO UPDATE SET organization_id=EXCLUDED.organization_id,name=EXCLUDED.name,role=EXCLUDED.role;
  INSERT INTO public.user_organizations(user_id,organization_id,role) VALUES (member_user,org,'vendedor');
  INSERT INTO public.integration_outbound_endpoints(id,organization_id,name,url,secret,events,kind) VALUES
    (endpoint,org,'Isolation rollback-only',url,'rollback-only-secret',ARRAY['deal.created','deal.stage_changed','whatsapp.message.received'],'pipeline');

  FOREACH scenario IN ARRAY ARRAY['board','stage','contact'] LOOP
    invalid_lead := gen_random_uuid();
    INSERT INTO public.deals(id,organization_id,title,board_id,stage_id,contact_id) VALUES
      (invalid_lead,org,'Invalid created '||scenario,
       CASE WHEN scenario='board' THEN foreign_board ELSE board END,
       CASE WHEN scenario='stage' THEN foreign_stage ELSE st1 END,
       CASE WHEN scenario='contact' THEN foreign_contact ELSE contact END);
    IF NOT EXISTS(SELECT 1 FROM public.deals WHERE id=invalid_lead AND organization_id=org) THEN RAISE EXCEPTION 'Webhook prevented mismatched lead creation'; END IF;
    PERFORM pg_temp.expect_no_group_webhook(org,url);
  END LOOP;

  FOREACH scenario IN ARRAY ARRAY['board','stage','contact'] LOOP
    UPDATE public.deals SET
      board_id=CASE WHEN scenario='board' THEN foreign_board ELSE board END,
      stage_id=CASE WHEN scenario='stage' THEN foreign_stage ELSE st2 END,
      contact_id=CASE WHEN scenario='contact' THEN foreign_contact ELSE contact END WHERE id=lead;
    IF (SELECT stage_id FROM public.deals WHERE id=lead) IS DISTINCT FROM
       (CASE WHEN scenario='stage' THEN foreign_stage ELSE st2 END) THEN RAISE EXCEPTION 'Webhook prevented mismatched lead update'; END IF;
    PERFORM pg_temp.expect_no_group_webhook(org,url);
    UPDATE public.integration_outbound_endpoints SET active=false WHERE id=endpoint;
    UPDATE public.deals SET board_id=board,stage_id=st1,contact_id=contact WHERE id=lead;
    UPDATE public.integration_outbound_endpoints SET active=true WHERE id=endpoint;
  END LOOP;
  INSERT INTO public.deals(id,organization_id,title,board_id,stage_id) VALUES (broken_old_stage_lead,org,'Foreign previous stage',board,foreign_stage);
  UPDATE public.deals SET stage_id=st1 WHERE id=broken_old_stage_lead;
  PERFORM pg_temp.expect_no_group_webhook(org,url);

  msg := gen_random_uuid();
  INSERT INTO public.wa_messages(id,organization_id,conversation_id,direction,body) VALUES (msg,org,foreign_conv,'in','Cross-org conversation fixture');
  IF NOT EXISTS(SELECT 1 FROM public.wa_messages WHERE id=msg AND organization_id=org) THEN RAISE EXCEPTION 'Webhook prevented mismatched message insert'; END IF;
  PERFORM pg_temp.expect_no_group_webhook(org,url);
  FOREACH scenario IN ARRAY ARRAY['connection','contact','deal','owner','sender'] LOOP
    BEGIN
      UPDATE public.wa_conversations SET
        connection_id=CASE WHEN scenario='connection' THEN foreign_conn ELSE conn END,
        contact_id=CASE WHEN scenario='contact' THEN foreign_contact ELSE contact END,
        deal_id=CASE WHEN scenario='deal' THEN foreign_lead ELSE lead END,
        assigned_owner_id=CASE WHEN scenario='owner' THEN foreign_user ELSE NULL END WHERE id=conv;
    EXCEPTION WHEN check_violation THEN
      -- Existing label integrity rejects foreign lead assignment before a
      -- webhook can run. Retain that guard and verify its rejection is atomic.
      IF scenario <> 'deal' OR SQLERRM <> 'Invalid lead organization or deleted lead' THEN RAISE; END IF;
      IF (SELECT deal_id FROM public.wa_conversations WHERE id=conv) IS DISTINCT FROM lead THEN
        RAISE EXCEPTION 'Rejected foreign lead assignment changed the conversation';
      END IF;
      PERFORM pg_temp.expect_no_group_webhook(org,url);
      CONTINUE;
    END;
    msg := gen_random_uuid();
    INSERT INTO public.wa_messages(id,organization_id,conversation_id,direction,body,sent_by) VALUES
      (msg,org,conv,'in','Cross-org '||scenario,CASE WHEN scenario='sender' THEN foreign_user ELSE NULL END);
    IF NOT EXISTS(SELECT 1 FROM public.wa_messages WHERE id=msg) THEN RAISE EXCEPTION 'Webhook prevented invalid % message insert',scenario; END IF;
    PERFORM pg_temp.expect_no_group_webhook(org,url);
  END LOOP;
  UPDATE public.wa_conversations SET connection_id=conn,contact_id=contact,deal_id=lead,assigned_owner_id=NULL WHERE id=conv;
  FOREACH scenario IN ARRAY ARRAY['board','stage'] LOOP
    UPDATE public.integration_outbound_endpoints SET active=false WHERE id=endpoint;
    UPDATE public.deals SET board_id=CASE WHEN scenario='board' THEN foreign_board ELSE board END,
      stage_id=CASE WHEN scenario='stage' THEN foreign_stage ELSE st1 END WHERE id=lead;
    UPDATE public.integration_outbound_endpoints SET active=true WHERE id=endpoint;
    INSERT INTO public.wa_messages(organization_id,conversation_id,direction,body) VALUES (org,conv,'in','Foreign deal '||scenario);
    PERFORM pg_temp.expect_no_group_webhook(org,url);
  END LOOP;
  UPDATE public.integration_outbound_endpoints SET active=false WHERE id=endpoint;
  UPDATE public.deals SET board_id=board,stage_id=st1 WHERE id=lead;
  UPDATE public.integration_outbound_endpoints SET active=true WHERE id=endpoint;

  -- A user whose primary profile belongs elsewhere can still send/own in an
  -- organization where they have explicit membership (same user_org_ids rules).
  UPDATE public.wa_conversations SET assigned_owner_id=member_user WHERE id=conv;
  INSERT INTO public.wa_messages(organization_id,conversation_id,direction,body,sent_by) VALUES (org,conv,'in','Authorized membership fixture',member_user);
  SELECT payload INTO STRICT event_payload FROM public.webhook_events_out WHERE organization_id=org AND event_type='whatsapp.message.received';
  IF event_payload #>> '{message,sent_by_name}' IS DISTINCT FROM 'Authorized multi-org member' OR
     event_payload #>> '{message,sent_by_user_id}' IS DISTINCT FROM member_user::text OR
     event_payload #>> '{conversation,assigned_owner_id}' IS DISTINCT FROM member_user::text THEN
    RAISE EXCEPTION 'Authorized member sender/owner metadata was lost: %',event_payload;
  END IF;
  PERFORM pg_temp.expect_group_webhook(org,'whatsapp.message.received','{"whatsapp_group_id":null}');
END;
$$;
ROLLBACK;
