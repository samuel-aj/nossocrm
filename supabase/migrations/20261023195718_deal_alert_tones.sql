-- Ordinary lead alerts can be green (notice) or red (attention).
-- Existing active_alert JSON is left untouched; readers default missing tone to green.
alter table public.deal_alert_events
  add column tone text not null default 'green'
  constraint deal_alert_events_tone_check check (tone in ('green', 'red'));

-- A separate name keeps both old six-argument clients and PostgREST resolution unambiguous.
create function public.activate_deal_alert_with_tone(
  p_org uuid, p_deal uuid, p_bot uuid, p_run uuid, p_block text, p_message text, p_tone text
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare d public.deals; a public.deal_alert_events;
begin
  if p_tone is null or p_tone not in ('green', 'red') then
    raise exception 'Invalid lead alert tone' using errcode='22023';
  end if;
  select * into d from public.deals
    where id=p_deal and organization_id=p_org and deleted_at is null for update;
  if not found then raise exception 'Lead not found'; end if;
  if not exists(select 1 from public.wa_bot_runs
    where id=p_run and organization_id=p_org and bot_id=p_bot and deal_id=p_deal) then
    raise exception 'Run does not belong to lead';
  end if;
  insert into public.deal_alert_events(organization_id,deal_id,bot_id,run_id,block_id,message,tone)
    values(p_org,p_deal,p_bot,p_run,p_block,btrim(p_message),p_tone)
    on conflict(run_id,block_id) do nothing returning * into a;
  -- Retries preserve the first event, including its tone and acknowledgement.
  if not found then
    return (select id from public.deal_alert_events where run_id=p_run and block_id=p_block);
  end if;
  update public.deals set active_alert=jsonb_build_object(
    'id',a.id,'message',a.message,'tone',a.tone,'bot_id',p_bot,'run_id',p_run,
    'block_id',p_block,'created_at',a.created_at
  ) where id=p_deal and organization_id=p_org;
  insert into public.crm_notification_events(organization_id,kind,source_id,board_id)
    values(p_org,'alert',a.id,d.board_id);
  return a.id;
end $$;

create or replace function public.activate_deal_alert(
  p_org uuid,p_deal uuid,p_bot uuid,p_run uuid,p_block text,p_message text
) returns uuid language sql security invoker set search_path = '' as $$
  select public.activate_deal_alert_with_tone(p_org,p_deal,p_bot,p_run,p_block,p_message,'green');
$$;

revoke all on function public.activate_deal_alert_with_tone(uuid,uuid,uuid,uuid,text,text,text),
  public.activate_deal_alert(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.activate_deal_alert_with_tone(uuid,uuid,uuid,uuid,text,text,text),
  public.activate_deal_alert(uuid,uuid,uuid,uuid,text,text) to service_role;
