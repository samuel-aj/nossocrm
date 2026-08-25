-- Webhook da Meta: cura periódica compartilhada + espelho para outro sistema.
--   forward_webhook_url  : URL de outro sistema que também recebe os webhooks
--                          brutos da Meta deste número (assinados com o app secret)
--   last_webhook_heal_at : trava compartilhada entre instâncias da edge function
--                          (só uma cura a cada 10 min por conexão; evita #80008)
--   token_renewed_at     : última renovação do token do Cadastro Embutido (1x/dia)
ALTER TABLE public.wa_connections ADD COLUMN IF NOT EXISTS forward_webhook_url TEXT;
ALTER TABLE public.wa_connections ADD COLUMN IF NOT EXISTS last_webhook_heal_at TIMESTAMPTZ;
ALTER TABLE public.wa_connections ADD COLUMN IF NOT EXISTS token_renewed_at TIMESTAMPTZ;
