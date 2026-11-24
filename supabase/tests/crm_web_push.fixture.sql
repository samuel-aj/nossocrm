-- Only for the isolated PostgreSQL test. The net and cron functions record local rows.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema crm_internal;
create schema cron;
create schema net;
create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
create table organizations(id uuid primary key,is_active boolean);
create table profiles(id uuid primary key,organization_id uuid,role text);
create table user_organizations(user_id uuid,organization_id uuid,role text,primary key(user_id,organization_id));
create table wa_conversations(id uuid primary key,organization_id uuid,is_group boolean default false);
create table wa_messages(id uuid primary key,conversation_id uuid,organization_id uuid,direction text,
  deleted_at timestamptz,wa_timestamp timestamptz,created_at timestamptz default now(),body text,media_type text);
create table deals(id uuid primary key,organization_id uuid,deleted_at timestamptz,board_id uuid);
create table platform_config(key text,value text);
create table net.requests(id bigint generated always as identity,url text,body jsonb);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$
  insert into net.requests(url,body) values ($1,$3) returning id
$$;
create table cron.jobs(name text,schedule text,command text);
create function cron.schedule(text,text,text) returns bigint language sql as $$
  insert into cron.jobs values ($1,$2,$3) returning 1::bigint
$$;
