import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { withTabOrg } from '@/lib/supabase/tabOrgScope';

export const runtime = 'nodejs';

const CreateSchema = z.object({
  content: z.string().min(1).max(2000),
}).strict();

type AuthedProfile = {
  id: string;
  organization_id: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  nickname: string | null;
  email: string | null;
};

async function getAuthedProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' as const, status: 401 };
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, organization_id, role, first_name, last_name, nickname, email')
    .eq('id', user.id)
    .single();
  if (error || !profile?.organization_id) {
    return { error: 'Profile not found' as const, status: 404 };
  }
  // ORG POR ABA: honra o header x-org-id validado (ver lib/supabase/tabOrgScope)
  const scoped = await withTabOrg({ id: user.id, role: profile.role, organization_id: profile.organization_id });
  if (!scoped) return { error: 'Acesso negado a esta organização' as const, status: 403 };
  return { profile: { ...(profile as AuthedProfile), organization_id: scoped.organization_id, role: scoped.role } };
}

function displayName(p: { first_name?: string | null; last_name?: string | null; nickname?: string | null; email?: string | null }) {
  const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return p.nickname || full || p.email || 'Usuário';
}

const STATUS_RANK: Record<string, number> = { pending: 0, done: 1, discarded: 2 };

// Listagem GLOBAL das sugestões — visível apenas para super_admin (a agência),
// independente da organização ativa. Mostra de qual cliente veio cada uma e o
// status: pendentes primeiro, feitas/descartadas ao fim.
export async function GET() {
  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.profile.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const sb = createStaticAdminClient();
  const { data: rows, error } = await sb
    .from('suggestions')
    .select('id, content, created_at, author_id, organization_id, status')
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const suggestions = rows || [];
  if (suggestions.length === 0) return NextResponse.json({ data: [] });

  const authorIds = Array.from(new Set(suggestions.map(s => s.author_id)));
  const orgIds = Array.from(new Set(suggestions.map(s => s.organization_id)));

  const [authorsRes, orgsRes] = await Promise.all([
    sb.from('profiles').select('id, first_name, last_name, nickname, email').in('id', authorIds),
    sb.from('organizations').select('id, name').in('id', orgIds),
  ]);

  const authorById = new Map((authorsRes.data || []).map(a => [a.id, a]));
  const orgNameById = new Map((orgsRes.data || []).map(o => [o.id, o.name as string]));

  const data = suggestions
    .map(s => ({
      id: s.id,
      content: s.content,
      created_at: s.created_at,
      author_id: s.author_id,
      author_name: displayName(authorById.get(s.author_id) || {}),
      organization_id: s.organization_id,
      organization_name: orgNameById.get(s.organization_id) || null,
      status: (s.status as string) || 'pending',
    }))
    .sort((a, b) =>
      (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || (a.created_at < b.created_at ? 1 : -1),
    );

  return NextResponse.json({ data });
}

// Criar sugestão — QUALQUER usuário autenticado pode enviar.
export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const auth = await getAuthedProfile();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => null);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 422 });
  }

  const sb = createStaticAdminClient();
  const { data, error } = await sb
    .from('suggestions')
    .insert({
      organization_id: auth.profile.organization_id,
      author_id: auth.profile.id,
      content: parsed.data.content.trim(),
    })
    .select('id, content, created_at, author_id, organization_id, status')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: {
      ...data,
      author_name: displayName(auth.profile),
      organization_name: null,
    },
  }, { status: 201 });
}
