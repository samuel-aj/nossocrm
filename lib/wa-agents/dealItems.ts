import type { SupabaseClient } from '@supabase/supabase-js';
import { WaAgentError } from './errors';

export type ContextDealItem = {
  product_id: string | null;
  name: string;
  quantity: number;
  price: number;
};

/** Produtos acompanham o negócio mesmo quando ele muda de pipeline. */
export async function loadDealItems(
  admin: SupabaseClient,
  organizationId: string,
  dealId: string,
): Promise<ContextDealItem[]> {
  const { data, error } = await admin
    .from('deal_items')
    .select('product_id, name, quantity, price')
    .eq('organization_id', organizationId)
    .eq('deal_id', dealId)
    .order('created_at');
  if (error) throw new WaAgentError('DB_ERROR', 'Não foi possível carregar os produtos do negócio');
  return (data ?? []).map(item => ({
    product_id: item.product_id ?? null,
    name: item.name,
    quantity: Number(item.quantity),
    price: Number(item.price),
  }));
}
