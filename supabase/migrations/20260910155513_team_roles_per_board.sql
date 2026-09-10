-- Master is deliberately nullable. Only the technical super admin assigns it.
create schema if not exists private;
create table public.org_team_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  master_user_id uuid references public.profiles(id), updated_at timestamptz not null default now()
);
create table public.team_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check(length(trim(name)) between 1 and 80),
  description text not null default '', boards jsonb not null default '[]' check(jsonb_typeof(boards)='array'),
  updated_at timestamptz not null default now(), unique(organization_id,id), unique(organization_id,name)
);
create table public.team_role_assignments (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid, legacy boolean not null default false,
  primary key(organization_id,user_id),
  foreign key(organization_id,role_id) references public.team_roles(organization_id,id),
  check(not legacy or role_id is null)
);
create table public.team_access_audit (
  id bigint generated always as identity primary key,
  organization_id uuid not null, actor_id uuid not null, action text not null,
  details jsonb not null, created_at timestamptz not null default now()
);
alter table public.org_team_settings enable row level security;
alter table public.team_roles enable row level security;
alter table public.team_role_assignments enable row level security;
alter table public.team_access_audit enable row level security;
revoke all on public.org_team_settings, public.team_roles, public.team_role_assignments, public.team_access_audit from anon, authenticated;
grant all on public.org_team_settings, public.team_roles, public.team_role_assignments, public.team_access_audit to service_role;
grant usage, select on sequence public.team_access_audit_id_seq to service_role;
-- A snapshot marker preserves existing users' rules; new users start with no access.
insert into public.team_role_assignments(organization_id,user_id,legacy)
select organization_id,id,true from public.profiles where organization_id is not null
union select organization_id,user_id,true from public.user_organizations
on conflict do nothing;

create or replace function private.team_org_role(o uuid, u uuid) returns text
language sql stable security definer set search_path='' as $$
  select case when p.role='super_admin' then 'super_admin'
    when exists(select 1 from public.org_team_settings s where s.organization_id=o and s.master_user_id=u) then 'admin'
    else coalesce((select m.role from public.user_organizations m where m.organization_id=o and m.user_id=u limit 1),
      case when p.organization_id=o then p.role end) end
  from public.profiles p where p.id=u
$$;

