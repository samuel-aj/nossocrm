-- Segurança (24/11/2026), item "monitorar e registrar eventos críticos no
-- back-end". O CRM já tinha a tabela audit_logs, mas só as ações do super admin
-- eram gravadas e nada garantia que o registro fosse confiável.
--
-- O que este arquivo faz:
--   1) tranca audit_logs (e security_alerts, sem uso): só a chave de serviço lê
--      e grava. Ninguém altera nem apaga registro pelo navegador;
--   2) registra sozinho, no banco, o que é gravado direto pelo navegador e por
--      isso não passa por rota do servidor: webhooks (entrada e saída) e troca
--      de papel de usuário (inclusive feita pelo SQL Editor);
--   3) remove a função de leitura do histórico do Supabase Auth, criada na
--      primeira versão e sem uso (o CRM grava os logins por conta própria);
--   4) guarda os registros por 180 dias.
--
-- Não apaga dado nem muda regra das telas. Os gatilhos nunca bloqueiam a
-- gravação original: se o registro falhar, a operação segue.

-- 0) Trava de segurança: se alguma função do banco grava em audit_logs com a
--    permissão do próprio usuário, trancar a tabela quebraria essa função.
--    Nesse caso para aqui e nada muda.
DO $$
DECLARE f text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO f
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind = 'f' AND NOT p.prosecdef
    AND p.prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?audit_logs';
  IF f IS NOT NULL THEN
    RAISE EXCEPTION 'Parei sem mudar nada. Estas funcoes gravam em audit_logs com a permissao do usuario: %', f;
  END IF;
END $$;

-- 1) Tabela de registros -------------------------------------------------------
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS ip_address text;
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS user_agent text;
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_org_created_at_idx ON public.audit_logs (organization_id, created_at DESC);

DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('audit_logs', 'security_alerts')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.audit_logs TO service_role;

DO $$
BEGIN
  IF to_regclass('public.security_alerts') IS NOT NULL THEN
    ALTER TABLE public.security_alerts ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON public.security_alerts FROM PUBLIC, anon, authenticated;
    GRANT ALL ON public.security_alerts TO service_role;
  END IF;
  -- Função antiga que deixava qualquer conta logada inventar um registro.
  IF to_regprocedure('public.log_audit_event(text,text,uuid,jsonb,text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.log_audit_event(text, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.log_audit_event(text, text, uuid, jsonb, text) TO service_role;
  END IF;
END $$;

-- 2) Registro automático do que o navegador grava direto ------------------------
CREATE OR REPLACE FUNCTION public.audit_sensitive_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  o jsonb;
  n jsonb;
  r jsonb;
  v_action text;
  v_type text;
  v_severity text := 'warning';
  v_details jsonb;
  v_org uuid;
  v_resource uuid;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      o := to_jsonb(OLD);
    ELSIF TG_OP = 'INSERT' THEN
      n := to_jsonb(NEW);
    ELSE
      o := to_jsonb(OLD);
      n := to_jsonb(NEW);
    END IF;
    r := COALESCE(n, o);

    IF TG_TABLE_NAME = 'profiles' THEN
      IF TG_OP <> 'UPDATE' OR (o->>'role') IS NOT DISTINCT FROM (n->>'role') THEN
        RETURN NULL;
      END IF;
      v_action := 'user.role_changed';
      v_type := 'user';
      v_details := jsonb_build_object('de', o->>'role', 'para', n->>'role', 'email', n->>'email');
      IF 'super_admin' IN (o->>'role', n->>'role') THEN
        v_severity := 'critical';
      END IF;
    ELSE
      -- updated_at sozinho não é mudança.
      IF TG_OP = 'UPDATE' AND (o - 'updated_at') = (n - 'updated_at') THEN
        RETURN NULL;
      END IF;
      v_type := 'webhook';
      v_action := CASE TG_TABLE_NAME
          WHEN 'integration_outbound_endpoints' THEN 'webhook.outbound.'
          ELSE 'webhook.inbound.'
        END || CASE TG_OP WHEN 'INSERT' THEN 'created' WHEN 'UPDATE' THEN 'changed' ELSE 'removed' END;
      -- Nunca o segredo; da URL só o servidor de destino.
      v_details := jsonb_strip_nulls(jsonb_build_object(
        'name', r->>'name',
        'active', r->'active',
        'destino', substring(lower(r->>'url') from '^[a-z]+://(?:[^/@]*@)?([^/:?#]+)'),
        'events', r->'events',
        'segredo_trocado', CASE WHEN TG_OP = 'UPDATE' THEN (o->>'secret') IS DISTINCT FROM (n->>'secret') END,
        'destino_trocado', CASE WHEN TG_OP = 'UPDATE' AND r ? 'url' THEN (o->>'url') IS DISTINCT FROM (n->>'url') END
      ));
    END IF;

    v_org := NULLIF(r->>'organization_id', '')::uuid;
    v_resource := NULLIF(r->>'id', '')::uuid;

    INSERT INTO public.audit_logs (user_id, organization_id, action, resource_type, resource_id, details, severity)
    VALUES (auth.uid(), v_org, v_action, v_type, v_resource, v_details, v_severity);
  EXCEPTION WHEN OTHERS THEN
    -- O registro nunca pode impedir a gravação original.
    RAISE WARNING 'audit_sensitive_change: %', SQLERRM;
  END;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.audit_sensitive_change() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_profile_role ON public.profiles;
CREATE TRIGGER trg_audit_profile_role
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_change();

DO $$
BEGIN
  IF to_regclass('public.integration_outbound_endpoints') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_outbound_endpoints ON public.integration_outbound_endpoints;
    CREATE TRIGGER trg_audit_outbound_endpoints
      AFTER INSERT OR UPDATE OR DELETE ON public.integration_outbound_endpoints
      FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_change();
  END IF;
  IF to_regclass('public.integration_inbound_sources') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_inbound_sources ON public.integration_inbound_sources;
    CREATE TRIGGER trg_audit_inbound_sources
      AFTER INSERT OR UPDATE OR DELETE ON public.integration_inbound_sources
      FOR EACH ROW EXECUTE FUNCTION public.audit_sensitive_change();
  END IF;
END $$;

-- 3) Login -------------------------------------------------------------------------
-- O login bem-sucedido e a senha recusada são gravados pelo próprio CRM
-- (/api/security/login e /api/security/login-failed). A primeira versão deste
-- arquivo criava uma função que lia o histórico do Supabase Auth, mas neste
-- projeto esse histórico não é guardado no banco. Se ela existir, sai.
DROP FUNCTION IF EXISTS public.security_auth_events(timestamptz, integer);

-- 4) Retenção: 180 dias ----------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('audit-logs-retention', '17 4 * * *',
      $job$DELETE FROM public.audit_logs WHERE created_at < now() - interval '180 days'$job$);
  END IF;
END $$;
