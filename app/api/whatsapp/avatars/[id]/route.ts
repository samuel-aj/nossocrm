/**
 * GET /api/whatsapp/avatars/[id]?v=...
 *
 * Foto de perfil de UMA conversa (bucket privado wa-media), num endereço FIXO
 * que o navegador guarda em cache. Substitui o link assinado que a lista de
 * conversas gerava a cada recarga: link novo = navegador baixando todas as
 * fotos de novo, e cada download consultava o banco (derrubou a produção em
 * 14/09/2026). `v` (avatar_synced_at) só existe pra furar o cache quando a
 * foto é sincronizada de novo.
 *
 * Acesso: a tag <img> não manda o header x-org-id da aba, então a org é a DA
 * CONVERSA e o usuário precisa pertencer a ela (perfil, vínculo em
 * user_organizations ou super_admin).
 */
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { UserRole } from '@/types/constants';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function vazio(status: number) {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return vazio(404);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return vazio(401);

  const admin = createStaticAdminClient();
  const [{ data: conversa }, { data: me }] = await Promise.all([
    admin.from('wa_conversations').select('organization_id, avatar_path').eq('id', id).maybeSingle(),
    admin.from('profiles').select('role, organization_id').eq('id', user.id).maybeSingle(),
  ]);
  const caminho = (conversa as { avatar_path?: string | null } | null)?.avatar_path;
  if (!conversa || !me || !caminho || caminho.startsWith('http')) return vazio(404);

  const orgId = (conversa as { organization_id: string }).organization_id;
  const perfil = me as { role: string; organization_id: string | null };
  if (perfil.role !== UserRole.SUPER_ADMIN && perfil.organization_id !== orgId) {
    const { data: vinculo } = await admin
      .from('user_organizations')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('organization_id', orgId)
      .maybeSingle();
    if (!vinculo) return vazio(404);
  }

  const { data: arquivo, error } = await admin.storage.from('wa-media').download(caminho);
  if (error || !arquivo) return vazio(404);

  return new Response(arquivo, {
    headers: {
      'Content-Type': arquivo.type || 'image/jpeg',
      // Privado (só o navegador de quem tem acesso guarda). Um dia: a foto só
      // muda quando a sincronização troca o `v` do endereço.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
