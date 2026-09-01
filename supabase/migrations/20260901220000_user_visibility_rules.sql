-- =============================================================================
-- Permissões de visualização por usuário (Configurações > Equipe)
-- =============================================================================
-- O admin define, por vendedor, o que ele enxerga:
--   rules = {
--     "deals":    { "scope": "own" | "team" | "all", "team_user_ids": [uuid...] },
--     "boards":   { "board_ids": null | [uuid...] },      -- null = todos
--     "whatsapp": { "connection_ids": null | [uuid...] }  -- null = todos
--   }
--
-- IMPOSIÇÃO DE VERDADE (não é só esconder na tela):
--   - deals/boards: políticas RESTRITIVAS de SELECT abaixo — fazem E lógico
--     por cima de QUALQUER política permissiva existente (produção e staging
--     têm conjuntos diferentes; a restritiva vale nos dois sem mexer nelas).
--   - WhatsApp: as rotas do app (service role) aplicam connection_ids.
--
-- SEM chave estrangeira DE PROPÓSITO: em 19/08 uma tabela nova ligando
-- profiles+organizations criou embed ambíguo no PostgREST e derrubou o login.
-- A validação dos ids fica na API (admin). Linha órfã de usuário removido é
-- inofensiva.
--
-- Sem regra cadastrada, NADA muda: as funções devolvem true por padrão, e um
-- erro inesperado na regra também devolve true (regra quebrada nunca pode
-- esconder o CRM inteiro).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_visibility_rules (
  organization_id UUID NOT NULL,
  user_id UUID NOT NULL,
  rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID,
  PRIMARY KEY (organization_id, user_id)
);

-- RLS ligada e SEM política: só as rotas com service role e as funções
-- SECURITY DEFINER abaixo alcançam a tabela.
ALTER TABLE public.user_visibility_rules ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Pode ver o que é do responsável p_owner? (deals)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vis_can_see_owner(p_org UUID, p_owner UUID)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); r JSONB; scope TEXT;
BEGIN
  IF uid IS NULL THEN RETURN true; END IF;             -- service role bypassa RLS de todo jeito
  IF p_owner IS NULL OR p_owner = uid THEN RETURN true; END IF;  -- sem dono, ou o próprio
  SELECT rules INTO r FROM user_visibility_rules WHERE organization_id = p_org AND user_id = uid;
  IF r IS NULL THEN RETURN true; END IF;               -- sem regra = comportamento de sempre
  -- Admin nunca é restringido, mesmo que uma regra tenha sobrado de quando era vendedor
  IF EXISTS (SELECT 1 FROM profiles WHERE id = uid AND role IN ('admin', 'super_admin')) THEN
    RETURN true;
  END IF;
  scope := COALESCE(r->'deals'->>'scope', 'all');
  IF scope = 'all' THEN RETURN true; END IF;
  IF scope = 'team' THEN RETURN COALESCE(r->'deals'->'team_user_ids' @> to_jsonb(p_owner::text), false); END IF;
  RETURN false;                                        -- 'own'
EXCEPTION WHEN OTHERS THEN
  RETURN true;                                         -- regra quebrada nunca esconde o CRM
END $$;

-- -----------------------------------------------------------------------------
-- Pode ver o quadro p_board? (boards)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.vis_can_see_board(p_org UUID, p_board UUID)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid UUID := auth.uid(); r JSONB; allowed JSONB;
BEGIN
  IF uid IS NULL THEN RETURN true; END IF;
  SELECT rules INTO r FROM user_visibility_rules WHERE organization_id = p_org AND user_id = uid;
  IF r IS NULL THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = uid AND role IN ('admin', 'super_admin')) THEN
    RETURN true;
  END IF;
  allowed := r->'boards'->'board_ids';
  IF allowed IS NULL OR jsonb_typeof(allowed) <> 'array' THEN RETURN true; END IF;  -- null = todos
  RETURN allowed @> to_jsonb(p_board::text);
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END $$;

REVOKE ALL ON FUNCTION public.vis_can_see_owner(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vis_can_see_board(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.vis_can_see_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vis_can_see_board(uuid, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- Políticas RESTRITIVAS (E lógico por cima das permissivas existentes).
-- Só SELECT: bloquear INSERT/UPDATE quebraria o rodízio de distribuição
-- (o gatilho troca o responsável no meio do INSERT).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS vis_deals_select ON public.deals;
CREATE POLICY vis_deals_select ON public.deals
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.vis_can_see_owner(organization_id, owner_id));

DROP POLICY IF EXISTS vis_boards_select ON public.boards;
CREATE POLICY vis_boards_select ON public.boards
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.vis_can_see_board(organization_id, id));
