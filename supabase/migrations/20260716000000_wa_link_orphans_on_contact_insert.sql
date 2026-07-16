-- =============================================================================
-- MUDANÇA DE COMPORTAMENTO: criar um CONTATO agora VINCULA as conversas órfãs
-- do telefone (antes APAGAVA). Motivo: a página Chats passou a mostrar
-- conversas de números sem contato no CRM, e o fluxo é "ver conversa → criar
-- contato → criar lead" — apagar a conversa na criação destruiria exatamente
-- o que o usuário está vendo. Apagar o CONTATO continua apagando todo o
-- histórico (trigger de delete permanece intacto).
-- AFTER INSERT (era BEFORE): o UPDATE referencia contacts(id) via FK, então o
-- contato precisa existir antes do vínculo.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.wa_link_orphans_on_contact_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.phone IS NOT NULL AND NEW.phone <> '' THEN
    UPDATE public.wa_conversations
      SET contact_id = NEW.id, updated_at = now()
    WHERE organization_id = NEW.organization_id
      AND contact_id IS NULL
      AND wa_phone = ANY (public.br_phone_variants(NEW.phone));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wa_wipe_orphans_on_contact_insert ON public.contacts;
DROP FUNCTION IF EXISTS public.wa_wipe_orphans_on_contact_insert();

DROP TRIGGER IF EXISTS trg_wa_link_orphans_on_contact_insert ON public.contacts;
CREATE TRIGGER trg_wa_link_orphans_on_contact_insert
  AFTER INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.wa_link_orphans_on_contact_insert();
