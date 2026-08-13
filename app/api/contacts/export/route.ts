import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';
import { stringifyCsv, withUtf8Bom, type CsvDelimiter } from '@/lib/utils/csv';

type SortBy = 'name' | 'created_at' | 'updated_at' | 'stage';
type SortOrder = 'asc' | 'desc';

function getParam(searchParams: URLSearchParams, key: string): string | undefined {
  const v = searchParams.get(key);
  return v && v.trim() ? v.trim() : undefined;
}

function parseSortBy(v: string | undefined): SortBy {
  if (v === 'name' || v === 'created_at' || v === 'updated_at' || v === 'stage') return v;
  return 'created_at';
}

function parseSortOrder(v: string | undefined): SortOrder {
  return v === 'asc' ? 'asc' : 'desc';
}

/**
 * Handler HTTP `GET` deste endpoint (Next.js Route Handler).
 *
 * @param {Request} req - Objeto da requisição.
 * @returns {Promise<NextResponse<unknown>>} Retorna um valor do tipo `Promise<NextResponse<unknown>>`.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sp = url.searchParams;

    const search = getParam(sp, 'search');
    const stage = getParam(sp, 'stage');
    const status = getParam(sp, 'status');
    const dateStart = getParam(sp, 'dateStart');
    const dateEnd = getParam(sp, 'dateEnd');
    const delimiter = (getParam(sp, 'delimiter') as CsvDelimiter | undefined) || undefined;
    const sortBy = parseSortBy(getParam(sp, 'sortBy'));
    const sortOrder = parseSortOrder(getParam(sp, 'sortOrder'));

    const supabase = await createClient();

    // ORG POR ABA: escopo explícito. Com a RLS por membership o usuário
    // enxerga TODAS as orgs dele; sem este filtro o export misturaria
    // organizações. Honra o header x-org-id validado (tabOrgScope).
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { data: me } = await supabase
      .from('profiles')
      .select('id, role, organization_id')
      .eq('id', user.id)
      .single();
    if (!me?.organization_id) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    const scoped = await withTabOrg(me);
    if (!scoped) return NextResponse.json({ error: 'Acesso negado a esta organização' }, { status: 403 });

    const chunkSize = 1000;
    let page = 0;
    let allContacts: Array<any> = [];

    // We'll fetch in chunks. For export, we don't rely on count to avoid expensive exact counts.
    // Stop when a chunk returns less than chunkSize.
    while (true) {
      const from = page * chunkSize;
      const to = from + chunkSize - 1;

      let q = supabase
        .from('contacts')
        .select(
          'id,name,email,phone,role,notes,status,stage,created_at,updated_at,client_company_id,last_purchase_date'
        )
        .eq('organization_id', scoped.organization_id)
        .is('deleted_at', null);

      if (search) {
        q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
      }
      if (stage && stage !== 'ALL') {
        q = q.eq('stage', stage);
      }
      if (status && status !== 'ALL') {
        if (status === 'RISK') {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          q = q.eq('status', 'ACTIVE').lt('last_purchase_date', thirtyDaysAgo.toISOString());
        } else {
          q = q.eq('status', status);
        }
      }
      if (dateStart) q = q.gte('created_at', dateStart);
      if (dateEnd) q = q.lte('created_at', dateEnd);

      const { data, error } = await q
        .order(sortBy, { ascending: sortOrder === 'asc' })
        .range(from, to);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      const chunk = (data || []) as any[];
      allContacts = allContacts.concat(chunk);
      if (chunk.length < chunkSize) break;
      page += 1;
    }

    // Company name mapping (optional)
    const companyIds = Array.from(
      new Set(allContacts.map(c => c.client_company_id).filter(Boolean))
    ) as string[];

    const companyNameById = new Map<string, string>();
    if (companyIds.length) {
      // Fetch companies in chunks to avoid query limits
      const idChunkSize = 500;
      for (let i = 0; i < companyIds.length; i += idChunkSize) {
        const ids = companyIds.slice(i, i + idChunkSize);
        const { data: companies, error: companiesError } = await supabase
          .from('crm_companies')
          .select('id,name')
          .eq('organization_id', scoped.organization_id)
          .in('id', ids)
          .is('deleted_at', null);

        if (companiesError) {
          return NextResponse.json({ error: companiesError.message }, { status: 400 });
        }
        for (const c of (companies || []) as Array<{ id: string; name: string }>) {
          companyNameById.set(c.id, c.name || '');
        }
      }
    }

    const header = [
      'name',
      'email',
      'phone',
      'role',
      'company',
      'status',
      'stage',
      'notes',
      'created_at',
      'updated_at',
    ];

    const dataRows = allContacts.map(c => [
      c.name || '',
      c.email || '',
      c.phone || '',
      c.role || '',
      companyNameById.get(c.client_company_id) || '',
      c.status || '',
      c.stage || '',
      c.notes || '',
      c.created_at || '',
      c.updated_at || '',
    ]);

    const d: CsvDelimiter = delimiter === ';' || delimiter === '\t' || delimiter === ',' ? delimiter : ',';
    const csv = withUtf8Bom(stringifyCsv([header, ...dataRows], d));

    const today = new Date().toISOString().slice(0, 10);
    const filename = `contatos-${today}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error)?.message || 'Erro inesperado' },
      { status: 500 }
    );
  }
}

