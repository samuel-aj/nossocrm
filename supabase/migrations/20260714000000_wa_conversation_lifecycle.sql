-- =============================================================================
-- Ciclo de vida das conversas de WhatsApp amarrado ao CONTATO:
--   - Apagar um CONTATO apaga TODO o histórico de conversa da pessoa
--     (wa_conversations + wa_messages via cascade). Recriar o contato = chat zerado.
--   - Criar um CONTATO limpa conversas órfãs (sem contato) do mesmo telefone,
--     garantindo chat zerado também quando já havia histórico avulso do número.
--   - Apagar um LEAD (deal) NÃO toca nas conversas (wa_conversations.deal_id
--     já é ON DELETE SET NULL) — a conversa pertence ao contato.
-- Triggers SECURITY DEFINER: valem pra QUALQUER caminho de exclusão/criação
-- (UI, API pública, n8n), ignorando RLS das tabelas wa_*.
-- =============================================================================

-- Variantes BR do nono dígito em SQL — espelho de brPhoneVariants (lib/phone.ts)
CREATE OR REPLACE FUNCTION public.br_phone_variants(p text)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE m text[];
BEGIN
  IF p IS NULL OR p = '' THEN RETURN ARRAY[]::text[]; END IF;
  m := regexp_match(p, '^\+55(\d{2})(9[6-9]\d{7})$');
  IF m IS NOT NULL THEN RETURN ARRAY[p, '+55' || m[1] || substr(m[2], 2)]; END IF;
  m := regexp_match(p, '^\+55(\d{2})([6-9]\d{7})$');
  IF m IS NOT NULL THEN RETURN ARRAY[p, '+55' || m[1] || '9' || m[2]]; END IF;
  RETURN ARRAY[p];
END $$;

-- Apagar CONTATO => apaga o histórico de WhatsApp da pessoa (linkado ao contato
-- E conversas órfãs do mesmo telefone)
CREATE OR REPLACE FUNCTION public.wa_wipe_on_contact_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM public.wa_conversations
  WHERE organization_id = OLD.organization_id
    AND (
      contact_id = OLD.id
      OR (
        contact_id IS NULL
        AND OLD.phone IS NOT NULL AND OLD.phone <> ''
        AND wa_phone = ANY (public.br_phone_variants(OLD.phone))
      )
    );
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_wa_wipe_on_contact_delete ON public.contacts;
CREATE TRIGGER trg_wa_wipe_on_contact_delete
  BEFORE DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.wa_wipe_on_contact_delete();

-- Criar CONTATO => chat zerado (limpa conversas órfãs do telefone)
CREATE OR REPLACE FUNCTION public.wa_wipe_orphans_on_contact_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone <> '' THEN
    DELETE FROM public.wa_conversations
    WHERE organization_id = NEW.organization_id
      AND contact_id IS NULL
      AND wa_phone = ANY (public.br_phone_variants(NEW.phone));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wa_wipe_orphans_on_contact_insert ON public.contacts;
CREATE TRIGGER trg_wa_wipe_orphans_on_contact_insert
  BEFORE INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.wa_wipe_orphans_on_contact_insert();
