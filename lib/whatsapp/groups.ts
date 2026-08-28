/**
 * Gestão de GRUPOS de WhatsApp pelo CRM (servidor).
 *
 * - API oficial da Meta (Groups API, só para Conta Comercial Oficial): o grupo
 *   é criado pela empresa (POST /{phone_number_id}/groups), as pessoas entram
 *   pelo link de convite (GET/POST /{group_id}/invite_link), até 8
 *   participantes; mensagens vão com recipient_type "group".
 * - Evolution (QR Code): o grupo já existe no celular; aqui só o link de
 *   convite (GET /group/inviteCode) e, para trocar, revokeInviteCode.
 */
import { envEvolution } from '@/lib/whatsapp';
import type { WaConnectionRow } from '@/lib/whatsapp/service';

const GRAPH = () => `https://graph.facebook.com/${(process.env.META_GRAPH_VERSION || 'v21.0').trim()}`;

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string };

interface GraphError {
  error?: { message?: string; error_data?: { details?: string }; code?: number };
}

async function graph<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  token: string,
  body?: Record<string, unknown>
): Promise<{ ok: true; data: T } | Fail> {
  let res: Response;
  try {
    res = await fetch(`${GRAPH()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false, error: `Falha de rede ao falar com a Meta: ${(e as Error).message}` };
  }
  let data: (T & GraphError) | null = null;
  try {
    data = (await res.json()) as T & GraphError;
  } catch {
    data = null;
  }
  if (!res.ok || data?.error) {
    const err = data?.error;
    return { ok: false, error: err?.error_data?.details || err?.message || `Meta respondeu ${res.status}` };
  }
  return { ok: true, data: data as T };
}

/** Cria um grupo na Groups API da Meta; devolve o id do grupo (opaco, não é JID). */
export async function createMetaGroup(
  conn: WaConnectionRow,
  input: { subject: string; description?: string }
): Promise<Ok<{ groupId: string }> | Fail> {
  const token = conn.instance_token || '';
  const phoneNumberId = (conn.meta_phone_number_id || '').trim();
  if (!token || !phoneNumberId) return { ok: false, error: 'Número da API oficial sem token ou phone_number_id.' };
  const r = await graph<{ id?: string; groups?: Array<{ id?: string }>; group?: { id?: string } }>(
    'POST',
    `/${encodeURIComponent(phoneNumberId)}/groups`,
    token,
    {
      messaging_product: 'whatsapp',
      subject: input.subject.trim().slice(0, 128),
      ...(input.description?.trim() ? { description: input.description.trim().slice(0, 2048) } : {}),
      join_approval_mode: 'auto_approve',
    }
  );
  if (!r.ok) return r;
  const groupId = r.data.id || r.data.groups?.[0]?.id || r.data.group?.id || '';
  if (!groupId) return { ok: false, error: 'A Meta criou o grupo mas não devolveu o id.' };
  return { ok: true, groupId };
}

/** Link de convite do grupo da Meta (reset = gera um link novo e invalida o antigo). */
export async function getMetaGroupInviteLink(
  conn: WaConnectionRow,
  groupId: string,
  reset = false
): Promise<Ok<{ inviteLink: string }> | Fail> {
  const token = conn.instance_token || '';
  if (!token) return { ok: false, error: 'Número da API oficial sem token.' };
  const r = await graph<{ invite_link?: string }>(
    reset ? 'POST' : 'GET',
    `/${encodeURIComponent(groupId)}/invite_link`,
    token,
    reset ? { messaging_product: 'whatsapp' } : undefined
  );
  if (!r.ok) return r;
  const link = (r.data.invite_link || '').trim();
  if (!link) return { ok: false, error: 'A Meta não devolveu o link de convite.' };
  return { ok: true, inviteLink: link };
}

/** Nome e tamanho do grupo da Meta. */
export async function getMetaGroupInfo(
  conn: WaConnectionRow,
  groupId: string
): Promise<Ok<{ subject: string | null; participants: number | null }> | Fail> {
  const token = conn.instance_token || '';
  if (!token) return { ok: false, error: 'Número da API oficial sem token.' };
  const r = await graph<{ subject?: string; total_participant_count?: number | string; participants?: unknown[] }>(
    'GET',
    `/${encodeURIComponent(groupId)}?fields=subject,total_participant_count`,
    token
  );
  if (!r.ok) return r;
  const total =
    r.data.total_participant_count !== undefined
      ? Number(r.data.total_participant_count)
      : Array.isArray(r.data.participants)
        ? r.data.participants.length
        : null;
  return {
    ok: true,
    subject: typeof r.data.subject === 'string' && r.data.subject.trim() ? r.data.subject.trim() : null,
    participants: total !== null && Number.isFinite(total) ? total : null,
  };
}

function evolutionBase(conn: WaConnectionRow): { baseUrl: string; token: string } {
  const env = envEvolution();
  return {
    baseUrl: (conn.base_url || env.baseUrl).replace(/\/+$/, '').replace(/\/manager$/, ''),
    token: conn.instance_token || env.token,
  };
}

/**
 * Link de convite de um grupo via Evolution (QR Code). reset = revoga o link
 * atual (revokeInviteCode) e busca o novo.
 */
export async function getEvolutionGroupInviteLink(
  conn: WaConnectionRow,
  groupJid: string,
  reset = false
): Promise<Ok<{ inviteLink: string }> | Fail> {
  const { baseUrl, token } = evolutionBase(conn);
  if (!baseUrl || !token) return { ok: false, error: 'Evolution não configurada.' };
  const inst = encodeURIComponent(conn.instance_name);
  const jid = encodeURIComponent(groupJid);
  try {
    if (reset) {
      const rv = await fetch(`${baseUrl}/group/revokeInviteCode/${inst}?groupJid=${jid}`, {
        method: 'POST',
        headers: { apikey: token },
        cache: 'no-store',
      });
      if (!rv.ok) return { ok: false, error: `Evolution recusou gerar novo link (HTTP ${rv.status})` };
    }
    const r = await fetch(`${baseUrl}/group/inviteCode/${inst}?groupJid=${jid}`, {
      headers: { apikey: token },
      cache: 'no-store',
    });
    if (!r.ok) return { ok: false, error: `Evolution não devolveu o link (HTTP ${r.status})` };
    const j = (await r.json().catch(() => null)) as { inviteUrl?: string; inviteCode?: string } | null;
    const link = (j?.inviteUrl || (j?.inviteCode ? `https://chat.whatsapp.com/${j.inviteCode}` : '')).trim();
    if (!link) return { ok: false, error: 'Evolution não devolveu o link de convite.' };
    return { ok: true, inviteLink: link };
  } catch (e) {
    return { ok: false, error: `Falha ao falar com a Evolution: ${(e as Error).message}` };
  }
}
