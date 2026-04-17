-- Habilita Supabase Realtime para deal_items.
--
-- Necessário para sincronização em tempo real dos produtos do lead entre usuários.
-- REPLICA IDENTITY FULL é exigida para que eventos DELETE carreguem o deal_id
-- (não só a PK), permitindo localizar o deal pai no cache do cliente.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'deal_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deal_items;
  END IF;
END $$;

ALTER TABLE public.deal_items REPLICA IDENTITY FULL;
