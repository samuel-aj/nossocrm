/**
 * GET    /api/whatsapp/connection  -> status da conexão da org (token mascarado)
 * POST   /api/whatsapp/connection  -> vincula a org a uma instância da Evolution (admin)
 *                                     { autoCreate: true } cria a instância da org sozinho
 * DELETE /api/whatsapp/connection  -> desconecta o número da org (logout; admin)
 */
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import {
  getConnectionByOrg,
  upsertConnection,
  updateConnectionStatus,
  type WaConnectionRow,
} from '@/lib/whatsapp/service';
import { envEvolution, getProvider } from '@/lib/whatsapp';
import { ensureEvolutionInstance, instanceNameForOrg } from '@/lib/whatsapp/admin';

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

/** Registra o webhook da instância -> Edge Function do ambiente atual (best-effort). */
async function registerWebhook(conn: WaConnectionRow): Promise<void> {
  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  if (!supaUrl) return;
  try {
    await getProvider(conn).setWebhook(
      `${supaUrl}/functions/v1/whatsapp-webhook/${conn.webhook_secret}`
    );
  } catch {
    // best-effort: sem webhook o envio ainda funciona; recebimento fica pendente
  }
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

  let body: { instanceName?: string; token?: string; baseUrl?: string; autoCreate?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  let instanceName = (body.instanceName || '').trim();
  let token = body.token?.trim() || null;
  let baseUrl = body.baseUrl?.trim() || null;

  // Fluxo da UI: cria a instância DESTA org na Evolution automaticamente,
  // sem o admin do cliente precisar saber nome/token/servidor.
  if (body.autoCreate) {
    instanceName = instanceNameForOrg(auth.user.organizationId);
    try {
      const created = await ensureEvolutionInstance(instanceName);
      token = created.token;
      // persiste a base também: a Edge Function usa p/ buscar mídia (fallback)
      baseUrl = envEvolution().baseUrl || null;
    } catch (e) {
      return json({ error: `Falha ao criar a instância: ${(e as Error).message}` }, 502);
    }
  }
  if (!instanceName) return json({ error: 'instanceName é obrigatório' }, 400);

  let conn: WaConnectionRow;
  try {
    conn = await upsertConnection(auth.admin, auth.user.organizationId, {
      instanceName,
      token,
      baseUrl,
    });
  } catch (e) {
    return json({ error: `Falha ao salvar conexão: ${(e as Error).message}` }, 400);
  }

  // Aponta o webhook da instância pro ambiente atual (recebimento de mensagens).
  await registerWebhook(conn);

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

export async function DELETE() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn) return json({ error: 'Conexão não configurada' }, 404);

  try {
    await getProvider(conn).logout();
  } catch (e) {
    return json({ error: `Falha ao desconectar: ${(e as Error).message}` }, 502);
  }
  await updateConnectionStatus(auth.admin, conn.id, {
    status: 'disconnected',
    phone_number: null,
    profile_name: null,
  });
  return json({ ok: true });
}
