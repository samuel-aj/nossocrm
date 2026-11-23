-- Use an isolated PostgreSQL database. The sweeper is intentionally global.
BEGIN;

CREATE FUNCTION pg_temp.reserve_contract(p_conversation uuid, p_age interval, opt_in boolean DEFAULT true) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE sig uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.deal_signatures(id, organization_id, deal_id, contact_id, stage_id, origin, template_token,
    status, request, created_at)
  SELECT sig,c.organization_id,c.deal_id,c.contact_id,d.stage_id,'agent',sig::text,'processing',
    jsonb_build_object('agent_delivery','conversation','agent_id',c.ai_agent_id,'conversation_id',c.id,
      'connection_id',c.connection_id,'recipient',c.wa_phone,'confirmation_agent_state_at',c.ai_status_changed_at)
      || CASE WHEN opt_in THEN '{"await_provider_confirmation":true}'::jsonb ELSE '{}'::jsonb END,
    clock_timestamp()-p_age
  FROM public.wa_conversations c JOIN public.deals d ON d.id=c.deal_id AND d.organization_id=c.organization_id
  WHERE c.id = p_conversation;
  RETURN sig;
END $$;

DO $$
DECLARE org uuid := gen_random_uuid(); lead uuid := gen_random_uuid(); contact uuid := gen_random_uuid();
  agent uuid := gen_random_uuid(); conn uuid := gen_random_uuid(); chat uuid := gen_random_uuid();
  timely uuid; expired uuid; delayed uuid; no_link uuid; partly_signed uuid; taken_over uuid;
  legacy uuid; package uuid; handoffs integer;
  board uuid := gen_random_uuid(); collecting uuid := gen_random_uuid(); target uuid := gen_random_uuid();
  another_stage uuid := gen_random_uuid(); terminal uuid := gen_random_uuid(); destination uuid;
  outcome jsonb; moved uuid; already_moved uuid; invalid_move uuid; duplicate_outcome uuid;
