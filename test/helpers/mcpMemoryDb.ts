/** Small query fake for permission/transport tests, not a substitute for the SQL journal tests. */
export function memoryDb(tables: Record<string, Record<string, any>[]>) {
  const calls: { table: string; filters: [string, unknown][]; projection: string }[] = [];
  const from = (table: string) => {
    const call = { table, filters: [] as [string, unknown][], projection: '*' }; calls.push(call);
    const predicates: ((r: Record<string, any>) => boolean)[] = [];
    let limit = Infinity;
    const ordering: { key: string; ascending: boolean }[] = [];
    let patch: Record<string, any> | undefined;
    let inserted: Record<string, any>[] | undefined;
    const results = () => {
      if (inserted) { (tables[table] ??= []).push(...inserted); inserted = undefined; }
      let rows = (tables[table] ?? []).filter(row => predicates.every(p => p(row)));
      rows = rows.sort((a,b) => { for (const o of ordering) { const diff = String(a[o.key] ?? '').localeCompare(String(b[o.key] ?? '')); if (diff) return o.ascending ? diff : -diff; } return 0; }).slice(0, limit);
      if (patch) rows.forEach(r => Object.assign(r, patch));
      return rows.map(r => call.projection === '*' ? structuredClone(r) : Object.fromEntries(call.projection.split(',').map(k => [k.trim(), structuredClone(r[k.trim()])])));
    };
    const q = {
      select: (projection='*') => { call.projection = projection; return q; },
      eq: (key: string, value: unknown) => { call.filters.push([key,value]); predicates.push(r => r[key] === value); return q; },
      match: (values: Record<string,unknown>) => { Object.entries(values).forEach(([key,value]) => q.eq(key,value)); return q; },
      in: (key: string, values: unknown[]) => { predicates.push(r => values.includes(r[key])); return q; },
      gt: (key: string,value: string) => { predicates.push(r => r[key] > value); return q; },
      ilike: (key: string,value: string) => { predicates.push(r => String(r[key] ?? '').toLowerCase().includes(value.slice(1,-1).toLowerCase())); return q; },
      order: (key: string, options?: { ascending: boolean }) => { ordering.push({key,ascending:options?.ascending ?? true}); return q; },
      limit: (n: number) => { limit=n; return q; },
      update: (values: Record<string,any>) => { patch=values; return q; },
      insert: (values: Record<string,any> | Record<string,any>[]) => { inserted=Array.isArray(values)?values:[values]; return q; },
      maybeSingle: async () => ({ data: results()[0] ?? null, error: null }),
      single: async () => ({ data: results()[0] ?? null, error: null }),
      then: (resolve: (value: any) => unknown) => Promise.resolve({ data: results(), error: null }).then(resolve),
    };
    return q;
  };
  return { from, calls, tables };
}
