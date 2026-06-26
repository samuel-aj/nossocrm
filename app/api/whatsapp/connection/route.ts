/**
 * GET  /api/whatsapp/connection  -> status da conexão da org (token mascarado)
 * POST /api/whatsapp/connection  -> vincula a org a uma instância da Evolution (admin)
 */
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import {
  getConnectionByOrg,
  upsertConnection,
  updateConnectionStatus,
  type WaConnectionRow,
} from '@/lib/whatsapp/service';
import { getProvider } from '@/lib/whatsapp';

function mask(conn: WaConnectionRow) {
  return {
    id: conn.id,
    provider: conn.provider,
    instanceName: conn.instance_name,
    baseUrl: conn.base_url,
    phoneNumber: conn.phone_number,
    profileName: conn.profile_name,
    status: conn.status,
  };
}

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn) return json({ connected: false, connection: null });

  let status = conn.status;
  try {
    const live = await getProvider(conn).getConnectionState();
    if (live !== conn.status) {
      await updateConnectionStatus(auth.admin, conn.id, { status: live });
      status = live;
    }
  } catch {
    // Evolution indisponível: mantém o último status salvo
  }
  return json({ connected: status === 'connected', connection: { ...mask(conn), status } });
}

export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  let body: { instanceName?: string; token?: string; baseUrl?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }
  const instanceName = (body.instanceName || '').trim();
  if (!instanceName) return json({ error: 'instanceName é obrigatório' }, 400);

  let conn: WaConnectionRow;
  try {
    conn = await upsertConnection(auth.admin, auth.user.organizationId, {
      instanceName,
      token: body.token?.trim() || null,
      baseUrl: body.baseUrl?.trim() || null,
    });
  } catch (e) {
    return json({ error: `Falha ao salvar conexão: ${(e as Error).message}` }, 400);
  }

  let status = conn.status;
  try {
    const live = await getProvider(conn).getConnectionState();
    await updateConnectionStatus(auth.admin, conn.id, { status: live });
    status = live;
  } catch {
    // segue com o status salvo
  }
  return json({ connection: { ...mask(conn), status } });
}
