-- =============================================================================
-- Filtro de status PADRÃO do quadro (Em aberto | Ganhos | Perdidos | Todos)
-- =============================================================================
-- ADITIVO e idempotente. O quadro sempre abria em "Em aberto" (valor fixo no
-- código). Agora cada organização escolhe em Configurações > CRM com qual
-- filtro o quadro abre. NULL = "open" (comportamento de sempre).

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS default_deal_status_filter TEXT;

ALTER TABLE public.organization_settings
  DROP CONSTRAINT IF EXISTS organization_settings_default_deal_status_filter_check;

ALTER TABLE public.organization_settings
  ADD CONSTRAINT organization_settings_default_deal_status_filter_check
  CHECK (default_deal_status_filter IS NULL
         OR default_deal_status_filter IN ('open', 'won', 'lost', 'all'));

COMMENT ON COLUMN public.organization_settings.default_deal_status_filter IS
  'filtro de status com que o quadro abre (open|won|lost|all); NULL = open';