create or replace function private.team_board_rule(o uuid,u uuid,b uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.team_role_assignments; r jsonb; v jsonb;
begin
  if private.team_org_role(o,u) is null then return null; end if;
  if private.team_org_role(o,u) in ('admin','super_admin') then
    return jsonb_build_object('boardId',b,'scope','all','create',true,'edit',true,'move',true,'delete',true);
  end if;
  select * into a from public.team_role_assignments where organization_id=o and user_id=u;
  if not found then return null; end if;
  if a.legacy then
    select rules into v from public.user_visibility_rules where organization_id=o and user_id=u;
    if v#>'{boards,board_ids}' is not null and v#>'{boards,board_ids}' <> 'null'::jsonb
      and not (v#>'{boards,board_ids}' ? b::text) then return null; end if;
    return jsonb_build_object('boardId',b,'scope',coalesce(v#>>'{deals,scope}','all'),
      'team',coalesce(v#>'{deals,team_user_ids}','[]'::jsonb),
      'create',coalesce((v#>>'{actions,deals,create}')::boolean,true),
      'edit',coalesce((v#>>'{actions,deals,edit}')::boolean,true),
      'move',coalesce((v#>>'{actions,deals,move}')::boolean,true),
      'delete',coalesce((v#>>'{actions,deals,delete}')::boolean,true));
  end if;
  select item into r from public.team_roles t cross join lateral jsonb_array_elements(t.boards) item
    where t.organization_id=o and t.id=a.role_id and item->>'boardId'=b::text limit 1;
  return r;
end $$;

create or replace function private.team_lead_allowed(o uuid,u uuid,b uuid,owner uuid,act text default 'view') returns boolean
language plpgsql stable security definer set search_path='' as $$
declare r jsonb;
begin
  r := private.team_board_rule(o,u,b);
  if r is null then return false; end if;
  if not coalesce((r->>'scope'='all' or owner=u or (r->>'scope'='team' and r->'team' ? owner::text)),false) then return false; end if;
  return act='view' or coalesce((r->>act)::boolean,false);
end $$;

create or replace function private.team_deal_allowed(d uuid,act text default 'view') returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select private.team_lead_allowed(organization_id,auth.uid(),board_id,owner_id,act)
    from public.deals where id=d),false)
$$;

create or replace function private.team_unlinked_contact_allowed(o uuid,c uuid,owner uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(owner=auth.uid(),false)
   and not exists(select 1 from public.deals where contact_id=c and organization_id=o)
   and exists(select 1 from public.boards b where b.organization_id=o and
     coalesce((private.team_board_rule(o,auth.uid(),b.id)->>'create')::boolean,false))
$$;
create or replace function private.team_contact_allowed(o uuid,c uuid,act text default 'view') returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v jsonb; legacy_access boolean; u uuid := auth.uid();
begin
  if private.team_org_role(o,u) is null then return false; end if;
  if private.team_org_role(o,u) in ('admin','super_admin') then return true; end if;
  select legacy into legacy_access from public.team_role_assignments where organization_id=o and user_id=u;
  select rules into v from public.user_visibility_rules where organization_id=o and user_id=u;
  if legacy_access and not coalesce((v#>>array['actions','contacts',act])::boolean,true) then return false; end if;
  if act='create' then
    return exists(select 1 from public.boards b where b.organization_id=o and
      coalesce((private.team_board_rule(o,u,b.id)->>'create')::boolean,false));
  end if;
  if legacy_access and not exists(select 1 from public.deals d where d.contact_id=c and d.organization_id=o) then return true; end if;
  if exists(select 1 from public.contacts where id=c and organization_id=o and private.team_unlinked_contact_allowed(o,c,owner_id)) then return true; end if;
  if act <> 'view' and exists(select 1 from public.deals d where d.contact_id=c and d.organization_id=o
    and not private.team_lead_allowed(o,u,d.board_id,d.owner_id,act)) then return false; end if;
  return exists(select 1 from public.deals d where d.contact_id=c and d.organization_id=o
    and private.team_lead_allowed(o,u,d.board_id,d.owner_id,act));
end $$;

-- Replace permissive legacy visibility helpers so all callers share the same rule.
create or replace function public.vis_can_see_board(p_org uuid,p_board uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is null or private.team_board_rule(p_org,auth.uid(),p_board) is not null
$$;
drop policy if exists vis_deals_select on public.deals;
create policy team_deals_select on public.deals as restrictive for select to authenticated
using(private.team_lead_allowed(organization_id,auth.uid(),board_id,owner_id));
create policy team_deals_write on public.deals as restrictive for all to authenticated
using(private.team_lead_allowed(organization_id,auth.uid(),board_id,owner_id))
with check(private.team_lead_allowed(organization_id,auth.uid(),board_id,owner_id));
create policy team_contacts_scope on public.contacts as restrictive for select to authenticated
using(private.team_contact_allowed(organization_id,id) or private.team_unlinked_contact_allowed(organization_id,id,owner_id));
create policy team_items_scope on public.deal_items as restrictive for all to authenticated
using(private.team_deal_allowed(deal_id)) with check(private.team_deal_allowed(deal_id,'edit'));
create policy team_notes_scope on public.deal_notes as restrictive for all to authenticated
using(private.team_deal_allowed(deal_id)) with check(private.team_deal_allowed(deal_id,'edit'));
create policy team_activities_scope on public.activities as restrictive for all to authenticated
using(case when deal_id is not null then private.team_deal_allowed(deal_id)
  else private.team_org_role(organization_id,auth.uid()) in ('admin','super_admin') end)
with check(case when deal_id is not null then private.team_deal_allowed(deal_id,'edit')
  else private.team_org_role(organization_id,auth.uid()) in ('admin','super_admin') end);

create or replace function public.vis_guard_deals() returns trigger
language plpgsql security definer set search_path='' as $$
declare u uuid := auth.uid();
begin
 if u is null then return coalesce(new,old); end if;
 if tg_op='INSERT' then
   if private.team_board_rule(new.organization_id,u,new.board_id)->>'scope'='own' then new.owner_id:=u; end if;
   if not private.team_lead_allowed(new.organization_id,u,new.board_id,new.owner_id,'create') then raise exception 'Sem permissão para criar lead' using errcode='42501'; end if;
 elsif tg_op='DELETE' then
   if not private.team_lead_allowed(old.organization_id,u,old.board_id,old.owner_id,'delete') then raise exception 'Sem permissão para excluir lead' using errcode='42501'; end if;
 else
   if old.organization_id is distinct from new.organization_id then raise exception 'Organização não pode ser alterada' using errcode='42501'; end if;
   if not private.team_lead_allowed(old.organization_id,u,old.board_id,old.owner_id) or
      not private.team_lead_allowed(new.organization_id,u,new.board_id,new.owner_id) then raise exception 'Lead fora do seu acesso' using errcode='42501'; end if;
   if old.deleted_at is distinct from new.deleted_at and not private.team_lead_allowed(old.organization_id,u,old.board_id,old.owner_id,'delete') then raise exception 'Sem permissão para excluir lead' using errcode='42501'; end if;
   if (old.stage_id is distinct from new.stage_id or old.board_id is distinct from new.board_id)
     and (not private.team_lead_allowed(old.organization_id,u,old.board_id,old.owner_id,'move') or not private.team_lead_allowed(new.organization_id,u,new.board_id,new.owner_id,'move')) then raise exception 'Sem permissão para mover lead' using errcode='42501'; end if;
   if (to_jsonb(old)-array['stage_id','status','board_id','updated_at','deleted_at']) is distinct from (to_jsonb(new)-array['stage_id','status','board_id','updated_at','deleted_at'])
     and not private.team_lead_allowed(old.organization_id,u,old.board_id,old.owner_id,'edit') then raise exception 'Sem permissão para editar lead' using errcode='42501'; end if;
 end if;
 if tg_op <> 'DELETE' then
   if not exists(select 1 from public.boards where id=new.board_id and organization_id=new.organization_id) then raise exception 'Funil inválido' using errcode='42501'; end if;
   if new.stage_id is not null and not exists(select 1 from public.board_stages where id=new.stage_id and board_id=new.board_id) then raise exception 'Etapa fora do funil' using errcode='42501'; end if;
   if new.contact_id is not null and (tg_op='INSERT' or new.contact_id is distinct from old.contact_id) and not private.team_contact_allowed(new.organization_id,new.contact_id) then raise exception 'Contato fora do seu acesso' using errcode='42501'; end if;
   if new.owner_id is not null and (tg_op='INSERT' or old.owner_id is distinct from new.owner_id) and
     (private.team_org_role(new.organization_id,new.owner_id) is null or exists(select 1 from public.profiles where id=new.owner_id and role='super_admin')) then raise exception 'Responsável inválido' using errcode='42501'; end if;
 end if;
 return coalesce(new,old);
end $$;
create or replace function public.vis_guard_contacts() returns trigger
language plpgsql security definer set search_path='' as $$
declare act text;
begin
 if auth.uid() is null then return coalesce(new,old); end if;
 if tg_op='INSERT' then new.owner_id:=auth.uid(); end if;
 act:=case when tg_op='INSERT' then 'create' when tg_op='DELETE' then 'delete' when old.deleted_at is distinct from new.deleted_at then 'delete' else 'edit' end;
 if tg_op='UPDATE' and old.organization_id is distinct from new.organization_id then raise exception 'Organização não pode ser alterada' using errcode='42501'; end if;
 if not private.team_contact_allowed(coalesce(new.organization_id,old.organization_id),coalesce(new.id,old.id),act) then raise exception 'Sem permissão para alterar contato' using errcode='42501'; end if;
 return coalesce(new,old);
end $$;

-- Profiles are self-editable; prevent changing one's own authority through REST.
create function private.team_guard_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null and old.role is distinct from new.role then raise exception 'Papel deve ser alterado pela gestão da equipe' using errcode='42501'; end if;
 if auth.uid() is not null and old.organization_id is distinct from new.organization_id and
   not exists(select 1 from public.user_organizations where user_id=auth.uid() and organization_id=new.organization_id)
   and old.role <> 'super_admin' then raise exception 'Organização sem vínculo' using errcode='42501'; end if;
 return new;
end $$;
create trigger team_guard_profile before update on public.profiles for each row execute function private.team_guard_profile();

create function private.team_is_manager(o uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='super_admin')
 or exists(select 1 from public.org_team_settings where organization_id=o and master_user_id=auth.uid())
$$;
create policy team_invites_management on public.organization_invites as restrictive for all to authenticated
using(private.team_is_manager(organization_id)) with check(private.team_is_manager(organization_id));
create function private.team_guard_membership() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.org_team_settings where organization_id=old.organization_id and master_user_id=old.user_id)
   and (tg_op='DELETE' or new.role <> 'admin' or new.organization_id is distinct from old.organization_id or new.user_id is distinct from old.user_id)
 then raise exception 'Transfira a função de Mestre antes de alterar este vínculo' using errcode='42501'; end if;
 return coalesce(new,old);
end $$;
create trigger team_guard_membership before update or delete on public.user_organizations for each row execute function private.team_guard_membership();

-- Child records must not expose leads hidden by the parent policy.
create policy team_events_scope on public.deal_stage_events as restrictive for select to authenticated using(private.team_deal_allowed(deal_id));
create policy team_files_scope on public.deal_files as restrictive for all to authenticated
using(private.team_deal_allowed(deal_id)) with check(private.team_deal_allowed(deal_id,'edit'));
create function private.team_guard_child() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return coalesce(new,old); end if;
 if tg_op <> 'INSERT' and old.deal_id is not null and not private.team_deal_allowed(old.deal_id,'edit') then raise exception 'Sem permissão para alterar dados deste lead' using errcode='42501'; end if;
 if tg_op <> 'DELETE' and new.deal_id is not null and not private.team_deal_allowed(new.deal_id,'edit') then raise exception 'Sem permissão para alterar dados deste lead' using errcode='42501'; end if;
 return coalesce(new,old);
end $$;
create trigger team_guard_items before insert or update or delete on public.deal_items for each row execute function private.team_guard_child();
create trigger team_guard_notes before insert or update or delete on public.deal_notes for each row execute function private.team_guard_child();
create trigger team_guard_files before insert or update or delete on public.deal_files for each row execute function private.team_guard_child();
create trigger team_guard_activities before insert or update or delete on public.activities for each row execute function private.team_guard_child();
alter function public.get_dashboard_stats() security invoker;
alter function public.mark_deal_won(uuid) security invoker;
alter function public.mark_deal_lost(uuid,text) security invoker;
alter function public.reopen_deal(uuid) security invoker;

-- Only service_role may call these endpoints; HTTP handlers authenticate actor_id.
create function public.team_effective_access(p_org uuid,p_user uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('fullAccess',coalesce(private.team_org_role(p_org,p_user) in ('admin','super_admin'),false),
 'masterUserId',(select master_user_id from public.org_team_settings where organization_id=p_org),
 'canManage',exists(select 1 from public.org_team_settings where organization_id=p_org and master_user_id=p_user)
   or exists(select 1 from public.profiles where id=p_user and role='super_admin'),
 'legacy',coalesce((select legacy from public.team_role_assignments where organization_id=p_org and user_id=p_user),false),
 'boards',coalesce((select jsonb_agg(private.team_board_rule(p_org,p_user,b.id)) from public.boards b
   where b.organization_id=p_org and private.team_board_rule(p_org,p_user,b.id) is not null),'[]'::jsonb))
$$;

create function public.team_manage(p_org uuid,p_actor uuid,p_action text,p_data jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare super boolean; master uuid; target uuid; rid uuid; previous uuid;
begin
 -- Serialize all management operations, including first master assignment.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,42));
 select role='super_admin' into super from public.profiles where id=p_actor;
 select master_user_id into master from public.org_team_settings where organization_id=p_org;
 if not coalesce(super,false) and master is distinct from p_actor then raise exception 'Somente o Mestre pode gerenciar a equipe' using errcode='42501'; end if;
 if p_action='master' then
   if not coalesce(super,false) then raise exception 'Somente super admin pode definir o Mestre' using errcode='42501'; end if;
   target := (p_data->>'userId')::uuid;
   if private.team_org_role(p_org,target) is null or exists(select 1 from public.profiles where id=target and role='super_admin') then raise exception 'Membro inválido'; end if;
   previous:=master;
   insert into public.org_team_settings(organization_id,master_user_id) values(p_org,target)
     on conflict(organization_id) do update set master_user_id=excluded.master_user_id,updated_at=now();
   insert into public.user_organizations(organization_id,user_id,role) values(p_org,target,'admin')
     on conflict(user_id,organization_id) do update set role='admin';
   update public.profiles set role='admin' where id=target and organization_id=p_org;
   if previous is not null then
     insert into public.user_organizations(organization_id,user_id,role) values(p_org,previous,'admin')
       on conflict(user_id,organization_id) do update set role='admin';
   end if;
 elsif p_action='saveRole' then
   rid:=coalesce((p_data->>'id')::uuid,gen_random_uuid());
   if exists(select 1 from jsonb_array_elements(p_data->'boards') b where not exists(select 1 from public.boards where id=(b->>'boardId')::uuid and organization_id=p_org)) then raise exception 'Funil inválido'; end if;
   insert into public.team_roles(id,organization_id,name,description,boards)
     values(rid,p_org,p_data->>'name',coalesce(p_data->>'description',''),p_data->'boards')
     on conflict(id) do update set name=excluded.name,description=excluded.description,boards=excluded.boards,updated_at=now()
     where team_roles.organization_id=p_org;
 elsif p_action='deleteRole' then
   delete from public.team_roles where id=(p_data->>'id')::uuid and organization_id=p_org;
 elsif p_action='assign' then
   target:=(p_data->>'userId')::uuid; rid:=(p_data->>'roleId')::uuid;
   if target=master then raise exception 'Transfira a função de Mestre antes de alterar este membro'; end if;
   if private.team_org_role(p_org,target) is null or exists(select 1 from public.profiles where id=target and role='super_admin') then raise exception 'Membro inválido'; end if;
   if p_data->>'kind' not in ('admin','vendedor') then raise exception 'Papel inválido'; end if;
   insert into public.user_organizations(organization_id,user_id,role) values(p_org,target,p_data->>'kind')
     on conflict(user_id,organization_id) do update set role=excluded.role;
   update public.profiles set role=p_data->>'kind' where id=target and organization_id=p_org;
   insert into public.team_role_assignments(organization_id,user_id,role_id,legacy) values(p_org,target,rid,false)
     on conflict(organization_id,user_id) do update set role_id=excluded.role_id,legacy=false;
 else raise exception 'Ação inválida'; end if;
 insert into public.team_access_audit(organization_id,actor_id,action,details) values(p_org,p_actor,p_action,p_data);
end $$;
revoke all on function public.team_effective_access(uuid,uuid),public.team_manage(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.team_effective_access(uuid,uuid),public.team_manage(uuid,uuid,text,jsonb) to service_role;
revoke all on all functions in schema private from public,anon;
grant usage on schema private to authenticated,service_role;
grant execute on all functions in schema private to authenticated,service_role;
notify pgrst,'reload schema';
