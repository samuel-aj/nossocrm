-- =============================================================================
-- Permissões de AÇÃO por vendedor (Configurações > Equipe > olho de permissões)
-- =============================================================================
-- ADITIVO e idempotente. Complementa as permissões de VISUALIZAÇÃO da migração
-- 20260901220000 (user_visibility_rules) com o que o vendedor pode FAZER:
--
--   rules.actions = {
--     "contacts": { "view": bool, "create": bool, "edit": bool, "delete": bool },
--     "deals":    { "create": bool, "edit": bool, "delete": bool, "move": bool }
--   }
--
-- IMPOSIÇÃO DE VERDADE (não é só esconder na interface):
--   - contacts.view  -> política RESTRITIVA de SELECT em contacts;
--   - demais ações   -> triggers BEFORE em contacts/deals que RECUSAM a
--     escrita com uma mensagem clara em português (o app escreve direto no
--     PostgREST com a sessão do usuário, então o trigger pega TODO caminho).
--
-- Salvaguardas (mesma filosofia das funções vis_* existentes):
--   - auth.uid() nulo (service role: webhooks, agentes, API pública) = liberado;
--   - admin e super_admin = liberados;
--   - sem linha de regra / sem a chave no JSON / erro interno = liberado
--     (uma regra quebrada nunca tranca o CRM).
--   - "excluir" cobre o soft delete (marcar/desmarcar deleted_at) e o DELETE.
--   - mudar deals.stage_id conta como MOVER (não exige "editar" junto).

-- -----------------------------------------------------------------------------
-- Ação liberada? (contacts|deals, view|create|edit|delete|move)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vis_action_allowed(p_org UUID, p_section TEXT, p_action TEXT)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); v JSONB;
BEGIN
  IF uid IS NULL THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = uid AND role IN ('admin', 'super_admin')) THEN
    RETURN true;
  END IF;
  SELECT rules->'actions'->p_section->p_action INTO v
    FROM user_visibility_rules
   WHERE organization_id = p_org AND user_id = uid;
  IF v IS NULL THEN RETURN true; END IF;               -- sem regra/sem chave = liberado
  RETURN v <> 'false'::jsonb;
EXCEPTION WHEN OTHERS THEN
  RETURN true;                                         -- regra quebrada nunca tranca o CRM
END $$;

-- -----------------------------------------------------------------------------
-- Visualizar contatos (RESTRITIVA: E lógico sobre as políticas permissivas)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS vis_contacts_select ON public.contacts;
CREATE POLICY vis_contacts_select ON public.contacts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.vis_action_allowed(organization_id, 'contacts', 'view'));

-- -----------------------------------------------------------------------------
-- Guarda de escrita em CONTACTS (criar/editar/excluir)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vis_guard_contacts()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT public.vis_action_allowed(NEW.organization_id, 'contacts', 'create') THEN
      RAISE EXCEPTION 'Sem permissão para criar contatos';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
      IF NOT public.vis_action_allowed(OLD.organization_id, 'contacts', 'delete') THEN
        RAISE EXCEPTION 'Sem permissão para excluir contatos';
      END IF;
    ELSIF NOT public.vis_action_allowed(OLD.organization_id, 'contacts', 'edit') THEN
      RAISE EXCEPTION 'Sem permissão para editar contatos';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT public.vis_action_allowed(OLD.organization_id, 'contacts', 'delete') THEN
    RAISE EXCEPTION 'Sem permissão para excluir contatos';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_vis_guard_contacts ON public.contacts;
CREATE TRIGGER trg_vis_guard_contacts
  BEFORE INSERT OR UPDATE OR DELETE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.vis_guard_contacts();

-- -----------------------------------------------------------------------------
-- Guarda de escrita em DEALS (criar/editar/excluir/mover cards)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vis_guard_deals()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT public.vis_action_allowed(NEW.organization_id, 'deals', 'create') THEN
      RAISE EXCEPTION 'Sem permissão para criar cards';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
      IF NOT public.vis_action_allowed(OLD.organization_id, 'deals', 'delete') THEN
        RAISE EXCEPTION 'Sem permissão para excluir cards';
      END IF;
    ELSIF OLD.stage_id IS DISTINCT FROM NEW.stage_id THEN
      IF NOT public.vis_action_allowed(OLD.organization_id, 'deals', 'move') THEN
        RAISE EXCEPTION 'Sem permissão para mover cards de etapa';
      END IF;
    ELSIF NOT public.vis_action_allowed(OLD.organization_id, 'deals', 'edit') THEN
      RAISE EXCEPTION 'Sem permissão para editar cards';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT public.vis_action_allowed(OLD.organization_id, 'deals', 'delete') THEN
    RAISE EXCEPTION 'Sem permissão para excluir cards';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_vis_guard_deals ON public.deals;
CREATE TRIGGER trg_vis_guard_deals
  BEFORE INSERT OR UPDATE OR DELETE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.vis_guard_deals();

COMMENT ON FUNCTION public.vis_action_allowed(UUID, TEXT, TEXT) IS
  'permissões de ação por vendedor (user_visibility_rules.rules.actions); service role, admins e regra ausente/quebrada = liberado';
