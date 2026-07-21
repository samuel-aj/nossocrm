-- Modelos de mensagem (página Modelos, grupo WhatsApp do menu):
--   type 'general'      = modelo livre pra usar nas conversas do dia a dia
--   type 'whatsapp_api'  = modelo da API oficial da Meta (Cloud API), que exige
--                          categoria (UTILITY | MARKETING) e idioma, e depois
--                          passa por aprovação da Meta antes de poder enviar.
-- O corpo aceita variáveis do lead/contato (ex.: {{contato.nome}}) que o CRM
-- substitui na hora de usar.
CREATE TABLE IF NOT EXISTS public.message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'general' CHECK (type IN ('general', 'whatsapp_api')),
  category TEXT CHECK (category IN ('UTILITY', 'MARKETING')),
  language TEXT NOT NULL DEFAULT 'pt_BR',
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_message_templates_org_name_type UNIQUE (organization_id, name, type)
);
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
-- (sem policies de usuário: leitura/escrita via API com service role, org-scoped)
