-- =============================================================================
-- ETAPA "INATIVOS" (estacionamento de leads sem resposta) — opcional por org
--
-- - deals.inactive_at: quando o lead foi guardado em Inativos (null = ativo).
--   O lead NÃO muda de estágio: ao voltar (manual ou pelos 30 dias), reaparece
--   na coluna onde estava.
-- - organization_settings.inactive_leads_enabled: liga/desliga a etapa por
--   organização (Configurações; padrão desligado).
-- - Devolução automática: cron /api/cron/inactive-return (30 dias) limpa o
--   inactive_at e cria uma notificação em system_notifications.
-- =============================================================================

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS inactive_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_deals_inactive
    ON public.deals(inactive_at)
    WHERE inactive_at IS NOT NULL;

ALTER TABLE public.organization_settings
    ADD COLUMN IF NOT EXISTS inactive_leads_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.deals.inactive_at IS
    'Lead guardado em "Inativos" desde este momento (null = ativo). Devolvido automaticamente após 30 dias pelo cron inactive-return.';
COMMENT ON COLUMN public.organization_settings.inactive_leads_enabled IS
    'Habilita a etapa "Inativos" no Kanban desta organização (opcional; padrão desligado).';