BEGIN
  INSERT INTO public.organizations(id,name) VALUES(org,'Test confirmation deadline');
  INSERT INTO public.contacts(id,organization_id,name) VALUES(contact,org,'Test contact');
  INSERT INTO public.deals(id,organization_id,contact_id,title) VALUES(lead,org,contact,'Test deal');
  INSERT INTO public.wa_ai_agents(id,organization_id,name,provider,model) VALUES(agent,org,'Test','openai','test');
  INSERT INTO public.wa_connections(id,organization_id,instance_name) VALUES(conn,org,'test-'||conn);
  INSERT INTO public.wa_conversations(id,organization_id,deal_id,contact_id,connection_id,wa_phone,ai_agent_id,ai_status,ai_status_changed_at)
    VALUES(chat,org,lead,contact,conn,'test-'||chat,agent,'active',clock_timestamp());

  legacy := pg_temp.reserve_contract(chat,'1 hour',false);
  timely := pg_temp.reserve_contract(chat,'4 minutes');
  PERFORM crm_internal.expire_zapsign_agent_confirmations();
  ASSERT (SELECT status='processing' AND confirmation_timed_out_at IS NULL FROM public.deal_signatures WHERE id=timely);
  UPDATE public.deal_signatures SET status='pending',doc_token=timely::text,sign_url='test:link' WHERE id=timely;
  UPDATE public.deal_signatures SET sign_url='test:link' WHERE id=timely;
  ASSERT (SELECT count(*)=1 FROM public.zapsign_agent_notices WHERE signature_id=timely AND kind='invite');
  ASSERT (SELECT ai_status='active' FROM public.wa_conversations WHERE id=chat);

  expired := pg_temp.reserve_contract(chat,'6 minutes');
  PERFORM crm_internal.expire_zapsign_agent_confirmations();
  PERFORM crm_internal.expire_zapsign_agent_confirmations();
  ASSERT (SELECT status='failed' AND confirmation_timed_out_at=created_at+interval '5 minutes' FROM public.deal_signatures WHERE id=expired);
  ASSERT (SELECT ai_status='paused' AND ai_resume_at IS NULL FROM public.wa_conversations WHERE id=chat);
  ASSERT (SELECT count(*)=1 FROM public.crm_notification_events WHERE source_id=chat AND kind='human_handoff');
  ASSERT (SELECT count(*)=1 FROM public.wa_ai_agent_runs WHERE conversation_id=chat AND trigger='contract_confirmation_timeout');
  UPDATE public.deal_signatures SET status='pending',doc_token=expired::text,sign_url='test:late' WHERE id=expired;
  UPDATE public.wa_conversations SET ai_status='active',ai_status_changed_at=clock_timestamp() WHERE id=chat;
  UPDATE public.deal_signatures SET status='signed',signers='[{"role":"contact","status":"signed"}]' WHERE id=expired;
  ASSERT (SELECT status='signed' AND doc_token=expired::text FROM public.deal_signatures WHERE id=expired);
  ASSERT NOT EXISTS (SELECT 1 FROM public.zapsign_agent_notices WHERE signature_id=expired);
  ASSERT (SELECT status='processing' FROM public.deal_signatures WHERE id=legacy);

  -- A verified response arrives one millisecond too late, before the next sweep.
  delayed := pg_temp.reserve_contract(chat,'5 minutes 0.001 seconds');
  UPDATE public.deal_signatures SET status='pending',doc_token=delayed::text,sign_url='test:late' WHERE id=delayed;
  ASSERT (SELECT status='pending' AND confirmation_timed_out_at IS NOT NULL AND sign_url='test:late' FROM public.deal_signatures WHERE id=delayed);
  ASSERT NOT EXISTS (SELECT 1 FROM public.zapsign_agent_notices WHERE signature_id=delayed);
  ASSERT (SELECT count(*)=2 FROM public.crm_notification_events WHERE source_id=chat AND kind='human_handoff');

  UPDATE public.wa_conversations SET ai_status='active',ai_status_changed_at=clock_timestamp() WHERE id=chat;
  partly_signed := pg_temp.reserve_contract(chat,'1 minute');
  UPDATE public.deal_signatures SET status='pending',doc_token=partly_signed::text,signers='[{"role":"contact","status":"signed"}]' WHERE id=partly_signed;
  ASSERT (SELECT agent_client_signed_at IS NOT NULL AND confirmation_timed_out_at IS NULL FROM public.deal_signatures WHERE id=partly_signed);
  ASSERT (SELECT count(*)=1 FROM public.zapsign_agent_notices WHERE signature_id=partly_signed AND kind='signed');

  no_link := pg_temp.reserve_contract(chat,'1 minute');
  UPDATE public.deal_signatures SET status='pending',doc_token=no_link::text WHERE id=no_link;
  -- Advance fixture time without sleeping. An incomplete confirmation remains waiting.
  UPDATE public.deal_signatures SET created_at=clock_timestamp()-interval '6 minutes' WHERE id=no_link;
  PERFORM crm_internal.expire_zapsign_agent_confirmations();
  ASSERT (SELECT status='pending' AND confirmation_timed_out_at IS NOT NULL AND doc_token=no_link::text FROM public.deal_signatures WHERE id=no_link);
  ASSERT NOT EXISTS (SELECT 1 FROM public.zapsign_agent_notices WHERE signature_id=no_link);

  UPDATE public.wa_conversations SET ai_status='active',ai_status_changed_at=clock_timestamp() WHERE id=chat;
  taken_over := pg_temp.reserve_contract(chat,'1 minute');
  UPDATE public.wa_conversations SET ai_status='paused',ai_status_changed_at=clock_timestamp(),ai_resume_at=NULL WHERE id=chat;
  UPDATE public.wa_conversations SET ai_status='active',ai_status_changed_at=clock_timestamp() WHERE id=chat;
  SELECT count(*) INTO handoffs FROM public.crm_notification_events WHERE source_id=chat AND kind='human_handoff';
  UPDATE public.deal_signatures SET status='pending',doc_token=taken_over::text,sign_url='test:operator' WHERE id=taken_over;
  ASSERT (SELECT confirmation_delivery_suppressed AND confirmation_timed_out_at IS NULL FROM public.deal_signatures WHERE id=taken_over);
  ASSERT (SELECT ai_status='active' FROM public.wa_conversations WHERE id=chat);
  ASSERT NOT EXISTS (SELECT 1 FROM public.zapsign_agent_notices WHERE signature_id=taken_over);
  ASSERT (SELECT count(*)=handoffs FROM public.crm_notification_events WHERE source_id=chat AND kind='human_handoff');

  package := pg_temp.reserve_contract(chat,'1 minute');
  UPDATE public.deal_signatures SET doc_token=package::text, request=request || '{"package_expected":2}',
    created_at=clock_timestamp()-interval '6 minutes' WHERE id=package;
  PERFORM crm_internal.expire_zapsign_agent_confirmations();
  ASSERT (SELECT status='failed' AND doc_token=package::text AND confirmation_timed_out_at IS NOT NULL FROM public.deal_signatures WHERE id=package);
  ASSERT NOT EXISTS (SELECT 1 FROM public.zapsign_agent_notices WHERE signature_id=package);

  INSERT INTO public.boards(id,organization_id,name) VALUES(board,org,'Test board');
  INSERT INTO public.board_stages(id,board_id,organization_id,name,label,"order",linked_lifecycle_stage)
    VALUES(collecting,board,org,'Ficha','Ficha',1,NULL),(target,board,org,'Análise humana','Análise humana',2,NULL),
      (another_stage,board,org,'Negociação','Negociação',3,NULL),(terminal,board,org,'Ganho','Ganho',4,'CUSTOMER');
  UPDATE public.deals SET board_id=board,stage_id=collecting WHERE id=lead;
  outcome := jsonb_build_object('label','Análise humana','actions',jsonb_build_array(
    jsonb_build_object('type','move_stage','stage_id',target),jsonb_build_object('type','note','text','not applied')));
  UPDATE public.wa_ai_agents SET outcomes=jsonb_build_array(outcome) WHERE id=agent;
  UPDATE public.wa_conversations SET ai_status='active',ai_status_changed_at=clock_timestamp() WHERE id=chat;
  moved := pg_temp.reserve_contract(chat,'6 minutes');
  PERFORM crm_internal.expire_zapsign_agent_confirmations();
  ASSERT (SELECT stage_id=target FROM public.deals WHERE id=lead), 'expected configured human stage';
  ASSERT (SELECT ai_status='paused' AND ai_resume_at IS NULL FROM public.wa_conversations WHERE id=chat);
  ASSERT EXISTS (SELECT 1 FROM public.wa_ai_agent_runs WHERE conversation_id=chat AND events @>
    jsonb_build_array(jsonb_build_object('signature_id',moved,'stage_id',target)));

  UPDATE public.deals SET stage_id=collecting WHERE id=lead;
  UPDATE public.wa_conversations SET ai_status='active',ai_status_changed_at=clock_timestamp() WHERE id=chat;
  already_moved := pg_temp.reserve_contract(chat,'6 minutes');
  UPDATE public.deals SET stage_id=another_stage WHERE id=lead;
  PERFORM crm_internal.expire_zapsign_agent_confirmations();
  ASSERT (SELECT stage_id=another_stage FROM public.deals WHERE id=lead), 'overwrote operator stage';

  FOREACH destination IN ARRAY ARRAY[terminal,gen_random_uuid()] LOOP
    UPDATE public.wa_ai_agents SET outcomes=jsonb_build_array(jsonb_set(outcome,'{actions,0,stage_id}',to_jsonb(destination))) WHERE id=agent;
    UPDATE public.wa_conversations SET ai_status='active',ai_status_changed_at=clock_timestamp() WHERE id=chat;
    invalid_move := pg_temp.reserve_contract(chat,'6 minutes');
    PERFORM crm_internal.expire_zapsign_agent_confirmations();
    ASSERT (SELECT stage_id=another_stage FROM public.deals WHERE id=lead), 'invalid or terminal destination accepted';
    ASSERT (SELECT ai_status='paused' AND ai_resume_at IS NULL FROM public.wa_conversations WHERE id=chat);
  END LOOP;
  UPDATE public.wa_ai_agents SET outcomes=jsonb_build_array(outcome,outcome) WHERE id=agent;
  UPDATE public.wa_conversations SET ai_status='active',ai_status_changed_at=clock_timestamp() WHERE id=chat;
  duplicate_outcome := pg_temp.reserve_contract(chat,'6 minutes');
  PERFORM crm_internal.expire_zapsign_agent_confirmations();
  ASSERT (SELECT stage_id=another_stage FROM public.deals WHERE id=lead), 'ambiguous outcome accepted';
  ASSERT (SELECT ai_status='paused' AND ai_resume_at IS NULL FROM public.wa_conversations WHERE id=chat);
  ASSERT NOT has_function_privilege('authenticated','crm_internal.expire_zapsign_agent_confirmations()','EXECUTE');
  ASSERT NOT EXISTS (SELECT 1 FROM public.wa_messages WHERE organization_id=org);
END $$;
ROLLBACK;
