-- =============================================================================
-- Etiquetas na conversa do WhatsApp
-- =============================================================================
-- ADITIVO. Mesmo formato das etiquetas do negócio (deals.tags): lista de texto
-- livre por conversa, sem tabela nova — a org já mantém a lista de etiquetas
-- disponíveis e o CRM inteiro usa esse padrão.
--
-- O RESPONSÁVEL da conversa (assigned_owner_id) já existia na tabela: até
-- agora só o agente de IA escrevia nele (ação "definir responsável"), sem
-- nenhuma tela. Agora a equipe também define pelo chat.
-- =============================================================================

ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- Filtrar a lista por etiqueta e por responsável fica barato mesmo com muitas
-- conversas na organização.
CREATE INDEX IF NOT EXISTS idx_wa_conversations_tags
  ON public.wa_conversations USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_wa_conversations_owner
  ON public.wa_conversations (organization_id, assigned_owner_id);
