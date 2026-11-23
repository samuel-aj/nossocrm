/**
 * POST /api/whatsapp/connection/restart  body: { id }  (admin)
 * Reinicia a sessão da instância na Evolution quando ela diz "conectado" mas os envios
 * falham (sessão do WhatsApp morta). Devolve o estado depois do reinício.
 */
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import { getConnectionByIdForOrg } from '@/lib/whatsapp/service';
import { observeConnection } from '@/lib/whatsapp/connectionIncidents';
import { getProvider, isMetaCloudConnection } from '@/lib/whatsapp';
import { isValidUUID } from '@/lib/supabase/utils';

export const runtime = 'nodejs';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = (body?.id || '').trim();
  if (!isValidUUID(id)) return json({ error: 'id da conexão é obrigatório' }, 400);

  const conn = await getConnectionByIdForOrg(auth.admin, auth.user.organizationId, id);
  if (!conn) return json({ error: 'Conexão não encontrada' }, 404);
  if (isMetaCloudConnection(conn)) return json({ error: 'A API oficial da Meta não tem sessão para reiniciar' }, 400);

  const provider = getProvider(conn);
  if (!provider.restart) return json({ error: 'Este provedor não permite reiniciar' }, 400);
  await observeConnection(auth.admin, id, 'connecting', 'manual', new Date().toISOString(), 'restart_requested');
  try {
    await provider.restart();
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Falha ao reiniciar a instância' }, 502);
  }

  // A sessão volta em alguns segundos: espera um pouco pelo estado final
  let check: Awaited<ReturnType<typeof provider.checkConnectionHealth>> = { state: 'connecting' };
  let checkedAt = new Date().toISOString();
  for (let i = 0; i < 8; i++) {
    await sleep(1500);
    checkedAt = new Date().toISOString();
    try {
      check = await provider.checkConnectionHealth();
    } catch {
      check = { state: 'unknown', reason: 'provider_unavailable' };
    }
    if (check.state === 'connected') break;
  }
  await observeConnection(auth.admin, id, check.state, 'poll', checkedAt, check.reason);
  return json({ ok: true, status: check.state });
}
