-- Segurança parte 1 (auditoria de 23/11/2026). APLICADA EM PRODUÇÃO pelo SQL Editor em 23/11/2026.
-- Não apaga dado. Tabelas que só existem em produção (n8n/Lovable) são puladas onde não existem.

-- 1) Memória dos agentes do n8n SEM proteção (qualquer um com a chave pública lia e alterava).
--    O n8n grava como postgres, não é afetado.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['chat_adriano_doenca_ocup','chat_adriano_rescisao','chat_agente1_hw_histories',
    'chat_agenteia_kommo','chat_aj_aux_acidente_teste','chat_aj_aux_acidente_teste2','chat_hugo_agente_revisional',
    'chat_nitolecrai_aux_acidente','rr_counter','spa_n8n_chat_histories'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- 2) Tabelas fora do CRM (Lovable antigo, n8n, campanhas) com regra "liberado para todos".
--    Nenhuma é usada pelo código do CRM nem foi acessada pela internet nas últimas 24 h.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['Agente SDR','produtos_distribuicao','squad_outputs','squad_runs','squads',
    'Augusto-RMC','Clientes - Token e IDs','MPL Contatos - BPC','Tabela Lead Modelo 2','agente1_hw_chat_histories',
    'chat_mpl_contatos_bpc','documents','kpis_campanhas','lead_hwrocha (autistas)','leads_hwrocha_agente1',
    'metricas_campanhas','n8n_chat_agent_sdr','n8n_chat_histories','n8n_chat_histories_copy',
    'n8n_chat_histories_criativos','relatorio_semanal_campanhas','rr_state','rate_limits',
    'reps_schedules','reps_config_default'] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;

-- 3) reps_config: o n8n lê com a chave pública (24 leituras/dia). Mantém só a leitura.
DO $$ BEGIN
  IF to_regclass('public.reps_config') IS NOT NULL THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.reps_config FROM anon, authenticated;
  END IF;
END $$;

-- 4) Escritórios: qualquer conta logada podia ler, renomear e desativar TODOS os escritórios.
--    Agora: cada um vê só os escritórios de que é membro (super admin continua vendo todos).
--    Gravação continua só pelo servidor do CRM.
DROP POLICY IF EXISTS "authenticated_access" ON public.organizations;
CREATE POLICY organizations_member_select ON public.organizations
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND id IN (SELECT public.user_org_ids(auth.uid())));

-- 5) Perfis: qualquer conta logada lia nome, e-mail e telefone de TODOS os usuários de todos os escritórios.
--    Agora: o próprio perfil e os colegas de escritório (super admin continua vendo todos).
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY profiles_same_org_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_org_ids(profiles.id) theirs
               WHERE theirs IN (SELECT public.user_org_ids(auth.uid())))
  );

-- 6) Quadros e etapas: regra extra deixava criar quadro/etapa em escritório alheio.
--    A regra certa (só no próprio escritório) já existe e continua.
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.boards;
DROP POLICY IF EXISTS "Enable insert access for authenticated users" ON public.board_stages;

-- 7) Fases do ciclo de vida: tabela ÚNICA para todos os escritórios; qualquer usuário podia
--    renomear ou apagar e mudava para todo mundo. Agora todos leem, só super admin altera.
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.lifecycle_stages;
CREATE POLICY lifecycle_stages_read ON public.lifecycle_stages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY lifecycle_stages_superadmin_write ON public.lifecycle_stages
  FOR ALL TO authenticated
  USING (public.current_user_is_super_admin())
  WITH CHECK (public.current_user_is_super_admin());

-- 8) Funções que a chave pública conseguia chamar sem conferir quem chama.
--    Nenhuma é chamada pelo navegador; os webhooks usam a chave de serviço.
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['public.seed_default_board(uuid)','public.cleanup_rate_limits(integer)',
    'public.get_platform_user_stats(uuid)','public.get_contact_stage_counts()','public.wa_increment_unread(uuid)'] LOOP
    IF to_regprocedure(f) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
    END IF;
  END LOOP;
END $$;
