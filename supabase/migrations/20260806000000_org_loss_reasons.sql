-- Motivos de perda personalizáveis por organização.
-- NULL = usar os motivos padrão do sistema.
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS loss_reasons_qualified TEXT[],
  ADD COLUMN IF NOT EXISTS loss_reasons_disqualified TEXT[];
