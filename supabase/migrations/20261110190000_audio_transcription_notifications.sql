alter table public.crm_notification_events drop constraint crm_notification_events_kind_check;
alter table public.crm_notification_events add constraint crm_notification_events_kind_check
  check (kind in ('message', 'lead', 'alert', 'audio_transcription'));

create unique index crm_notification_audio_once
  on public.crm_notification_events (organization_id, source_id)
  where kind = 'audio_transcription';
