-- =============================================================================
-- Tags nos CONTATOS (adicionar/remover em massa pela lista de contatos)
-- =============================================================================
-- ADITIVO e idempotente. Os negócios (deals) sempre tiveram tags; os contatos
-- não. A lista de contatos ganha ações em massa de tags, e a tag mora no
-- próprio contato (segmentação independente do lead).

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Filtros futuros por tag ("contatos com a tag X") sem varredura completa
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON public.contacts USING GIN (tags);

COMMENT ON COLUMN public.contacts.tags IS
  'tags do contato (texto livre, sem duplicar por contato); em massa pela lista de contatos';
