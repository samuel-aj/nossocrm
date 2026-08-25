-- Agente de IA por conversa (n8n etc.):
--   ai_status: NULL = nenhum agente atuou | 'active' | 'paused'
--   Regras (gatilho BEFORE INSERT em wa_messages):
--     * resposta do agente (source 'api') com status NULL -> 'active'
--     * humano respondeu (source 'crm' ou 'echo' = celular/Kommo) com 'active' -> 'paused'
--   O CRM tem botão pausar/retomar no chat; a API pública recusa envio do
--   agente (409 AGENT_PAUSED) enquanto pausado; o webhook leva conversation.ai_status.
ALTER TABLE public.wa_conversations ADD COLUMN IF NOT EXISTS ai_status TEXT CHECK (ai_status IN ('active','paused'));
ALTER TABLE public.wa_conversations ADD COLUMN IF NOT EXISTS ai_status_changed_at TIMESTAMPTZ;
ALTER TABLE public.wa_conversations ADD COLUMN IF NOT EXISTS ai_paused_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.wa_ai_agent_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE st TEXT;
BEGIN
  IF NEW.direction <> 'out' THEN RETURN NEW; END IF;
  SELECT ai_status INTO st FROM public.wa_conversations WHERE id = NEW.conversation_id;
  IF NEW.source = 'api' THEN
    IF st IS NULL THEN
      UPDATE public.wa_conversations SET ai_status = 'active', ai_status_changed_at = now() WHERE id = NEW.conversation_id;
    END IF;
  ELSIF NEW.source IN ('crm','echo') AND st = 'active' THEN
    UPDATE public.wa_conversations SET ai_status = 'paused', ai_status_changed_at = now(), ai_paused_by = NEW.sent_by WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'wa_ai_agent_state falhou: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_wa_ai_agent_state ON public.wa_messages;
CREATE TRIGGER trg_wa_ai_agent_state BEFORE INSERT ON public.wa_messages FOR EACH ROW EXECUTE FUNCTION public.wa_ai_agent_state();

-- notify_wa_message: payload.conversation ganha 'ai_status' (ver 20260825000000_wa_message_webhooks.sql;
-- a função foi recriada com o campo extra no SELECT/jsonb_build_object).
