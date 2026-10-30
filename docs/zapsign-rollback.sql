-- =============================================================================
-- ZapSign: REVERSÃO no banco (produção ou staging)
-- =============================================================================
-- Use só se a integração precisar sair do ar. Rode no SQL Editor do Supabase.
--
-- O que desfaz, na ordem segura:
--   1) o trigger em deals (única coisa que toca o fluxo normal do CRM);
--   2) a condição de assinaturas no relógio wa-agents-tick (volta ao comando anterior);
--   3) as funções e tabelas da integração (apaga regras, documentos e tokens).
--
-- Passo 1 sozinho já basta para "desligar" a integração sem perder dados:
-- o código antigo (tag prod-pre-zapsign) não lê nenhuma dessas tabelas.
-- Os passos 2 e 3 só se quiser limpar tudo.
--
-- Código: Vercel > Deployments > "Instant Rollback" no deploy anterior,
-- ou `git revert -m 1 <commit do merge>` e push na main.
-- =============================================================================

-- 1) Trigger em deals (desliga a preparação do contrato ao mudar de etapa)
DROP TRIGGER IF EXISTS trg_signature_on_deal_change ON public.deals;

-- 2) Relógio: tira as condições de deal_signatures do wa-agents-tick
DO $$
DECLARE
  jid bigint;
  cmd text;
BEGIN
  SELECT jobid, command INTO jid, cmd FROM cron.job WHERE jobname = 'wa-agents-tick';
  IF jid IS NOT NULL AND cmd LIKE '%deal_signatures%' THEN
    cmd := replace(cmd, E'\n          OR EXISTS (SELECT 1 FROM public.deal_signatures WHERE status = ''queued'' AND next_attempt_at <= now())', '');
    cmd := replace(cmd, E'\n          OR EXISTS (SELECT 1 FROM public.deal_signatures WHERE status = ''processing'' AND lock_until < now())', '');
    PERFORM cron.alter_job(jid, command := cmd);
  END IF;
END;
$$;

-- 3) Funções e tabelas (APAGA regras, documentos enviados e tokens da ZapSign)
DROP FUNCTION IF EXISTS crm_internal.signature_on_deal_change();
DROP TRIGGER IF EXISTS trg_signature_rule_before ON public.stage_signature_rules;
DROP FUNCTION IF EXISTS crm_internal.signature_rule_before();
DROP FUNCTION IF EXISTS public.deal_signature_claim(integer);
DROP TABLE IF EXISTS public.zapsign_webhook_events;
DROP TABLE IF EXISTS public.deal_signatures;
DROP TABLE IF EXISTS public.stage_signature_rules;
DROP TABLE IF EXISTS public.zapsign_settings;
