alter table public.crm_notification_events drop constraint crm_notification_events_kind_check;
alter table public.crm_notification_events add constraint crm_notification_events_kind_check
  check (kind in ('message', 'lead', 'alert', 'audio_transcription', 'human_handoff'));

-- A completed handoff writes one bell event with the same transaction as its run.
create or replace function crm_internal.notify_human_handoff()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.crm_notification_events (organization_id, kind, source_id)
  values (new.organization_id, 'human_handoff', new.conversation_id);
  return new;
end;
$$;
revoke all on function crm_internal.notify_human_handoff() from public;
create trigger notify_human_handoff after insert on public.wa_ai_agent_runs
for each row when (new.conversation_id is not null and new.trigger <> 'test'
  and new.events @> '[{"type":"human_handoff"}]'::jsonb)
execute function crm_internal.notify_human_handoff();
