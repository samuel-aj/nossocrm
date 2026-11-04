/**
 * GET /api/integrations/api4com/team  (admin da organização)
 *   -> { users: [{ user_id, name, email, extension, webhook_ok, verified_at, last_error }] }
 * Quem da equipe já conectou a API4com. Nenhum token sai.
 */
import { json } from '@/lib/whatsapp/api';
import { guardRoute, getErrorMessage } from '@/app/api/wa-agents/_shared';

export const runtime = 'nodejs';

type Row = { user_id: string; api4com_name: string | null; api4com_email: string | null; extension: string | null; integration_id: string | null; verified_at: string | null; last_error: string | null };
type Profile = { id: string; name: string | null; first_name: string | null; last_name: string | null; nickname: string | null };

export async function GET() {
  const auth = await guardRoute({ admin: true });
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await auth.admin
      .from('api4com_user_settings')
      .select('user_id, api4com_name, api4com_email, extension, integration_id, verified_at, last_error')
      .eq('organization_id', auth.user.organizationId)
      .order('verified_at', { ascending: false });
    if (error) {
      if (/api4com_user_settings/.test(error.message)) return json({ users: [], pendingMigration: true });
      return json({ error: error.message }, 500);
    }
    const rows = (data ?? []) as Row[];
    const ids = rows.map((r) => r.user_id);
    const names = new Map<string, string>();
    if (ids.length > 0) {
      const { data: profiles } = await auth.admin.from('profiles').select('id, name, first_name, last_name, nickname').in('id', ids);
      for (const p of (profiles ?? []) as Profile[]) {
        const full = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
        names.set(p.id, p.nickname || p.name || full || '');
      }
    }
    return json({
      users: rows.map((r) => ({
        user_id: r.user_id,
        name: names.get(r.user_id) || r.api4com_name || r.api4com_email || 'Usuário',
        api4com_name: r.api4com_name,
        email: r.api4com_email,
        extension: r.extension,
        webhook_ok: !!r.integration_id,
        verified_at: r.verified_at,
        last_error: r.last_error,
      })),
    });
  } catch (err) {
    return json({ error: getErrorMessage(err, 'Falha ao listar a equipe') }, 500);
  }
}
