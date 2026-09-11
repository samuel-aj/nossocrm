-- Run inside BEGIN/ROLLBACK against staging only; changes cannot escape the test.
DO $$
DECLARE d public.deals; b public.boards; q uuid; proposal uuid; entry uuid;
  qualified_time timestamptz; closed_time timestamptz; n integer;
BEGIN
  SELECT * INTO STRICT b FROM public.boards WHERE id='bb7b7e2b-2818-4579-ae20-bf052e51cf41';
  SELECT id INTO STRICT entry FROM public.board_stages WHERE board_id=b.id AND "order"=0;
  SELECT id INTO STRICT q FROM public.board_stages WHERE board_id=b.id AND "order"=2;
  SELECT id INTO STRICT proposal FROM public.board_stages WHERE board_id=b.id AND "order"=3;
  INSERT INTO public.deals(title,organization_id,board_id,stage_id,status,owner_id)
    VALUES('TESTE TRANSACIONAL lifecycle',b.organization_id,b.id,entry,entry::text,b.owner_id) RETURNING * INTO d;
  ASSERT d.qualified_at IS NULL, 'Entry must not qualify';
  UPDATE public.deals SET stage_id=proposal WHERE id=d.id RETURNING * INTO d;
  ASSERT d.qualified_at IS NOT NULL AND d.qualification_date_source='transition', 'Skip over SQL must qualify';
  qualified_time:=d.qualified_at;
  UPDATE public.deals SET stage_id=entry WHERE id=d.id RETURNING * INTO d;
  ASSERT d.qualified_at=qualified_time AND d.closed_at IS NULL, 'Regression preserves first qualification';
  UPDATE public.deals SET stage_id=q WHERE id=d.id RETURNING * INTO d;
  ASSERT d.qualified_at=qualified_time, 'Requalification must not overwrite first date';
  UPDATE public.deals SET stage_id=b.won_stage_id WHERE id=d.id RETURNING * INTO d;
  ASSERT d.is_won AND NOT d.is_lost AND d.closed_at IS NOT NULL, 'Stage-only win must close';
  closed_time:=d.closed_at;
  UPDATE public.deals SET closed_at=now()+interval '1 day',title='TESTE edição' WHERE id=d.id RETURNING * INTO d;
  ASSERT d.closed_at=closed_time, 'Editing closed deal must not reset closure';
  UPDATE public.deals SET stage_id=proposal WHERE id=d.id RETURNING * INTO d;
  ASSERT NOT d.is_won AND NOT d.is_lost AND d.closed_at IS NULL, 'Stage-only reopening clears closure';
  UPDATE public.deals SET stage_id=b.lost_stage_id,loss_category='qualified',loss_reason='Teste' WHERE id=d.id RETURNING * INTO d;
  ASSERT d.is_lost AND NOT d.is_won AND d.closed_at IS NOT NULL, 'Loss stage must close';
  UPDATE public.deals SET is_won=false,is_lost=false WHERE id=d.id RETURNING * INTO d;
  ASSERT d.closed_at IS NULL AND d.loss_category IS NULL AND d.loss_reason IS NULL, 'Explicit reopen clears loss and closure';
  UPDATE public.deals SET stage_id=proposal WHERE id=d.id;
  UPDATE public.deals SET is_won=true WHERE id=d.id RETURNING * INTO d;
  ASSERT d.closed_at IS NOT NULL, 'Flag-only win must close';
  UPDATE public.deals SET is_won=false,is_lost=true WHERE id=d.id RETURNING * INTO d;
  ASSERT d.closed_at IS NOT NULL, 'Flag-only loss must close';
  SELECT count(*) INTO n FROM public.deal_stage_events WHERE deal_id=d.id;
  ASSERT n=8, 'All stage arrivals and returns must remain in history';
  ASSERT NOT has_function_privilege('authenticated','crm_internal.sync_deal_lifecycle_dates()','execute'), 'No client trigger RPC';
  ASSERT NOT has_function_privilege('anon','crm_internal.deal_stage_rules(uuid,uuid,uuid)','execute'), 'No public privileged lookup';
END;
$$;
SELECT 'lifecycle assertions passed' AS result;
