-- Add deal_notes to supabase_realtime publication so INSERT/UPDATE/DELETE
-- events fan out to all connected clients. REPLICA IDENTITY FULL ensures
-- DELETE payloads include deal_id so handlers can target the right parent
-- deal without an extra round-trip.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deal_notes'
  ) then
    execute 'alter publication supabase_realtime add table public.deal_notes';
  end if;
end $$;

alter table public.deal_notes replica identity full;
