/**
 * @fileoverview Serviço Supabase para catálogo de produtos/serviços.
 *
 * Observação:
 * - O CRM é "adaptável": o catálogo é um acelerador (defaults).
 * - No deal, ainda permitimos itens personalizados (product_id pode ser NULL em deal_items).
 */

import { supabase } from './client';
import { Product } from '@/types';
import { sanitizeUUID } from './utils';

/**
 * Recalcula o valor total (soma de preço×quantidade dos itens) de vários deals
 * de uma vez: leitura em lote + escrita em paralelo por blocos. Evita centenas
 * de idas ao servidor em série quando um produto muito usado muda de preço.
 */
async function recalcDealsValues(dealIds: string[]): Promise<void> {
  if (!supabase || dealIds.length === 0) return;
  const READ = 100;
  const totals = new Map<string, number>();
  for (let i = 0; i < dealIds.length; i += READ) {
    const chunk = dealIds.slice(i, i + READ);
    const { data: items } = await supabase
      .from('deal_items')
      .select('deal_id, price, quantity')
      .in('deal_id', chunk);
    for (const it of items || []) {
      const cur = totals.get(it.deal_id) || 0;
      totals.set(it.deal_id, cur + Number(it.price) * Number(it.quantity));
    }
  }
  const now = new Date().toISOString();
  const WRITE = 25;
  for (let i = 0; i < dealIds.length; i += WRITE) {
    const chunk = dealIds.slice(i, i + WRITE);
    await Promise.all(
      chunk.map((id) => supabase!.from('deals').update({ value: totals.get(id) || 0, updated_at: now }).eq('id', id))
    );
  }
}

// =============================================================================
// Organization inference (client-side, RLS-safe)
// =============================================================================
let cachedOrgId: string | null = null;
let cachedOrgUserId: string | null = null;

export function invalidateOrgCache() {
  cachedOrgId = null;
  cachedOrgUserId = null;
}

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  if (cachedOrgUserId === user.id && cachedOrgId) return cachedOrgId;

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (error) return null;

  const orgId = sanitizeUUID((profile as any)?.organization_id);
  cachedOrgUserId = user.id;
  cachedOrgId = orgId;
  return orgId;
}

type DbProduct = {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  price: number;
  sku: string | null;
  active: boolean | null;
  created_at: string;
  updated_at: string;
  owner_id: string | null;
};

function transformProduct(db: DbProduct): Product {
  return {
    id: db.id,
    organizationId: db.organization_id || undefined,
    name: db.name,
    description: db.description || undefined,
    price: Number(db.price ?? 0),
    sku: db.sku || undefined,
    active: db.active ?? true,
  };
}

export const productsService = {
  async getAll(): Promise<{ data: Product[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      const orgId = await getCurrentOrganizationId();
      if (!orgId) return { data: [], error: new Error('Organização não encontrada') };

      const { data, error } = await supabase
        .from('products')
        .select('id, organization_id, name, description, price, sku, active, created_at, updated_at, owner_id')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });

      if (error) return { data: [], error };

      const rows = (data || []) as DbProduct[];
      // Por padrão mostramos só ativos na UI do deal; mas aqui retorna tudo para o Settings.
      return { data: rows.map(transformProduct), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async getActive(): Promise<{ data: Product[]; error: Error | null }> {
    try {
      if (!supabase) return { data: [], error: new Error('Supabase não configurado') };

      const orgId = await getCurrentOrganizationId();
      if (!orgId) return { data: [], error: new Error('Organização não encontrada') };

      const { data, error } = await supabase
        .from('products')
        .select('id, organization_id, name, description, price, sku, active, created_at, updated_at, owner_id')
        .eq('organization_id', orgId)
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (error) return { data: [], error };

      const rows = (data || []) as DbProduct[];
      return { data: rows.map(transformProduct), error: null };
    } catch (e) {
      return { data: [], error: e as Error };
    }
  },

  async create(input: { name: string; price: number; sku?: string; description?: string }): Promise<{ data: Product | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: { user } } = await supabase.auth.getUser();
      const organizationId = await getCurrentOrganizationId();

      const { data, error } = await supabase
        .from('products')
        .insert({
          name: input.name,
          price: input.price,
          sku: input.sku || null,
          description: input.description || null,
          active: true,
          owner_id: sanitizeUUID(user?.id),
          organization_id: organizationId,
        })
        .select('id, organization_id, name, description, price, sku, active, created_at, updated_at, owner_id')
        .single();

      if (error) return { data: null, error };
      return { data: transformProduct(data as DbProduct), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  async update(
    id: string,
    updates: Partial<{ name: string; price: number; sku?: string; description?: string; active: boolean }>
  ): Promise<{ error: Error | null; retro?: { items: number; deals: number } }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };

      const productId = sanitizeUUID(id);

      // Preço antigo ANTES de salvar: é ele que identifica os itens de leads
      // que apenas herdaram o padrão do produto (não foram negociados à mão).
      let oldPrice: number | null = null;
      if (updates.price !== undefined) {
        const { data: current } = await supabase
          .from('products')
          .select('price')
          .eq('id', productId)
          .single();
        oldPrice = Number(current?.price ?? 0);
      }

      const payload: Record<string, unknown> = {};
      if (updates.name !== undefined) payload.name = updates.name;
      if (updates.price !== undefined) payload.price = updates.price;
      if (updates.sku !== undefined) payload.sku = updates.sku || null;
      if (updates.description !== undefined) payload.description = updates.description || null;
      if (updates.active !== undefined) payload.active = updates.active;
      payload.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('products')
        .update(payload)
        .eq('id', productId);

      if (error) return { error };

      // Retroativo: propaga o preço salvo pros itens de leads deste produto
      // que estão com o preço padrão antigo OU zerados (produto que ficou um
      // tempo sem valor). Preço negociado à mão (diferente do padrão antigo)
      // não é tocado. Roda mesmo com o preço "igual" pra permitir corrigir
      // leads zerados só re-salvando o produto.
      let retro: { items: number; deals: number } | undefined;
      if (updates.price !== undefined && oldPrice !== null && Number.isFinite(oldPrice)) {
        const newPrice = Number(updates.price);
        // Escopo explícito por organização: a RLS de deal_items é permissiva
        // (USING true), então filtramos pela org atual além do product_id.
        const orgId = await getCurrentOrganizationId();
        // Atualiza EM UMA TACADA (por condição, sem lista de ids) os itens que
        // herdaram o padrão antigo OU estão zerados, e recebe de volta os
        // deal_ids afetados pra recalcular o total de cada lead.
        let upd = supabase
          .from('deal_items')
          .update({ price: newPrice })
          .eq('product_id', productId)
          .or(`price.eq.${oldPrice},price.eq.0`)
          .neq('price', newPrice);
        if (orgId) upd = upd.eq('organization_id', orgId);
        const { data: updatedItems, error: itemsError } = await upd.select('deal_id');

        if (!itemsError && updatedItems && updatedItems.length > 0) {
          const dealIds = Array.from(new Set(updatedItems.map((i) => i.deal_id).filter(Boolean))) as string[];
          await recalcDealsValues(dealIds);
          retro = { items: updatedItems.length, deals: dealIds.length };
        }
      }

      return { error: null, retro };
    } catch (e) {
      return { error: e as Error };
    }
  },

  async delete(id: string): Promise<{ error: Error | null }> {
    try {
      if (!supabase) return { error: new Error('Supabase não configurado') };
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', sanitizeUUID(id));

      return { error: error ?? null };
    } catch (e) {
      return { error: e as Error };
    }
  },
};

