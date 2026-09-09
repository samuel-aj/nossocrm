-- =============================================================================
-- Agente de IA: liberação do super admin vale também nos gatilhos do BANCO
-- =============================================================================
-- ADITIVO e idempotente. Desde 31/08 o app libera o agente de IA pela chave
-- `wa_ai_agents_approved` (ligada pelo super admin; a antiga `wa_agents_beta`
-- segue valendo — ver lib/wa-agents/beta.ts). Só que os gatilhos do banco
-- (wa_ai_agent_ingest, wa_ai_agent_state e wa_bot_on_deal) checam
-- wa_agents_beta_enabled(), que só conhecia a chave ANTIGA: uma org aprovada
-- pela chave nova configurava e ativava o agente na interface, mas o banco
-- nunca acionava o motor — o agente "ativava" e não respondia, e os gatilhos
-- de mensagem/cadastro não disparavam (caso Nitole & Crai, 03/09/2026).
-- Esta função é o único gate: corrigi-la conserta os três caminhos de uma vez.

CREATE OR REPLACE FUNCTION public.wa_agents_beta_enabled(p_org uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ai_feature_flags f
    WHERE f.organization_id = p_org
      AND f.key IN ('wa_agents_beta', 'wa_ai_agents_approved')
      AND f.enabled = true
  );
$$;

COMMENT ON FUNCTION public.wa_agents_beta_enabled(uuid) IS
  'org pode usar o agente de IA nativo: chave nova wa_ai_agents_approved (super admin) OU a antiga wa_agents_beta — espelho de isAiAgentsApproved em lib/wa-agents/beta.ts';
