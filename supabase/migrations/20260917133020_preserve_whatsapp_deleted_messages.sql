alter table public.wa_messages add column if not exists deleted_at timestamptz;
-- A delayed echo/edit must never revive deleted content or remove its marker.
create or replace function public.preserve_wa_message_deletion()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.deleted_at is not null then
    new.deleted_at := old.deleted_at;
    new.body := old.body;
    new.original_body := old.original_body;
    new.edited_at := old.edited_at;
    new.media_type := old.media_type;
    new.media_url := old.media_url;
    new.transcription := old.transcription;
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_wa_message_deletion() from public, anon, authenticated;
create trigger preserve_wa_message_deletion before update on public.wa_messages
for each row execute function public.preserve_wa_message_deletion();
