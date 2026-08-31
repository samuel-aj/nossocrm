-- =============================================================================
-- Automações saem da beta: robô livre, agente de IA liberado pelo super admin
-- =============================================================================
-- Antes: uma única chave `wa_agents_beta` por organização, ligada pelo ADMIN
-- DO CLIENTE, travava robôs E agentes.
--
-- Agora:
--   ROBÔS          -> liberados para todas as organizações (sem chave nenhuma)
--   AGENTE DE IA   -> chave `wa_ai_agents_approved`, ligada só pelo SUPER ADMIN
--                     da agência (o agente é vendido caso a caso)
--
-- Esta migração copia a chave antiga para a nova, para que nenhuma organização
-- que já usava o agente perca o acesso na virada. A chave antiga continua
-- sendo lida como equivalente (ver lib/wa-agents/beta.ts), então dá pra voltar
-- atrás sem perder nada.
-- =============================================================================

INSERT INTO public.ai_feature_flags (organization_id, key, enabled, updated_at)
SELECT organization_id, 'wa_ai_agents_approved', enabled, now()
FROM public.ai_feature_flags
WHERE key = 'wa_agents_beta'
ON CONFLICT (organization_id, key) DO UPDATE
  SET enabled = EXCLUDED.enabled,
      updated_at = now();
