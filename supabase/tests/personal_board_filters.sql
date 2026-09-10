begin;
do $$
declare
  o uuid := gen_random_uuid(); b1 uuid := gen_random_uuid(); b2 uuid := gen_random_uuid(); r uuid := gen_random_uuid();
  u uuid; other_user uuid; n integer; denied boolean;
begin
  select id into u from public.profiles where role <> 'super_admin' limit 1;
  select id into other_user from public.profiles where role <> 'super_admin' and id <> u limit 1;
  if u is null or other_user is null then raise exception 'Two fixture users required'; end if;
  insert into public.organizations(id,name) values(o,'TEST personal filters - rollback');
  insert into public.user_organizations(organization_id,user_id,role) values(o,u,'vendedor'),(o,other_user,'admin');
  insert into public.boards(id,name,organization_id) values(b1,'Allowed fixture',o),(b2,'Hidden fixture',o);
  insert into public.team_roles(id,organization_id,name,boards) values(r,o,'Filters fixture',jsonb_build_array(jsonb_build_object('boardId',b1,'scope','own','create',false,'edit',false,'move',false,'delete',false)));
  insert into public.team_role_assignments(organization_id,user_id,role_id) values(o,u,r);
  perform set_config('request.jwt.claim.sub',u::text,true);
  set local role authenticated;
  insert into public.user_board_filters(user_id,board_id,general) values(u,b1,'{"status":"all","product":"one"}');
  insert into public.user_board_filters(user_id,board_id,period) values(u,b1,'{"preset":"lastMonth"}')
    on conflict(user_id,board_id) do update set period=excluded.period;
  select count(*) into n from public.user_board_filters where user_id=u and board_id=b1 and general->>'product'='one' and period->>'preset'='lastMonth';
  if n<>1 then raise exception 'Independent pins failed'; end if;
  update public.user_board_filters set period=null where user_id=u and board_id=b1;
  select count(*) into n from public.user_board_filters where user_id=u and board_id=b1 and general->>'product'='one' and period is null;
  if n<>1 then raise exception 'Unpin changed other group'; end if;
  denied:=false;
  begin insert into public.user_board_filters(user_id,board_id) values(u,b2); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Hidden board allowed'; end if;
  denied:=false;
  begin update public.user_board_filters set user_id=other_user where user_id=u and board_id=b1; exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Owner spoofing allowed'; end if;
  perform set_config('request.jwt.claim.sub',other_user::text,true);
  select count(*) into n from public.user_board_filters where board_id=b1;
  if n<>0 then raise exception 'Another user can read personal defaults'; end if;
  insert into public.user_board_filters(user_id,board_id,general) values(other_user,b1,'{"status":"open"}');
  select count(*) into n from public.user_board_filters where board_id=b1;
  if n<>1 then raise exception 'Independent users failed'; end if;
  reset role;
  if has_table_privilege('anon','public.user_board_filters','SELECT') then raise exception 'Anonymous access allowed'; end if;
end $$;
rollback;
