-- =============================================================================
-- DISTRIBUIÇÃO AUTOMÁTICA DE LEADS (responsável por peso)
--
-- Cada organização define quem participa do rodízio, com que fatia (%) e em
-- quais boards. Quando um lead nasce SEM responsável, um trigger escolhe quem
-- recebe — assim TODO caminho de criação (API pública/n8n, chat de WhatsApp,
-- IA, importação, UI) fica coberto sem duplicar regra em cada lugar.
--
-- Critério de escolha (proporcional e sem estado): entre os ativos com fatia
-- > 0 que atendem o board, ganha quem está mais "devendo" — menor
-- (recebidos_30d + 1) / fatia. Empate resolve no aleatório.
--
-- Idempotente: pode rodar em staging e produção.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Pré-requisitos multi-org (já existem em produção; nivelam o staging)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'vendedor',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);
ALTER TABLE public.user_organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_orgs_select_own ON public.user_organizations;
CREATE POLICY user_orgs_select_own ON public.user_organizations
  FOR SELECT USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.user_org_ids(p_uid uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.user_organizations WHERE user_id = p_uid
  UNION
  SELECT organization_id FROM public.profiles WHERE id = p_uid AND organization_id IS NOT NULL
  UNION
  SELECT o.id FROM public.organizations o
   WHERE EXISTS (SELECT 1 FROM public.profiles sp WHERE sp.id = p_uid AND sp.role = 'super_admin')
$$;

-- ---------------------------------------------------------------------------
-- 1) Interruptores por organização
-- ---------------------------------------------------------------------------
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS lead_distribution_enabled boolean NOT NULL DEFAULT false;
-- Distribuir TAMBÉM os leads criados dentro do CRM sem responsável. Desligado
-- por padrão: quem cria na mão normalmente quer ficar com o lead.
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS lead_distribution_manual boolean NOT NULL DEFAULT false;
-- Marco zero do rodízio: toda vez que as fatias são salvas, a contagem
-- recomeça daqui. Sem isso, ligar a distribuição numa organização antiga faria
-- quem tem menos histórico receber uma enxurrada seguida até "empatar".
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS lead_distribution_since timestamptz;

-- ---------------------------------------------------------------------------
-- 2) Quem participa e com que fatia
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lead_distribution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  weight numeric(7,3) NOT NULL DEFAULT 0 CHECK (weight >= 0 AND weight <= 100),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS lead_distribution_org_idx
  ON public.lead_distribution (organization_id);

-- Matriz pessoa × board. Linha AUSENTE = participa (mesma semântica do painel
-- de origem: só o desmarcado vira registro).
--
-- ATENÇÃO (incidente 19/08): a chave é PRÓPRIA (id), NUNCA composta pelas FKs.
-- Com PK composta o PostgREST trata a tabela como PONTE profiles↔organizations
-- ↔boards e passa a rejeitar por ambiguidade (PGRST201) todo embed sem hint
-- entre essas tabelas, derrubando o carregamento de perfil do app inteiro.
CREATE TABLE IF NOT EXISTS public.lead_distribution_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  CONSTRAINT uq_lead_distribution_boards UNIQUE (organization_id, user_id, board_id)
);

-- Converte uma instalação antiga (PK composta) pro formato de chave própria.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='lead_distribution_boards'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='lead_distribution_boards' AND column_name='id'
  ) THEN
    ALTER TABLE public.lead_distribution_boards DROP CONSTRAINT lead_distribution_boards_pkey;
    ALTER TABLE public.lead_distribution_boards ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE public.lead_distribution_boards ADD PRIMARY KEY (id);
    ALTER TABLE public.lead_distribution_boards
      ADD CONSTRAINT uq_lead_distribution_boards UNIQUE (organization_id, user_id, board_id);
  END IF;
END $$;

-- Contagem do trigger: recebidos por responsável na janela de 30 dias
CREATE INDEX IF NOT EXISTS deals_org_owner_created_idx
  ON public.deals (organization_id, owner_id, created_at)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3) RLS: membros da organização leem; a escrita passa pela API (service role)
-- ---------------------------------------------------------------------------
ALTER TABLE public.lead_distribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_distribution_boards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_distribution_select ON public.lead_distribution;
CREATE POLICY lead_distribution_select ON public.lead_distribution
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids(auth.uid())));

DROP POLICY IF EXISTS lead_distribution_boards_select ON public.lead_distribution_boards;
CREATE POLICY lead_distribution_boards_select ON public.lead_distribution_boards
  FOR SELECT TO authenticated
  USING (organization_id IN (SELECT public.user_org_ids(auth.uid())));

-- ---------------------------------------------------------------------------
-- 4) O motor: escolhe o responsável quando o lead nasce sem um
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_deal_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid;
  v_enabled boolean;
  v_manual boolean;
  v_since timestamptz;
BEGIN
  -- Responsável definido na origem manda: nunca sobrescreve.
  IF NEW.owner_id IS NOT NULL OR NEW.organization_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT s.lead_distribution_enabled, s.lead_distribution_manual, s.lead_distribution_since
    INTO v_enabled, v_manual, v_since
    FROM public.organization_settings s
   WHERE s.organization_id = NEW.organization_id;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN NEW;
  END IF;

  -- auth.uid() nulo = insert de integração (service role: API pública, n8n,
  -- webhooks). Com usuário logado é criação dentro do CRM, que só entra no
  -- rodízio quando a organização pede.
  IF auth.uid() IS NOT NULL AND NOT COALESCE(v_manual, false) THEN
    RETURN NEW;
  END IF;

  SELECT d.user_id
    INTO v_user
    FROM public.lead_distribution d
   WHERE d.organization_id = NEW.organization_id
     AND d.active
     AND d.weight > 0
     -- Continua sendo gente DAQUI: quem sai da organização para de receber
     -- mesmo que a linha de configuração tenha ficado para trás.
     AND (
       EXISTS (
         SELECT 1 FROM public.user_organizations uo
          WHERE uo.user_id = d.user_id AND uo.organization_id = NEW.organization_id
       )
       OR EXISTS (
         SELECT 1 FROM public.profiles p
          WHERE p.id = d.user_id AND p.organization_id = NEW.organization_id
       )
     )
     AND (
       NEW.board_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.lead_distribution_boards b
          WHERE b.organization_id = NEW.organization_id
            AND b.user_id = d.user_id
            AND b.board_id = NEW.board_id
            AND b.active = false
       )
     )
   ORDER BY
     (
       (SELECT count(*) FROM public.deals dl
         WHERE dl.organization_id = NEW.organization_id
           AND dl.owner_id = d.user_id
           AND dl.deleted_at IS NULL
           -- janela: desde a última mudança das fatias, no máximo 30 dias
           AND dl.created_at >= GREATEST(
                 COALESCE(v_since, now() - interval '30 days'),
                 now() - interval '30 days'
               )) + 1
     ) / d.weight ASC,
     random()
   LIMIT 1;

  IF v_user IS NOT NULL THEN
    NEW.owner_id := v_user;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_assign_deal_owner ON public.deals;
CREATE TRIGGER trg_assign_deal_owner
  BEFORE INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.assign_deal_owner();
