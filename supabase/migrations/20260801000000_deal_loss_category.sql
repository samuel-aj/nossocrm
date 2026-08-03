-- Categoria da perda do deal: o lead era QUALIFICADO (perdeu por objeção,
-- preço, timing) ou DESQUALIFICADO (sem perfil, sem orçamento, dados ruins)?
-- O modal de motivo de perda já perguntava isso, mas a resposta era
-- descartada: sem esta coluna, o relatório contava tudo como qualificado.
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS loss_category TEXT
  CHECK (loss_category IN ('qualified', 'disqualified'));
