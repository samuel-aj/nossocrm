-- Ordem manual dos campos personalizados (dentro do grupo) e dos grupos
-- (Configurações → CRM → Campos personalizados, arrastar para reordenar).
-- Aditiva: null = sem ordem manual (a tela cai na ordem de criação / alfabética).
ALTER TABLE public.custom_field_definitions
  ADD COLUMN IF NOT EXISTS position INTEGER;

ALTER TABLE public.custom_field_groups
  ADD COLUMN IF NOT EXISTS position INTEGER;

COMMENT ON COLUMN public.custom_field_definitions.position IS 'Ordem manual dentro do grupo (null = ordem de criação)';
COMMENT ON COLUMN public.custom_field_groups.position IS 'Ordem manual dos grupos (null = alfabética)';
