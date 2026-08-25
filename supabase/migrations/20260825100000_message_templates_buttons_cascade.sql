-- Modelos da API oficial:
--   * buttons: botões do template (Resposta rápida | Link | Telefone), no
--     formato { type, text, url?, phone_number? } — criados na Meta junto com
--     o corpo e devolvidos na sincronização.
--   * connection_id passa a CASCADE: o modelo vive na WABA do número; se a
--     conexão é excluída do CRM, os modelos dela não podem mais ser enviados
--     (antes ficavam órfãos com connection_id NULL e apareciam na lista).
ALTER TABLE public.message_templates ADD COLUMN IF NOT EXISTS buttons JSONB;
ALTER TABLE public.message_templates DROP CONSTRAINT IF EXISTS message_templates_connection_id_fkey;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_connection_id_fkey
  FOREIGN KEY (connection_id) REFERENCES public.wa_connections(id) ON DELETE CASCADE;
