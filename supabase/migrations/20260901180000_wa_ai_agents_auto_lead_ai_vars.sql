-- =============================================================================
-- Agentes de IA: lead automático e variáveis preenchidas pela IA
-- =============================================================================
-- ADITIVO e idempotente. Duas colunas jsonb em wa_ai_agents, sem FK nova
-- (board/stage do auto_lead são validados pela API, como nos gatilhos):
--
-- 1. auto_lead: { enabled, board_id, stage_id }. Ligado, o agente cria um lead
--    quando o contato da conversa ainda não tem NENHUM negócio aberto (a
--    checagem roda dentro da trava por conversa do motor, então não duplica).
--    board_id/stage_id nulos = primeiro quadro / primeira etapa.
--
-- 2. ai_vars: [{ name, instruction, example }]. Variáveis {{ia:nome}} usadas
--    nos campos de texto das ações; na execução a IA do agente analisa a
--    conversa e preenche o valor antes de a ação rodar.
-- =============================================================================

ALTER TABLE public.wa_ai_agents
  ADD COLUMN IF NOT EXISTS auto_lead JSONB NOT NULL
    DEFAULT '{"enabled": false, "board_id": null, "stage_id": null}'::jsonb,
  ADD COLUMN IF NOT EXISTS ai_vars JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.wa_ai_agents.auto_lead IS
  'lead automático: { enabled, board_id, stage_id } — cria lead quando o contato não tem negócio aberto';
COMMENT ON COLUMN public.wa_ai_agents.ai_vars IS
  'variáveis preenchidas pela IA nas ações: [{ name, instruction, example }] — usadas como {{ia:nome}}';
