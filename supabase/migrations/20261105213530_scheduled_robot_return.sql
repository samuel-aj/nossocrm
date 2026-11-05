-- Additive scheduling metadata; no existing conversations or histories are rewritten.
alter table public.wa_bot_runs
  add column scheduled_for timestamptz,
  add column scheduled_timezone text,
  add column scheduled_agent_id uuid,
  add column scheduled_connection_id uuid,
  add column scheduled_anchor timestamptz,
  add column scheduled_started_at timestamptz;
create unique index wa_bot_one_pending_return on public.wa_bot_runs(organization_id, conversation_id)
  where scheduled_for is not null and scheduled_started_at is null and status = 'running';

create function public.schedule_robot_return(p_org uuid,p_conversation uuid,p_agent uuid,p_bot uuid,p_at timestamptz,p_timezone text,p_anchor timestamptz,p_context text)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.wa_conversations; b public.wa_bots; a public.wa_ai_agents; previous public.wa_bot_runs; result uuid;
begin
  select * into c from public.wa_conversations where id=p_conversation and organization_id=p_org for update;
  if not found or c.ai_status is distinct from 'active' or c.ai_agent_id is distinct from p_agent or c.ai_approval is not null then raise exception 'Conversa indisponível para agendar'; end if;
  if p_at is null or p_at <= now() or p_at > now()+interval '90 days' then raise exception 'Data deve ser futura e dentro de 90 dias'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Fuso inválido'; end if;
  if p_context is null or length(btrim(p_context))=0 or length(p_context)>1000 then raise exception 'Contexto deve ter entre 1 e 1000 caracteres'; end if;
  if (select max(created_at) from public.wa_messages where organization_id=p_org and conversation_id=p_conversation and direction='in') is distinct from p_anchor then raise exception 'Cliente respondeu; confirme novamente'; end if;
  select * into a from public.wa_ai_agents where id=p_agent and organization_id=p_org and enabled;
  if not found or (a.tools->>'scheduled_return_bot_id') is distinct from p_bot::text then raise exception 'Robô não autorizado para este agente'; end if;
  select * into b from public.wa_bots where id=p_bot and organization_id=p_org and enabled;
  if not found or c.connection_id is null or not coalesce((
    coalesce(to_jsonb(b)->'connection_ids','[]'::jsonb) @> jsonb_build_array(c.connection_id::text)
    or (coalesce(to_jsonb(b)->'connection_ids','[]'::jsonb) in ('[]'::jsonb,'null'::jsonb)
      and (to_jsonb(b)->>'connection_id')=c.connection_id::text)
  ),false) then raise exception 'Robô não atende o número da conversa'; end if;
  select * into previous from public.wa_bot_runs where organization_id=p_org and conversation_id=p_conversation and scheduled_for is not null and scheduled_started_at is null and status='running' for update;
  if found and previous.scheduled_for=p_at and previous.bot_id=p_bot
    and previous.scheduled_agent_id=p_agent and previous.scheduled_connection_id=c.connection_id
    and previous.deal_id is not distinct from c.deal_id and previous.contact_id is not distinct from c.contact_id
    and previous.scheduled_timezone=p_timezone and previous.vars->>'contexto_extra'=p_context
    and previous.scheduled_anchor is not distinct from p_anchor then return previous.id; end if;
  if exists(select 1 from public.wa_bot_runs where organization_id=p_org and conversation_id=p_conversation and status in ('running','waiting_reply') and (scheduled_for is null or scheduled_started_at is not null or lock_until>now())) then raise exception 'Já existe um robô executando nesta conversa'; end if;
  update public.wa_bot_runs set status='cancelled',wake_at=null,updated_at=now(),error='Substituído por novo horário combinado' where id=previous.id and organization_id=p_org;
  insert into public.wa_bot_runs(organization_id,bot_id,conversation_id,contact_id,deal_id,phone,status,wake_at,analytics_version,is_test,vars,scheduled_for,scheduled_timezone,scheduled_agent_id,scheduled_connection_id,scheduled_anchor)
  values(p_org,p_bot,p_conversation,c.contact_id,c.deal_id,c.wa_phone,'running',p_at,1,false,jsonb_build_object('contexto_extra',left(coalesce(p_context,''),1000)),p_at,p_timezone,p_agent,c.connection_id,p_anchor) returning id into result;
  return result;
