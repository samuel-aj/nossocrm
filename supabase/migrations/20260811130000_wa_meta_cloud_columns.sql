-- Modo DIRETO na Cloud API da Meta (provider 'meta_cloud'), sem Evolution.
-- Guarda o phone_number_id (destino do envio) e o WABA id (templates) da Meta.
-- Colunas nullable, usadas só pelo provider meta_cloud; os demais providers
-- (evolution / evolution_business) as deixam nulas.
ALTER TABLE public.wa_connections
  ADD COLUMN IF NOT EXISTS meta_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_waba_id TEXT;
