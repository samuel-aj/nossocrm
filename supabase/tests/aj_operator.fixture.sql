-- Complements mcp_ai_agents.fixture.sql in an empty, local PostgreSQL cluster.
ALTER TABLE public.profiles ADD COLUMN role text NOT NULL DEFAULT 'sales';
ALTER TABLE public.organizations
  ADD COLUMN is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN deleted_at timestamptz;
ALTER TABLE public.wa_ai_agents ADD COLUMN name text NOT NULL DEFAULT 'Fixture agent';
ALTER TABLE public.wa_conversations ADD COLUMN wa_phone text;
CREATE TABLE public.ai_feature_flags (
  organization_id uuid NOT NULL REFERENCES public.organizations,
  key text NOT NULL, enabled boolean NOT NULL, PRIMARY KEY (organization_id, key)
);
CREATE TABLE public.wa_messages (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations,
  conversation_id uuid NOT NULL REFERENCES public.wa_conversations, direction text NOT NULL,
  source text, sent_by uuid, created_at timestamptz NOT NULL, body text,
  transcription text, media_type text, deleted_at timestamptz
);
CREATE TABLE public.wa_ai_agent_documents (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES public.organizations,
  agent_id uuid NOT NULL REFERENCES public.wa_ai_agents, name text, title text, status text
);
-- Match standard Supabase service access for relations read by invoker RPCs.
GRANT SELECT ON public.organizations, public.ai_feature_flags, public.wa_ai_agents,
  public.wa_ai_agent_runs, public.wa_conversations, public.wa_ai_agent_documents,
  public.wa_messages TO service_role;
