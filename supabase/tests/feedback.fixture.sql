-- Complementa os fixtures do operador para as migrações da caixa de ajustes.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS nickname text;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TABLE IF NOT EXISTS public.suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  author_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  status text
);
CREATE TABLE IF NOT EXISTS public.crm_notification_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id uuid NOT NULL,
  kind text NOT NULL,
  source_id uuid NOT NULL,
  board_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT crm_notification_events_kind_check CHECK
    (kind IN ('message','lead','alert','audio_transcription','human_handoff','wa_entry_recovery'))
);
GRANT SELECT, INSERT ON public.crm_notification_events TO service_role;
-- O Supabase cria o esquema storage; aqui só o necessário para a migração do bucket.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint
);
