-- Grupos de campos personalizados como ENTIDADE própria: permite criar um
-- grupo vazio (sem precisar criar um campo junto) e gerenciá-los direto.
-- custom_field_definitions.group_name continua sendo o vínculo (por nome).
CREATE TABLE IF NOT EXISTS public.custom_field_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_custom_field_groups_org_name UNIQUE (organization_id, name)
);
ALTER TABLE public.custom_field_groups ENABLE ROW LEVEL SECURITY;
-- (sem policies de usuário: leitura/escrita via API com service role, org-scoped)

-- Backfill: grupos que já existem implicitamente nos campos
INSERT INTO public.custom_field_groups (organization_id, name)
SELECT DISTINCT organization_id, btrim(group_name)
FROM public.custom_field_definitions
WHERE group_name IS NOT NULL AND btrim(group_name) <> ''
ON CONFLICT (organization_id, name) DO NOTHING;
