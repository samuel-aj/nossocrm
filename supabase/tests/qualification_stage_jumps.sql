-- Staging only. Everything is rolled back, including automation queues.
BEGIN;
DO $$
DECLARE
  org uuid := gen_random_uuid();
  board uuid := gen_random_uuid();
  entry uuid := gen_random_uuid();
  qualifying uuid := gen_random_uuid();
  qualified uuid := gen_random_uuid();
  meeting uuid := gen_random_uuid();
  contract uuid := gen_random_uuid();
  lost uuid := gen_random_uuid();
  origin uuid;
  destination uuid;
  lead public.deals;
  first_date timestamptz;
BEGIN
  INSERT INTO public.organizations(id,name) VALUES(org,'QA transactional qualification');
  INSERT INTO public.boards(id,organization_id,name) VALUES(board,org,'QA qualification');
  INSERT INTO public.board_stages(id,organization_id,board_id,name,label,"order",linked_lifecycle_stage) VALUES
    (entry,org,board,'Novo Lead','Novo Lead',0,'LEAD'),
    (qualifying,org,board,'Em qualificação','Em qualificação',1,'LEAD'),
    (qualified,org,board,'Qualificado','Qualificado',2,'SALES_QUALIFIED'),
    (meeting,org,board,'Reunião agendada','Reunião agendada',3,'PROSPECT'),
    (contract,org,board,'Contratado','Contratado',4,'CUSTOMER'),
    (lost,org,board,'Perdido','Perdido',5,'OTHER');
  UPDATE public.boards SET won_stage_id=contract,lost_stage_id=lost WHERE id=board;
  FOREACH origin IN ARRAY ARRAY[entry,qualifying] LOOP
    FOREACH destination IN ARRAY ARRAY[qualified,meeting,contract] LOOP
      INSERT INTO public.deals(organization_id,board_id,stage_id,title)
        VALUES(org,board,origin,'QA salto '||destination) RETURNING * INTO lead;
      ASSERT lead.qualified_at IS NULL, 'Pre-qualification must have no date';
      UPDATE public.deals SET stage_id=destination WHERE id=lead.id RETURNING * INTO lead;
      ASSERT lead.qualified_at=transaction_timestamp(), 'Direct advance must qualify on movement date';
      ASSERT lead.qualification_date_source='transition', 'New advance is observed, not estimated';
      first_date := lead.qualified_at;
      UPDATE public.deals SET stage_id=entry WHERE id=lead.id RETURNING * INTO lead;
      ASSERT lead.qualified_at=first_date, 'Regression must preserve the first date';
      UPDATE public.deals SET stage_id=meeting WHERE id=lead.id RETURNING * INTO lead;
      ASSERT lead.qualified_at=first_date, 'Second advance must not requalify';
    END LOOP;
  END LOOP;
  INSERT INTO public.deals(organization_id,board_id,stage_id,title)
    VALUES(org,board,lost,'QA desqualificado') RETURNING * INTO lead;
  ASSERT lead.qualified_at IS NULL, 'Lost is not a qualifying stage just because it is last';
END;
$$;
ROLLBACK;
