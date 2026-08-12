-- App ID + Chave Secreta do app da Meta (modo meta_cloud): salvos pra edição
-- abrir preenchida e pro reconectar reusar sem redigitar
ALTER TABLE public.wa_connections ADD COLUMN IF NOT EXISTS meta_app_id TEXT;
ALTER TABLE public.wa_connections ADD COLUMN IF NOT EXISTS meta_app_secret TEXT;
