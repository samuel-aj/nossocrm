-- =============================================================================
-- Registro de eventos críticos (24/11/2026): REVERSÃO
-- =============================================================================
-- O que entrou: migração 20261124150000_seguranca_registro_eventos.sql (banco)
-- e o código que grava e mostra os eventos (painel "Registro de segurança" na
-- página de super admin).
--
-- Quando usar: só se salvar webhook ou trocar papel de usuário passar a falhar
-- (os gatilhos foram feitos para nunca bloquear, mas este é o desligamento).
-- O código novo continua funcionando sem os gatilhos: ele só deixa de receber
-- os registros automáticos de webhook e de troca de papel.
--
-- A tabela audit_logs continua trancada (só a chave de serviço lê e grava).
-- Nada no CRM lê essa tabela pelo navegador, então não há o que destrancar.
--
-- Código: Vercel > Deployments > "Instant Rollback" no deploy anterior,
-- ou `git revert -m 1 <commit do merge>` e push na main. O código antigo
-- funciona normalmente com este banco (não precisa rodar nada antes).
-- =============================================================================
BEGIN;
DROP TRIGGER IF EXISTS trg_audit_profile_role ON public.profiles;
DROP TRIGGER IF EXISTS trg_audit_outbound_endpoints ON public.integration_outbound_endpoints;
DROP TRIGGER IF EXISTS trg_audit_inbound_sources ON public.integration_inbound_sources;
DROP FUNCTION IF EXISTS public.audit_sensitive_change();
DROP FUNCTION IF EXISTS public.security_auth_events(timestamptz, integer);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'audit-logs-retention';
  END IF;
END $$;
COMMIT;
