import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import { getConnectionByIdForOrg, getConnectionsByOrg, upsertConnection } from '@/lib/whatsapp/service';
import { envEvolution, getProvider, isBusinessConnection } from '@/lib/whatsapp';
import { ensureEvolutionInstance, registerWebhook } from '@/lib/whatsapp/admin';
import { findConnectedSameNumber } from '@/lib/whatsapp/dedupe';
import { isValidUUID } from '@/lib/supabase/utils';
import { pairingPhone, PairingInstanceMissingError } from '@/lib/whatsapp/pairing';

export const runtime = 'nodejs';
export const maxDuration = 60;

function reply(body: unknown, status = 200) {
  const response = json(body, status);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

async function connection(id: unknown) {
  const auth = await requireOrgUser();
  if (!auth.ok) return { response: auth.response };
  if (!isOrgAdmin(auth.user.role)) return { response: reply({ error: 'Apenas administradores podem conectar um número.' }, 403) };
  if (typeof id !== 'string' || !isValidUUID(id)) return { response: reply({ error: 'Informe a conexão.' }, 400) };
  const conn = await getConnectionByIdForOrg(auth.admin, auth.user.organizationId, id);
  if (!conn) return { response: reply({ error: 'Conexão não encontrada.' }, 404) };
  if (isBusinessConnection(conn)) return { response: reply({ error: 'Esta conexão usa a API oficial e não permite QR ou código.' }, 400) };
  return { auth, conn, provider: getProvider(conn) };
}

/** Read only while an attempt is pending; a closed session must stay closed. */
export async function GET(req: Request) {
  const target = await connection(new URL(req.url).searchParams.get('id'));
  if (target.response) return target.response;
  if (!target.provider?.getPairingStatus) return reply({ error: 'Pareamento indisponível neste provedor.' }, 400);
  try {
    return reply(await target.provider.getPairingStatus());
  } catch {
    return reply({ error: 'Não foi possível atualizar o pareamento. Tente novamente.' }, 502);
  }
}

/** Phone stays in the request body and in Evolution's pending session, never in a URL in the browser. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { id?: unknown; method?: unknown; phone?: unknown } | null;
  const target = await connection(body?.id);
  if (target.response) return target.response;
  if (body?.method !== 'qr' && body?.method !== 'code') return reply({ error: 'Escolha QR Code ou código.' }, 400);
  const phone = body.method === 'code' ? pairingPhone(body.phone) : undefined;
  if (phone === null) return reply({ error: 'Informe um telefone válido com código do país e DDD.' }, 400);
  if (!target.provider?.startPairing) return reply({ error: 'Pareamento indisponível neste provedor.' }, 400);
  if (phone) {
    const rows = await getConnectionsByOrg(target.auth.admin, target.auth.user.organizationId);
    if (findConnectedSameNumber(rows.filter(row => row.id !== target.conn.id), `+${phone}`)) {
      return reply({ error: 'Este número já está conectado nesta organização. Use a conexão existente.' }, 409);
    }
  }
  try {
    try {
      return reply(await target.provider.startPairing(phone));
    } catch (error) {
      // Keep the existing QR self-healing behavior, but only for a confirmed
      // missing instance on the configured server (never on auth/network errors).
      const base = (url: string) => url.replace(/\/+$/, '').replace(/\/manager$/, '');
      const configured = envEvolution().baseUrl;
      if (!(error instanceof PairingInstanceMissingError) || !configured ||
          (target.conn.base_url && base(target.conn.base_url) !== base(configured))) throw error;
      const healed = await ensureEvolutionInstance(target.conn.instance_name);
      if (!healed.token) throw error;
      const conn = await upsertConnection(target.auth.admin, target.auth.user.organizationId, {
        instanceName: target.conn.instance_name, token: healed.token, baseUrl: target.conn.base_url,
      });
      await registerWebhook(conn);
      const provider = getProvider(conn);
      if (!provider.startPairing) throw error;
      return reply(await provider.startPairing(phone));
    }
  } catch (error) {
    // Adapter errors are deliberately user-facing; network errors expose no provider details.
    const message = error instanceof Error && /^(Informe |Não foi possível |A Evolution |A tentativa anterior )/.test(error.message)
      ? error.message : 'Não foi possível gerar o pareamento. Tente novamente.';
    return reply({ error: message }, 502);
  }
}
