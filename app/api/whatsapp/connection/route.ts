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
import { envEvolution, getProvider, isBusinessConnection } from '@/lib/whatsapp';
import {
  deleteEvolutionInstance,
  ensureEvolutionInstance,
  instanceNameForOrg,
  registerWebhook,
} from '@/lib/whatsapp/admin';

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

  let body: {
    instanceName?: string;
    token?: string;
    baseUrl?: string;
    autoCreate?: boolean;
    mode?: string;
    metaToken?: string;
    metaNumberId?: string;
    metaBusinessId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  let instanceName = (body.instanceName || '').trim();
  let token = body.token?.trim() || null;
  let baseUrl = body.baseUrl?.trim() || null;
  let provider: string | undefined;
  // Conexão anterior da org (capturada ANTES do upsert): numa troca de modo
  // o nome da instância muda e a antiga precisa ser derrubada na Evolution,
  // senão ela segue viva emitindo webhooks que o CRM passa a descartar.
  const previous = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  let managedSwitch = false;

  if (body.mode === 'business') {
    managedSwitch = true;
    // MODO API OFICIAL (Meta Cloud API via Evolution): conexão por credenciais,
    // sem QR. A instância nasce "open"; erro de token só aparece no envio.
    const metaToken = (body.metaToken || '').trim();
    const metaNumberId = (body.metaNumberId || '').trim().replace(/\D/g, '');
    const metaBusinessId = (body.metaBusinessId || '').trim().replace(/\D/g, '');
    if (!metaToken || !metaNumberId) {
      return json({ error: 'Token permanente e Phone Number ID da Meta são obrigatórios' }, 400);
    }
    // Sufixo _api: nunca colide com a instância QR da org (senão o create
    // devolveria a instância Baileys existente em silêncio).
    instanceName = `${instanceNameForOrg(auth.user.organizationId)}_api`;
    try {
      const created = await ensureEvolutionInstance(instanceName, {
        mode: 'business',
        metaToken,
        metaNumberId,
        metaBusinessId: metaBusinessId || undefined,
      });
      token = created.token ?? metaToken;
      baseUrl = envEvolution().baseUrl.replace(/\/+$/, '').replace(/\/manager$/, '') || null;
      provider = 'evolution_business';
    } catch (e) {
      return json({ error: `Falha ao criar a instância business: ${(e as Error).message}` }, 502);
    }
  } else if (body.autoCreate) {
    managedSwitch = true;
    // Fluxo da UI: cria a instância DESTA org na Evolution automaticamente,
    // sem o admin do cliente precisar saber nome/token/servidor.
    instanceName = instanceNameForOrg(auth.user.organizationId);
    try {
      const created = await ensureEvolutionInstance(instanceName);
      token = created.token;
      // persiste a base também (normalizada): a Edge Function usa p/ buscar mídia
      baseUrl = envEvolution().baseUrl.replace(/\/+$/, '').replace(/\/manager$/, '') || null;
      provider = 'evolution';
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
      provider,
    });
  } catch (e) {
    return json({ error: `Falha ao salvar conexão: ${(e as Error).message}` }, 400);
  }

  // Aponta o webhook da instância pro ambiente atual (recebimento de mensagens).
  await registerWebhook(conn);

  // Troca de modo gerenciada (QR <-> API oficial): derruba a instância
  // anterior na Evolution DEPOIS do novo vínculo estar salvo. Se ela ficasse
  // viva, seguiria emitindo webhooks com um instance_name que não casa mais
  // com a conexão da org e as mensagens seriam descartadas em silêncio.
  if (managedSwitch && previous?.instance_name && previous.instance_name !== conn.instance_name) {
    try {
      await getProvider(previous).logout();
    } catch {
      // best-effort: a sessão pode nem existir mais
    }
    // O delete usa a apikey/servidor GLOBAL: só roda quando a conexão antiga
    // morava nesse servidor (vínculo manual pra outro servidor fica de fora,
    // senão apagaria uma instância homônima de outro tenant de lá).
    const normalize = (u: string) => u.replace(/\/+$/, '').replace(/\/manager$/, '');
    const prevBase = normalize(previous.base_url || '');
    if (!prevBase || prevBase === normalize(envEvolution().baseUrl)) {
      await deleteEvolutionInstance(previous.instance_name);
    }
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

export async function DELETE() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn) return json({ error: 'Conexão não configurada' }, 404);

  if (isBusinessConnection(conn)) {
    // API oficial: apaga a instância na Evolution (purga o token da Meta) e
    // limpa o token salvo — reconectar exige informar as credenciais de novo.
    await deleteEvolutionInstance(conn.instance_name);
    await auth.admin
      .from('wa_connections')
      .update({ status: 'disconnected', phone_number: null, profile_name: null, instance_token: null })
      .eq('id', conn.id);
    return json({ ok: true });
  }

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
