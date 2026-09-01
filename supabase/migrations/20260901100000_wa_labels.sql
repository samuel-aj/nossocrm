-- =============================================================================
-- Etiquetas do WhatsApp, no modelo do WhatsApp Business
-- =============================================================================
-- A etiqueta é uma ENTIDADE DA ORGANIZAÇÃO (nome + cor), não um texto solto
-- por conversa: renomear ou trocar a cor reflete em todos os chats, e a lista
-- de opções é a mesma pra equipe inteira.
--
-- Substitui o rascunho anterior (wa_conversations.tags, TEXT[]), que nunca
-- chegou a ser aplicado em nenhum ambiente. Se a coluna existir em algum
-- banco, ela simplesmente deixa de ser usada.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.wa_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (btrim(name) <> '' AND length(name) <= 40),
  -- Chave da cor (ex.: 'blue'), não o hex: quem manda no tom é o tema do CRM.
  color TEXT NOT NULL DEFAULT 'slate',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nome único por organização, sem diferenciar maiúscula/minúscula: evita
-- "Cliente" e "cliente" convivendo e confundindo quem etiqueta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_labels_org_nome
  ON public.wa_labels (organization_id, lower(btrim(name)));

ALTER TABLE public.wa_labels ENABLE ROW LEVEL SECURITY;

-- Quais etiquetas a conversa tem. Array (e não tabela de ligação) porque a
-- leitura é sempre "as etiquetas DESTA conversa" e o GIN resolve o filtro.
ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS label_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_wa_conversations_label_ids
  ON public.wa_conversations USING GIN (label_ids);

-- Filtrar a lista por responsável (o outro filtro da tela) sem varrer tudo.
CREATE INDEX IF NOT EXISTS idx_wa_conversations_owner
  ON public.wa_conversations (organization_id, assigned_owner_id);

-- Apagar a etiqueta tira ela das conversas: sem isso ficariam ids órfãos e o
-- chat mostraria etiqueta que não existe mais.
CREATE OR REPLACE FUNCTION public.wa_labels_after_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.wa_conversations
     SET label_ids = array_remove(label_ids, OLD.id)
   WHERE organization_id = OLD.organization_id
     AND label_ids @> ARRAY[OLD.id];
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_labels_after_delete ON public.wa_labels;
CREATE TRIGGER trg_wa_labels_after_delete
  AFTER DELETE ON public.wa_labels
  FOR EACH ROW EXECUTE FUNCTION public.wa_labels_after_delete();
