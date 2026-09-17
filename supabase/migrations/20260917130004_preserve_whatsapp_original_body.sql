-- Keep the first text before an edit, atomically, for all incoming/outgoing paths.
alter table public.wa_messages add column if not exists original_body text;

create or replace function public.preserve_wa_message_original_body()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if old.original_body is not null then
    new.original_body := old.original_body;
  elsif new.edited_at is not null and new.body is distinct from old.body then
    new.original_body := old.body;
  else
    new.original_body := old.original_body;
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_wa_message_original_body() from public, anon, authenticated;
drop trigger if exists preserve_wa_message_original_body on public.wa_messages;
create trigger preserve_wa_message_original_body
before update on public.wa_messages
for each row execute function public.preserve_wa_message_original_body();
