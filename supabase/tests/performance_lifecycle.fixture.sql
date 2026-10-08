-- Minimal dependencies for the actual production migration bodies. This file is
-- only for scripts/test-performance-db.mjs, in an empty local PGlite database.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA crm_internal;
CREATE SCHEMA auth;
CREATE SCHEMA crm_test;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE FUNCTION crm_test.id(n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
CREATE FUNCTION crm_test.assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'Assertion failed: %', message; END IF; END
$$;
CREATE TABLE public.organizations(id uuid PRIMARY KEY, name text);
CREATE TABLE public.boards(id uuid PRIMARY KEY, organization_id uuid, name text,
  won_stage_id uuid,lost_stage_id uuid,linked_lifecycle_stage text);
CREATE TABLE public.board_stages(id uuid PRIMARY KEY, organization_id uuid,board_id uuid,
  label text,"order" integer,linked_lifecycle_stage text);
CREATE TABLE public.deals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid NOT NULL,
  board_id uuid,stage_id uuid,title text NOT NULL,owner_id uuid,value numeric DEFAULT 0,
  is_won boolean NOT NULL DEFAULT false,is_lost boolean NOT NULL DEFAULT false,
  loss_category text,loss_reason text,closed_at timestamptz,last_stage_change_date timestamptz,
  created_at timestamptz DEFAULT now(),deleted_at timestamptz);
CREATE TABLE public.deal_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,
  deal_id uuid,product_id uuid,name text,quantity integer,price numeric);
CREATE TABLE public.activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,
  deal_id uuid,type text,title text,date timestamptz,deleted_at timestamptz);
CREATE TABLE public.deal_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,
  deal_id uuid,kind text,old_value jsonb,new_value jsonb,detail jsonb,created_at timestamptz DEFAULT now());
CREATE TABLE public.webhook_events_out(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,
  deal_id uuid,from_stage_id uuid,to_stage_id uuid,event_type text,payload jsonb,created_at timestamptz DEFAULT now());
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
-- Stand-in for production's deal visibility: the new event policy must inherit
-- its result, never widen it to everyone in the organization.
CREATE POLICY test_visible_deals ON public.deals FOR SELECT TO authenticated USING (owner_id=auth.uid());
GRANT USAGE ON SCHEMA public,auth,crm_test TO anon,authenticated,service_role;
GRANT SELECT ON public.deals TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
