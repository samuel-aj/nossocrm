import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadDealItems } from './dealItems';
import { renderJsonTemplate } from './template';

function client(data: unknown[], error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error }),
  };
  const from = vi.fn(() => query);
  return { admin: { from } as unknown as SupabaseClient, query, from };
}

describe('webhook deal items', () => {
  it('loads all items scoped to the organization and deal, preserving custom items', async () => {
    const items = [
      { product_id: 'product-a', name: 'Conta "hackeada"', quantity: 1, price: '100.50' },
      { product_id: null, name: 'Serviço avulso', quantity: 2, price: 0 },
    ];
    const { admin, query, from } = client(items);
    const result = await loadDealItems(admin, 'org-a', 'deal-a');
    expect(from).toHaveBeenCalledWith('deal_items');
    expect(query.eq.mock.calls).toEqual([['organization_id', 'org-a'], ['deal_id', 'deal-a']]);
    expect(result).toEqual([{ ...items[0], price: 100.5 }, items[1]]);
    expect(renderJsonTemplate('{"items": {{deal.items}}}', { deal: { items: result } })).toEqual({ items: result });
  });

  it('returns an empty list for deals without products', async () => {
    expect(await loadDealItems(client([]).admin, 'org-a', 'deal-a')).toEqual([]);
  });

  it('does not disguise a database failure as a deal without products', async () => {
    await expect(loadDealItems(client([], { message: 'query failed' }).admin, 'org-a', 'deal-a')).rejects.toThrow();
  });
});