end $$;
revoke all on function public.schedule_robot_return(uuid,uuid,uuid,uuid,timestamptz,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.schedule_robot_return(uuid,uuid,uuid,uuid,timestamptz,text,timestamptz,text) to service_role;

create function public.cancel_scheduled_robot_return(p_org uuid,p_conversation uuid,p_agent uuid,p_anchor timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
declare c public.wa_conversations; affected integer;
begin
  select * into c from public.wa_conversations where id=p_conversation and organization_id=p_org for update;
  if not found or c.ai_status is distinct from 'active' or c.ai_agent_id is distinct from p_agent or c.ai_approval is not null then raise exception 'Conversa indisponível para cancelar'; end if;
  if (select max(created_at) from public.wa_messages where organization_id=p_org and conversation_id=p_conversation and direction='in') is distinct from p_anchor then raise exception 'Cliente respondeu; confirme novamente'; end if;
  update public.wa_bot_runs set status='cancelled',wake_at=null,updated_at=now(),error='Retorno cancelado a pedido do cliente'
    where organization_id=p_org and conversation_id=p_conversation and scheduled_agent_id=p_agent
      and scheduled_for is not null and scheduled_started_at is null and status='running';
  get diagnostics affected=row_count;
  return affected;
end $$;
revoke all on function public.cancel_scheduled_robot_return(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.cancel_scheduled_robot_return(uuid,uuid,uuid,timestamptz) to service_role;

create function public.cancel_unstarted_robot_return_on_reply() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.direction='in' then
    -- Same lock order as schedule/begin: conversation, then run. An inbound
    -- committed while scheduling cannot leave a stale pending return behind.
    perform 1 from public.wa_conversations where id=new.conversation_id and organization_id=new.organization_id for update;
    update public.wa_bot_runs set status='cancelled',wake_at=null,updated_at=now(),error='Cliente respondeu antes do retorno'
    where organization_id=new.organization_id and conversation_id=new.conversation_id and scheduled_for is not null and scheduled_started_at is null and status='running'
      and (scheduled_anchor is null or new.created_at>scheduled_anchor);
  end if;
  return new;
end $$;
revoke all on function public.cancel_unstarted_robot_return_on_reply() from public,anon,authenticated;
create trigger cancel_unstarted_robot_return_after_reply after insert on public.wa_messages for each row execute function public.cancel_unstarted_robot_return_on_reply();

create function public.begin_scheduled_robot_return(p_org uuid,p_run uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.wa_bot_runs; c public.wa_conversations;
begin
  select * into r from public.wa_bot_runs where id=p_run and organization_id=p_org;
  if not found or r.scheduled_for is null then return false; end if;
  select * into c from public.wa_conversations where id=r.conversation_id and organization_id=p_org for update;
  select * into r from public.wa_bot_runs where id=p_run and organization_id=p_org for update;
  if r.status is distinct from 'running' or r.scheduled_for>now() then return false; end if;
  -- Keep a due return pending while a response is being generated. The worker
  -- releases its lease and retries; no cancellation or timestamp rewrite.
  if r.scheduled_started_at is null and c.ai_lock_until>now() then return false; end if;
  if r.scheduled_started_at is not null then return true; end if;
  if c.ai_status is distinct from 'active' or c.ai_approval is not null or c.ai_agent_id is distinct from r.scheduled_agent_id or c.connection_id is distinct from r.scheduled_connection_id
    or c.deal_id is distinct from r.deal_id or c.contact_id is distinct from r.contact_id
    or (select max(created_at) from public.wa_messages where organization_id=p_org and conversation_id=r.conversation_id and direction='in') is distinct from r.scheduled_anchor then
    update public.wa_bot_runs set status='cancelled',wake_at=null,error='Conversa mudou antes do retorno',updated_at=now() where id=p_run;
    return false;
  end if;
  update public.wa_bot_runs set scheduled_started_at=now(),updated_at=now(),
    vars=coalesce(vars,'{}'::jsonb)||jsonb_build_object('__proactive_followup',
      jsonb_build_object('anchor',r.scheduled_anchor,'scheduledReturnId',r.id)) where id=p_run and organization_id=p_org;
  return true;
end $$;
revoke all on function public.begin_scheduled_robot_return(uuid,uuid) from public,anon,authenticated;
grant execute on function public.begin_scheduled_robot_return(uuid,uuid) to service_role;
