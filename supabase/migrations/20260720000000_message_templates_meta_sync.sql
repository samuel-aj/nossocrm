-- Sincronização dos modelos WhatsApp API com a Meta (Cloud API):
--   meta_name   = nome do template na Meta (minusculas_underscore, gerado do name)
--   meta_status = status na Meta (PENDING | APPROVED | REJECTED), atualizado
--                 na criação e pelo botão Sincronizar
--   synced_at   = quando o modelo foi sincronizado pela última vez
-- Já aplicada no staging via MCP como message_templates_meta_sync; este arquivo
-- registra a mudança no repo pra aplicar em produção na promoção da branch.
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS meta_name TEXT,
  ADD COLUMN IF NOT EXISTS meta_status TEXT,
  ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ;
