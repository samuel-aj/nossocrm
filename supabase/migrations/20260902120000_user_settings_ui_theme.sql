-- Aparência e tema por usuário (Configurações → Aparência).
-- ui_theme: 'roxo' | 'grafite' | 'azul' | 'esmeralda' | 'ambar' | 'rosa' (null = roxo, o padrão)
-- ui_mode:  'light' | 'dark' | 'system' (null = o antigo dark_mode)
-- Aditiva e reversível; ninguém muda de tema sozinho (null = visual atual).
ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS ui_theme TEXT,
  ADD COLUMN IF NOT EXISTS ui_mode TEXT;

COMMENT ON COLUMN public.user_settings.ui_theme IS 'Tema (paleta) escolhido pelo usuário; null = roxo (padrão da plataforma)';
COMMENT ON COLUMN public.user_settings.ui_mode IS 'Aparência: light | dark | system; null = usa dark_mode';
