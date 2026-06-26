-- =============================================================================
-- WHATSAPP INTEGRATION (Evolution API) — Fase 1
-- Conecta cada organização a uma instância da Evolution (1 número por org) e
-- guarda conversas + mensagens (in/out) para um chat tipo Kommo dentro do CRM.
--
-- Modelo de segurança (igual ao das chaves de IA, ver 20260421000000):
--   - wa_connections guarda o TOKEN da instância: NÃO tem policy de SELECT para
--     usuários — só o servidor (service role, que ignora RLS) lê o token. A UI
--     pega o status por uma rota de API que mascara o token.
--   - wa_conversations / wa_messages têm SELECT por org (necessário p/ Realtime
--     no client). Escrita é feita pelo servidor (service role).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Helpers SECURITY DEFINER (mesmos da migration de suggestions; recriados aqui
-- para a migration ser auto-suficiente em bancos que ainda não os têm, ex.: staging)
CREATE OR REPLACE FUNCTION public.current_user_org_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT organization_id FROM public.profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.current_user_is_super_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'super_admin') $$;

-- Trigger genérico de updated_at para as tabelas de WhatsApp
CREATE OR REPLACE FUNCTION public.wa_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- wa_connections — vínculo org → instância Evolution
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wa_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'evolution',
    instance_name TEXT NOT NULL,
    instance_token TEXT,                       -- segredo: lido só via service role
    base_url TEXT,                             -- sobrescreve EVOLUTION_BASE_URL se setado
    phone_number TEXT,                         -- E.164 do número conectado
    profile_name TEXT,
    status TEXT NOT NULL DEFAULT 'disconnected'
        CHECK (status IN ('disconnected', 'connecting', 'connected')),
    webhook_secret TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    last_connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 1 conexão por org (Fase 1); instance_name único p/ resolver org no webhook
    CONSTRAINT uq_wa_connections_org UNIQUE (organization_id),
    CONSTRAINT uq_wa_connections_instance UNIQUE (instance_name)
);
CREATE INDEX IF NOT EXISTS idx_wa_connections_org ON public.wa_connections(organization_id);
ALTER TABLE public.wa_connections ENABLE ROW LEVEL SECURITY;
-- (sem policies de usuário de propósito: acesso só via service role no servidor)

DROP TRIGGER IF EXISTS trg_wa_connections_updated ON public.wa_connections;
CREATE TRIGGER trg_wa_connections_updated
    BEFORE UPDATE ON public.wa_connections
    FOR EACH ROW EXECUTE FUNCTION public.wa_touch_updated_at();

-- ---------------------------------------------------------------------------
-- wa_conversations — 1 conversa por telefone, por org
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wa_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    connection_id UUID REFERENCES public.wa_connections(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    wa_phone TEXT NOT NULL,                    -- E.164 do cliente
    wa_name TEXT,                              -- pushName do WhatsApp
    last_message_at TIMESTAMPTZ,
    last_message_preview TEXT,
    unread_count INTEGER NOT NULL DEFAULT 0,
    assigned_owner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    deal_id UUID REFERENCES public.deals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_wa_conversations_org_phone UNIQUE (organization_id, wa_phone)
);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_org ON public.wa_conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_contact ON public.wa_conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_recent ON public.wa_conversations(organization_id, last_message_at DESC);
ALTER TABLE public.wa_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_conversations_select" ON public.wa_conversations;
CREATE POLICY "wa_conversations_select" ON public.wa_conversations
    FOR SELECT TO authenticated
    USING (
        public.current_user_is_super_admin()
        OR organization_id = public.current_user_org_id()
    );

DROP TRIGGER IF EXISTS trg_wa_conversations_updated ON public.wa_conversations;
CREATE TRIGGER trg_wa_conversations_updated
    BEFORE UPDATE ON public.wa_conversations
    FOR EACH ROW EXECUTE FUNCTION public.wa_touch_updated_at();

-- ---------------------------------------------------------------------------
-- wa_messages — mensagens in/out
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wa_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES public.wa_conversations(id) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
    status TEXT NOT NULL DEFAULT 'sent'
        CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed', 'received')),
    body TEXT,
    media_url TEXT,
    media_type TEXT,                           -- image | audio | video | document | sticker
    media_mime TEXT,
    evolution_message_id TEXT,                 -- id no provedor (idempotência + status)
    from_phone TEXT,
    to_phone TEXT,
    sent_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,  -- quem enviou (outbound)
    error TEXT,
    wa_timestamp TIMESTAMPTZ,                  -- timestamp da mensagem no provedor
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_conversation ON public.wa_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_wa_messages_org ON public.wa_messages(organization_id);
-- idempotência: não duplicar a mesma mensagem do provedor por org
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_messages_provider_id
    ON public.wa_messages(organization_id, evolution_message_id)
    WHERE evolution_message_id IS NOT NULL;
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wa_messages_select" ON public.wa_messages;
CREATE POLICY "wa_messages_select" ON public.wa_messages
    FOR SELECT TO authenticated
    USING (
        public.current_user_is_super_admin()
        OR organization_id = public.current_user_org_id()
    );

-- ---------------------------------------------------------------------------
-- Realtime: publicar conversas + mensagens (UI atualiza ao vivo)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wa_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wa_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_conversations;
  END IF;
END $$;

COMMENT ON TABLE public.wa_connections IS 'Vínculo org → instância Evolution. instance_token é segredo: lido só via service role (sem policy de SELECT p/ usuários).';
COMMENT ON TABLE public.wa_conversations IS 'Conversa de WhatsApp (1 por telefone/org), ligada opcionalmente a um contato e negócio.';
COMMENT ON TABLE public.wa_messages IS 'Mensagens de WhatsApp in/out. Escrita via service role; SELECT por org p/ Realtime.';
