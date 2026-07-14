-- Grupos de campos personalizados: permite separar campos por produto/pipeline
-- (ex.: grupo "BPC LOAS", grupo "Revisional") em vez de uma lista única.
-- NULL = campo desagrupado (comportamento atual preservado).
ALTER TABLE public.custom_field_definitions
  ADD COLUMN IF NOT EXISTS group_name TEXT;
