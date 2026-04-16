-- Adiciona coluna `description` à tabela deals.
-- Texto livre exibido como primeiro bloco da timeline do modal de detalhes.

ALTER TABLE public.deals
    ADD COLUMN IF NOT EXISTS description TEXT;
