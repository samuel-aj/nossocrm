-- Caixa de ajustes: pedidos, anexos e mensagens. Só o servidor acessa (cliente de serviço);
-- a tela passa pelas rotas /api/feedback, que conferem autor e organização.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE public.feedback_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text CHECK (kind IN ('bug','melhoria','ambos')),
  body text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
  transcript text CHECK (transcript IS NULL OR length(transcript) <= 8000),
  screen_path text CHECK (screen_path IS NULL OR length(screen_path) <= 300),
  device text CHECK (device IS NULL OR device IN ('celular','computador')),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 400),
  status text NOT NULL DEFAULT 'recebido' CHECK (status IN ('recebido','em_analise','precisa_detalhes',
    'na_fila','aguardando_aprovacao','em_correcao','corrigido','nao_e_bug','descartado')),
  priority_label text CHECK (priority_label IS NULL OR length(priority_label) <= 120),
  public_reply text CHECK (public_reply IS NULL OR length(public_reply) <= 4000),
  tutorial_url text CHECK (tutorial_url IS NULL OR (tutorial_url ~ '^https://' AND length(tutorial_url) <= 500)),
  paperclip_issue_id text CHECK (paperclip_issue_id IS NULL OR length(paperclip_issue_id) <= 120),
  origin text NOT NULL DEFAULT 'caixa' CHECK (origin IN ('caixa','mural')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_requests_author_time ON public.feedback_requests(author_id, created_at DESC);
CREATE INDEX feedback_requests_org_time ON public.feedback_requests(organization_id, created_at DESC);
CREATE INDEX feedback_requests_status_time ON public.feedback_requests(status, created_at);

CREATE TABLE public.feedback_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.feedback_requests(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image','audio','file')),
  storage_path text NOT NULL CHECK (length(storage_path) BETWEEN 3 AND 400),
  mime text NOT NULL CHECK (length(mime) <= 120),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_attachments_request ON public.feedback_attachments(request_id);

CREATE TABLE public.feedback_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.feedback_requests(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  author_kind text NOT NULL CHECK (author_kind IN ('user','agent')),
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  body text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX feedback_messages_request_time ON public.feedback_messages(request_id, created_at);

ALTER TABLE public.feedback_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.feedback_requests, public.feedback_attachments, public.feedback_messages
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.feedback_requests TO service_role;
GRANT SELECT, INSERT ON public.feedback_attachments, public.feedback_messages TO service_role;

CREATE FUNCTION private.touch_feedback_request() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
REVOKE ALL ON FUNCTION private.touch_feedback_request() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER feedback_requests_touch BEFORE UPDATE ON public.feedback_requests
  FOR EACH ROW EXECUTE FUNCTION private.touch_feedback_request();

-- Pedidos pendentes do mural antigo entram na esteira. O mural fica como histórico.
-- A coluna suggestions.status existe em produção, mas nenhuma migração do repositório a cria;
-- ler por to_jsonb evita que esta migração falhe num banco montado só pelas migrações.
INSERT INTO public.feedback_requests(organization_id, author_id, body, origin, created_at)
SELECT s.organization_id, p.id, left(s.content, 4000), 'mural', s.created_at
FROM public.suggestions s LEFT JOIN public.profiles p ON p.id = s.author_id
WHERE coalesce(to_jsonb(s)->>'status', 'pending') = 'pending';

-- Aviso no sino quando o status muda.
ALTER TABLE public.crm_notification_events DROP CONSTRAINT crm_notification_events_kind_check;
ALTER TABLE public.crm_notification_events ADD CONSTRAINT crm_notification_events_kind_check
  CHECK (kind IN ('message','lead','alert','audio_transcription','human_handoff','wa_entry_recovery','feedback'));
COMMIT;
