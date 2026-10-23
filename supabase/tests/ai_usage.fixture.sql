CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.contacts(id uuid PRIMARY KEY,organization_id uuid,deleted_at timestamptz);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_id uuid);
CREATE TABLE public.user_organizations(user_id uuid,organization_id uuid);
CREATE TABLE public.deals(id uuid PRIMARY KEY,organization_id uuid);
CREATE TABLE public.wa_messages(id uuid PRIMARY KEY,organization_id uuid,conversation_id uuid,content text);
CREATE TABLE public.wa_conversations(id uuid PRIMARY KEY,organization_id uuid,contact_id uuid,wa_phone text,is_group boolean DEFAULT false,
 ai_status text DEFAULT 'active',ai_resume_at timestamptz,ai_status_changed_at timestamptz,
 ai_agent_id uuid DEFAULT '00000000-0000-0000-0000-000000000999',ai_paused_by uuid);
CREATE FUNCTION public.user_admin_org_ids(uuid) RETURNS SETOF uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT id FROM public.organizations WHERE false $$;
GRANT USAGE ON SCHEMA public,auth TO service_role,authenticated;
GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO service_role;
CREATE SCHEMA usage_test;
CREATE FUNCTION usage_test.id(n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$ SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid $$;
CREATE FUNCTION usage_test.assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE TABLE usage_test.results(label text);
