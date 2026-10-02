import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';

type Row = Record<string, unknown>;
export function testClient(tables: Record<string, Row[]>, rpcData: unknown = null) {
  const queries: Array<{ table: string; calls: Array<[string, ...unknown[]]> }> = [];
  const failures: Record<string, unknown> = {};
  const rpc = vi.fn().mockResolvedValue({ data: rpcData, error: null });
  const from = vi.fn((table: string) => {
    const calls: Array<[string, ...unknown[]]> = [];
    queries.push({ table, calls });
    let rows = [...(tables[table] ?? [])];
    let single = false;
    const q = {
      select: (value: string) => { calls.push(['select', value]); return q; },
      eq: (key: string, value: unknown) => { calls.push(['eq', key, value]); if (!key.includes('.')) rows = rows.filter(r => r[key] === value); return q; },
      is: (key: string, value: unknown) => { calls.push(['is', key, value]); if (!key.includes('.')) rows = rows.filter(r => (r[key] ?? null) === value); return q; },
      in: (key: string, values: unknown[]) => { calls.push(['in', key, values]); rows = rows.filter(r => values.includes(r[key])); return q; },
      or: (filter: string, options?: unknown) => { calls.push(['or', filter, options]); return q; },
      ilike: (key: string, term: string) => { calls.push(['ilike', key, term]); rows = rows.filter(r => String(r[key]).toLowerCase().includes(term.slice(1, -1).toLowerCase())); return q; },
      order: (key: string) => { calls.push(['order', key]); return q; },
      limit: (size: number) => { calls.push(['limit', size]); rows = rows.slice(0, size); return q; },
      range: (start: number, end: number) => { calls.push(['range', start, end]); rows = rows.slice(start, end + 1); return q; },
      maybeSingle: () => { calls.push(['maybeSingle']); single = true; return q; },
      upsert: (data: Row, options: unknown) => { calls.push(['upsert', data, options]); return q; },
      then: (resolve: (result: { data: Row | Row[] | null; error: unknown }) => unknown) => Promise.resolve(resolve({ data: single ? rows[0] ?? null : rows, error: failures[table] ?? null })),
    };
    return q;
  });
  return { admin: { from, rpc } as unknown as SupabaseClient, tables, queries, rpc, failures };
}
