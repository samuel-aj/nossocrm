-- Grupos de campos personalizados ocultos POR BOARD (pipeline):
-- nomes de grupos listados aqui não aparecem no card do lead desse board.
-- NULL/ausente = todos os grupos visíveis (padrão).
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS hidden_field_groups TEXT[];
