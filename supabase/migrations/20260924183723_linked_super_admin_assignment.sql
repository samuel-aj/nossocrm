-- Operational membership is distinct from global super-admin access.
-- Visiting an organization does not make a super admin assignable there.
create function private.team_is_org_member(o uuid,u uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p where p.id=u and (
   exists(select 1 from public.user_organizations m where m.organization_id=o and m.user_id=u)
   or (p.role <> 'super_admin' and p.organization_id=o)
 ));
$$;
revoke all on function private.team_is_org_member(uuid,uuid) from public,anon,authenticated;
grant execute on function private.team_is_org_member(uuid,uuid) to service_role;

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
   if new.contact_id is not null and (tg_op='INSERT' or new.contact_id is distinct from old.contact_id) and (not exists(select 1 from public.contacts where id=new.contact_id and organization_id=new.organization_id) or not private.team_contact_allowed(new.organization_id,new.contact_id)) then raise exception 'Contato fora do seu acesso' using errcode='42501'; end if;
   if new.owner_id is not null and (tg_op='INSERT' or old.owner_id is distinct from new.owner_id) and
     not private.team_is_org_member(new.organization_id,new.owner_id) then raise exception 'Responsável inválido' using errcode='42501'; end if;
 end if;
 return coalesce(new,old);
end $$;

create or replace function public.team_manage(p_org uuid,p_actor uuid,p_action text,p_data jsonb) returns void
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
   if not private.team_is_org_member(p_org,target) then raise exception 'Membro inválido'; end if;
   previous:=master;
   insert into public.org_team_settings(organization_id,master_user_id) values(p_org,target)
     on conflict(organization_id) do update set master_user_id=excluded.master_user_id,updated_at=now();
   insert into public.user_organizations(organization_id,user_id,role) values(p_org,target,'admin')
     on conflict(user_id,organization_id) do update set role='admin';
   update public.profiles set role='admin' where id=target and organization_id=p_org and role <> 'super_admin';
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
   if not private.team_is_org_member(p_org,target) then raise exception 'Membro inválido'; end if;
   if p_data->>'kind' not in ('admin','vendedor') then raise exception 'Papel inválido'; end if;
   insert into public.user_organizations(organization_id,user_id,role) values(p_org,target,p_data->>'kind')
     on conflict(user_id,organization_id) do update set role=excluded.role;
   update public.profiles set role=p_data->>'kind' where id=target and organization_id=p_org and role <> 'super_admin';
   insert into public.team_role_assignments(organization_id,user_id,role_id,legacy) values(p_org,target,rid,false)
     on conflict(organization_id,user_id) do update set role_id=excluded.role_id,legacy=false;
 else raise exception 'Ação inválida'; end if;
 insert into public.team_access_audit(organization_id,actor_id,action,details) values(p_org,p_actor,p_action,p_data);
end $$;

CREATE OR REPLACE FUNCTION public.assign_deal_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
  v_enabled boolean;
  v_manual boolean;
  v_since timestamptz;
BEGIN
  -- Responsável definido na origem manda: nunca sobrescreve.
  IF NEW.owner_id IS NOT NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.lead_distribution_enabled, s.lead_distribution_manual, s.lead_distribution_since
    INTO v_enabled, v_manual, v_since
    FROM public.organization_settings s
   WHERE s.organization_id = NEW.organization_id;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN NEW;
  END IF;

  -- auth.uid() nulo = insert de integração (service role: API pública, n8n,
  -- webhooks). Com usuário logado é criação dentro do CRM, que só entra no
  -- rodízio quando a organização pede.
  IF auth.uid() IS NOT NULL AND NOT COALESCE(v_manual, false) THEN
    RETURN NEW;
  END IF;

  SELECT d.user_id
    INTO v_user
    FROM public.lead_distribution d
   WHERE d.organization_id = NEW.organization_id
     AND d.active
     AND d.weight > 0
     AND private.team_is_org_member(NEW.organization_id,d.user_id)
     AND (
       NEW.board_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.lead_distribution_boards b
          WHERE b.organization_id = NEW.organization_id
            AND b.user_id = d.user_id
            AND b.board_id = NEW.board_id
            AND b.active = false
       )
     )
   ORDER BY
     (
       (SELECT count(*) FROM public.deals dl
         WHERE dl.organization_id = NEW.organization_id
           AND dl.owner_id = d.user_id
           AND dl.deleted_at IS NULL
           -- janela: desde a última mudança das fatias, no máximo 30 dias
           AND dl.created_at >= GREATEST(
                 COALESCE(v_since, now() - interval '30 days'),
                 now() - interval '30 days'
               )) + 1
     ) / d.weight ASC,
     random()
   LIMIT 1;

  IF v_user IS NOT NULL THEN
    NEW.owner_id := v_user;
  END IF;

  RETURN NEW;
END $$;

notify pgrst,'reload schema';
