-- Fixture para um cluster PostgreSQL vazio, criado pelo script test-mcp-ai-agents-db.mjs.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA crm_internal;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE TABLE organizations(id uuid PRIMARY KEY, name text NOT NULL);
CREATE TABLE profiles(id uuid PRIMARY KEY);
CREATE TABLE api_keys(id uuid PRIMARY KEY, organization_id uuid REFERENCES organizations, key_hash text,
  key_prefix text, revoked_at timestamptz, last_used_at timestamptz, updated_at timestamptz);
CREATE TABLE wa_ai_agents(id uuid PRIMARY KEY, organization_id uuid REFERENCES organizations, system_prompt text NOT NULL,
  stop_rules text NOT NULL, updated_at timestamptz);
CREATE TABLE wa_conversations(id uuid PRIMARY KEY, organization_id uuid, ai_agent_id uuid, ai_status text,
  ai_status_changed_at timestamptz, ai_paused_by uuid);
CREATE TABLE wa_ai_agent_runs(agent_id uuid, conversation_id uuid, organization_id uuid, created_at timestamptz,
  trigger text, status text, output_text text);
GRANT USAGE ON SCHEMA public, auth, crm_internal TO service_role;
GRANT SELECT, UPDATE ON wa_ai_agents, wa_conversations TO service_role;
CREATE FUNCTION public.validate_api_key(p_token text)
RETURNS TABLE(api_key_id uuid, api_key_prefix text, organization_id uuid, organization_name text)
LANGUAGE sql AS $$ SELECT NULL::uuid,NULL::text,NULL::uuid,NULL::text WHERE false $$;
