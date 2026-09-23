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
     AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = d.user_id AND p.role <> 'super_admin')
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

-- Habilita Supabase Realtime para deal_items.
--
-- Necessário para sincronização em tempo real dos produtos do lead entre usuários.
-- REPLICA IDENTITY FULL é exigida para que eventos DELETE carreguem o deal_id
-- (não só a PK), permitindo localizar o deal pai no cache do cliente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'deal_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deal_items;
  END IF;
END $$;

ALTER TABLE public.deal_items REPLICA IDENTITY FULL;

-- Add deal_notes to supabase_realtime publication so INSERT/UPDATE/DELETE
-- events fan out to all connected clients. REPLICA IDENTITY FULL ensures
-- DELETE payloads include deal_id so handlers can target the right parent
-- deal without an extra round-trip.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'deal_notes'
  ) then
    execute 'alter publication supabase_realtime add table public.deal_notes';
  end if;
end $$;

alter table public.deal_notes replica identity full;
