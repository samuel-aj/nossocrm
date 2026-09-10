-- Each pin belongs to one user and board. General and period defaults are independent.
create table public.user_board_filters (
  user_id uuid not null references auth.users(id) on delete cascade,
  board_id uuid not null references public.boards(id) on delete cascade,
  period jsonb,
  general jsonb,
  primary key (user_id, board_id),
  constraint period_object check (period is null or jsonb_typeof(period) = 'object'),
  constraint general_object check (general is null or jsonb_typeof(general) = 'object')
);
alter table public.user_board_filters enable row level security;
revoke all on public.user_board_filters from anon;
grant select, insert, update, delete on public.user_board_filters to authenticated;
grant all on public.user_board_filters to service_role;
create policy own_board_filters on public.user_board_filters for all to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.boards b where b.id = board_id and public.vis_can_see_board(b.organization_id, b.id)))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.boards b where b.id = board_id and public.vis_can_see_board(b.organization_id, b.id)));
