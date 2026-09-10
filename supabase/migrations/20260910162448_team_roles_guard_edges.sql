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
     (private.team_org_role(new.organization_id,new.owner_id) is null or exists(select 1 from public.profiles where id=new.owner_id and role='super_admin')) then raise exception 'Responsável inválido' using errcode='42501'; end if;
 end if;
 return coalesce(new,old);
end $$;
create or replace function private.team_guard_child() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then return coalesce(new,old); end if;
 if tg_op='DELETE' and pg_trigger_depth()>1 and not exists(select 1 from public.deals where id=old.deal_id) then return old; end if;
 if tg_op <> 'DELETE' and new.deal_id is not null and not exists(select 1 from public.deals where id=new.deal_id and organization_id=new.organization_id) then raise exception 'Lead fora da organizacao' using errcode='42501'; end if;
 if tg_op <> 'INSERT' and old.deal_id is not null and not private.team_deal_allowed(old.deal_id,'edit') then raise exception 'Sem permissão para alterar dados deste lead' using errcode='42501'; end if;
 if tg_op <> 'DELETE' and new.deal_id is not null and not private.team_deal_allowed(new.deal_id,'edit') then raise exception 'Sem permissão para alterar dados deste lead' using errcode='42501'; end if;
 return coalesce(new,old);
end $$;

create policy team_stages_scope on public.board_stages as restrictive for select to authenticated using(private.team_board_rule(organization_id,auth.uid(),board_id) is not null);
create policy team_audio_scope on public.ai_audio_notes as restrictive for select to authenticated using(case when deal_id is not null then private.team_deal_allowed(deal_id) else exists(select 1 from public.contacts c where c.id=contact_id and private.team_contact_allowed(c.organization_id,c.id)) end);
create policy team_decisions_scope on public.ai_decisions as restrictive for select to authenticated using(case when deal_id is not null then private.team_deal_allowed(deal_id) else exists(select 1 from public.contacts c where c.id=contact_id and private.team_contact_allowed(c.organization_id,c.id)) end);
notify pgrst,'reload schema';
