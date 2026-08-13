-- Excluir uma conexão NUNCA pode apagar histórico: a FK das conversas deixa
-- de ser CASCADE e vira SET NULL (conversas ficam, órfãs de conexão).
ALTER TABLE public.wa_conversations
  DROP CONSTRAINT IF EXISTS wa_conversations_connection_id_fkey;
ALTER TABLE public.wa_conversations
  ADD CONSTRAINT wa_conversations_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES public.wa_connections(id) ON DELETE SET NULL;
