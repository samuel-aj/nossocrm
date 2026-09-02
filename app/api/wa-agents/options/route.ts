/**
 * GET /api/wa-agents/options  (admin)
 * Listas usadas pelos editores de agentes e robôs:
 * {
 *   connections: [{ id, label, provider, status }],
 *   boards:      [{ id, name, stages: [{ id, label, order }] }],
 *   owners:      [{ id, name }],
 *   tags:        string[],
 *   products:    [{ id, name }],
 *   custom_fields: [{ key, label }]   (campos personalizados do negócio, para as variáveis)
 * }
 */
import { json } from '@/lib/whatsapp/api';
import { getConnectionsByOrg } from '@/lib/whatsapp/service';
import { guardRoute } from '../_shared';

export const runtime = 'nodejs';

type StageOption = { id: string; label: string; order: number };
type BoardOption = { id: string; name: string; stages: StageOption[] };
type ProfileLike = {
  first_name?: string | null;
  last_name?: string | null;
  nickname?: string | null;
  email?: string | null;
};

const PROFILE_COLUMNS = 'id, first_name, last_name, nickname, email';

function displayName(p: ProfileLike): string {
  return (
    (p.nickname ?? '').trim() ||
    `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() ||
    (p.email ?? '').trim() ||
    'Usuário'
  );
}

export async function GET() {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  const admin = auth.admin;
  const orgId = auth.user.organizationId;

  const [connections, boardsRes, stagesRes, tagsRes, profilesRes, membersRes, productsRes, fieldsRes] = await Promise.all([
    getConnectionsByOrg(admin, orgId),
    admin
      .from('boards')
      .select('id, name, position')
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .order('position', { ascending: true }),
    admin
      .from('board_stages')
      .select('id, board_id, label, name, order')
      .eq('organization_id', orgId)
      .order('order', { ascending: true }),
    admin.from('tags').select('name').eq('organization_id', orgId).order('name', { ascending: true }),
    admin.from('profiles').select(PROFILE_COLUMNS).eq('organization_id', orgId).limit(300),
    admin.from('user_organizations').select('user_id').eq('organization_id', orgId).limit(300),
    admin.from('products').select('id, name, active').eq('organization_id', orgId).order('name', { ascending: true }).limit(300),
    admin
      .from('custom_field_definitions')
      .select('key, label')
      .eq('organization_id', orgId)
      .eq('entity_type', 'deal')
      .order('label', { ascending: true })
      .limit(200),
  ]);
  for (const res of [boardsRes, stagesRes, tagsRes, profilesRes, membersRes, productsRes, fieldsRes]) {
    if (res.error) return json({ error: res.error.message }, 500);
  }

  // Responsáveis: perfis da org + membros vinculados por user_organizations
  const ownersById = new Map<string, string>();
  for (const p of profilesRes.data ?? []) ownersById.set(String(p.id), displayName(p));
  const missing = (membersRes.data ?? [])
    .map(m => String(m.user_id ?? ''))
    .filter(uid => uid && !ownersById.has(uid));
  if (missing.length) {
    const { data: extra } = await admin.from('profiles').select(PROFILE_COLUMNS).in('id', missing);
    for (const p of extra ?? []) ownersById.set(String(p.id), displayName(p));
  }
  const owners = [...ownersById.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  // Quadros com etapas ordenadas por "order"
  const boards: BoardOption[] = (boardsRes.data ?? []).map(b => ({
    id: String(b.id),
    name: String(b.name ?? ''),
    stages: [],
  }));
  const boardsById = new Map(boards.map(b => [b.id, b]));
  for (const s of stagesRes.data ?? []) {
    const board = boardsById.get(String(s.board_id));
    if (!board) continue;
    board.stages.push({
      id: String(s.id),
      label: String(s.label || s.name || 'Etapa'),
      order: Number(s.order ?? 0),
    });
  }
  for (const b of boards) b.stages.sort((a, c) => a.order - c.order);

  const tags = Array.from(
    new Set((tagsRes.data ?? []).map(t => String(t.name ?? '').trim()).filter(name => name !== ''))
  );

  // Produtos do catálogo (inativos ficam de fora do seletor de ações)
  const products = (productsRes.data ?? [])
    .filter(p => p.active !== false)
    .map(p => ({ id: String(p.id), name: String(p.name ?? '').trim() || 'Produto' }));

  // Campos personalizados do negócio: viram variáveis nos campos das ações e nos webhooks
  const custom_fields = (fieldsRes.data ?? [])
    .map(cf => ({ key: String(cf.key ?? '').trim(), label: String(cf.label ?? '').trim() || String(cf.key ?? '') }))
    .filter(cf => cf.key !== '');

  return json({
    connections: connections.map(c => ({
      id: c.id,
      label: `${c.profile_name || c.provider} ${c.phone_number ?? ''}`.trim(),
      provider: c.provider,
      status: c.status,
    })),
    boards,
    owners,
    tags,
    products,
    custom_fields,
  });
}
