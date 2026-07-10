-- Excluir um produto do catálogo não pode ficar bloqueado pelos leads que já
-- o usam (erro: "violates foreign key constraint deal_items_product_id_fkey").
-- deal_items guarda snapshot próprio de name/price (NOT NULL), então a
-- referência ao catálogo pode ser solta (SET NULL) preservando o histórico
-- de itens dos leads.
alter table public.deal_items
  drop constraint if exists deal_items_product_id_fkey;

alter table public.deal_items
  add constraint deal_items_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;
