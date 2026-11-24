-- Isolated PostgreSQL only. Replace extensions with inert local request logs.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema crm_internal;
create schema private;
create schema net;
create schema cron;
create table organizations(id uuid primary key, beta boolean default true);
create table profiles(id uuid primary key,organization_id uuid,role text);
create table user_organizations(organization_id uuid,user_id uuid,role text);
create table deals(id uuid primary key,organization_id uuid,owner_id uuid,contact_id uuid,
  is_won boolean default false,is_lost boolean default false,deleted_at timestamptz,created_at timestamptz default now());
create table wa_conversations(id uuid primary key,organization_id uuid,connection_id uuid,ai_agent_id uuid,
  ai_status text,ai_status_changed_at timestamptz,ai_approval jsonb,ai_last_processed_at timestamptz,is_group boolean default false,
  contact_id uuid,deal_id uuid,assigned_owner_id uuid,label_ids uuid[] default '{}');
create table wa_messages(id uuid primary key,organization_id uuid,conversation_id uuid references wa_conversations(id),
  direction text,status text,source text,media_type text,created_at timestamptz default now(),wa_timestamp timestamptz,deleted_at timestamptz);
create table wa_bot_runs(organization_id uuid,conversation_id uuid,status text);
create table wa_bots(organization_id uuid,enabled boolean,trigger jsonb,connection_ids uuid[],connection_id uuid);
create table wa_ai_agents(organization_id uuid,enabled boolean,connection_ids uuid[],triggers jsonb);
create table wa_agent_connection_pending(organization_id uuid,conversation_id uuid,inbound_id uuid);
create table crm_notification_events(organization_id uuid,kind text check(kind in ('message','lead','alert','audio_transcription','human_handoff')),
  source_id uuid,created_at timestamptz default now());
create table platform_config(key text,value text);
create table net.requests(id bigint generated always as identity, url text,body jsonb);
create table cron.jobs(name text,code text);
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language sql as $$
  insert into net.requests(url,body) values ($1,$3) returning id;
$$;
create function cron.schedule(text,text,text) returns bigint language sql as $$
  insert into cron.jobs values($1,$3) returning 1::bigint;
$$;
create function wa_agents_beta_enabled(uuid) returns boolean language sql as $$ select beta from public.organizations where id=$1 $$;
create function wa_ai_agent_ingest() returns trigger language plpgsql as $$ begin return new; end $$;
create trigger wa_ai_agents_ingest after insert on wa_messages for each row execute function wa_ai_agent_ingest();
