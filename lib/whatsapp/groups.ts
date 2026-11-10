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
import { participantName, phoneFrom, type GroupParticipant } from './groupParticipants';

const GRAPH = () => `https://graph.facebook.com/${(process.env.META_GRAPH_VERSION || 'v21.0').trim()}`;

type Ok<T> = { ok: true } & T;
type Fail = { ok: false; error: string; code?: 'GROUPS_NOT_ELIGIBLE' };

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
    const eligibilityRefused = [err?.error_data?.details, err?.message].some(message =>
      typeof message === 'string' && /groups? apis? are only available for eligible phone numbers/i.test(message)
    );
    if (eligibilityRefused) {
      return {
        ok: false,
        code: 'GROUPS_NOT_ELIGIBLE',
        error: 'Este número não está habilitado pela Meta para criar grupos pela API oficial. A conexão ativa não garante acesso a esse recurso. Verifique a elegibilidade com a Meta ou selecione um número conectado por QR Code para ver como criar o grupo pelo celular.',
      };
    }
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

/** Evolution/Baileys: GET /group/participants/{instance}?groupJid=. */
export async function getGroupParticipants(conn: WaConnectionRow, groupJid: string) {
  if (conn.provider && conn.provider !== 'evolution') {
    return { ok: false as const, unsupported: true, error: 'Esta conexão não disponibiliza participantes e menções de grupos.' };
  }
  const { baseUrl, token } = evolutionBase(conn);
  if (!baseUrl || !token) return { ok: false as const, error: 'Evolution não configurada.' };
  try {
    const response = await fetch(`${baseUrl}/group/participants/${encodeURIComponent(conn.instance_name)}?groupJid=${encodeURIComponent(groupJid)}`, {
      headers: { apikey: token }, cache: 'no-store', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { ok: false as const, error: `Não foi possível consultar os participantes (HTTP ${response.status}).` };
    const { normalizeGroupParticipants } = await import('./groupParticipants');
    return { ok: true as const, participants: normalizeGroupParticipants(await response.json()) };
  } catch {
    return { ok: false as const, error: 'Não foi possível consultar os participantes. Tente novamente.' };
  }
}

export async function getMetaGroupParticipants(conn: WaConnectionRow, groupId: string): Promise<Ok<{ participants: GroupParticipant[] }> | Fail> {
  if (!conn.instance_token) return { ok: false, error: 'Número da API oficial sem token.' };
  type MetaMember = { wa_id?: string; user_id?: string; username?: string; profile?: { name?: string } };
  const result = await graph<{ participants?: MetaMember[] }>('GET', '/' + encodeURIComponent(groupId) + '?fields=participants', conn.instance_token);
  if (!result.ok) return result;
  if (!Array.isArray(result.data?.participants)) return { ok: false, error: 'A Meta não disponibilizou a lista de participantes.' };
  const members = new Map<string, GroupParticipant>();
  for (const item of result.data.participants) {
    if (!item) continue;
    const phone = phoneFrom(item.wa_id);
    const id = item.user_id || phone;
    if (id) members.set(id, { id, phone, name: participantName(item.profile?.name) || participantName(item.username) || phone || '', admin: false });
  }
  return { ok: true, participants: [...members.values()] };
}

export interface GroupProperties { subject: string; description: string; pictureUrl: string | null }
export type GroupEdit = { field: 'subject' | 'description'; value: string } | { field: 'photo'; jpeg: Uint8Array<ArrayBuffer> };

/** Only the server derives the group, connection and provider URL. */
async function groupRequest(conn: WaConnectionRow, groupId: string, edit?: GroupEdit) {
  const meta = conn.provider === 'meta_cloud';
  if (conn.provider && !meta && conn.provider !== 'evolution') return { ok: false as const, error: 'Esta conexão não permite gerenciar as propriedades do grupo.' };
  let url: string;
  let body: FormData | string | undefined;
  const headers: Record<string, string> = {};
  if (meta) {
    if (!conn.instance_token) return { ok: false as const, error: 'Número da API oficial sem token.' };
    headers.Authorization = 'Bearer ' + conn.instance_token;
    url = GRAPH() + '/' + encodeURIComponent(groupId);
    if (edit) {
      body = new FormData();
      body.set('messaging_product', 'whatsapp');
      if (edit.field === 'photo') body.set('profile_picture_file', new Blob([edit.jpeg], { type: 'image/jpeg' }), 'grupo.jpg');
      else body.set(edit.field, edit.value);
    } else url += '?fields=subject,description';
  } else {
    const { baseUrl, token } = evolutionBase(conn);
    if (!baseUrl || !token) return { ok: false as const, error: 'Evolution não configurada.' };
    headers.apikey = token;
    let action = 'findGroupInfos';
    if (edit) {
      const actions = { subject: 'updateGroupSubject', description: 'updateGroupDescription', photo: 'updateGroupPicture' };
      action = actions[edit.field];
      headers['Content-Type'] = 'application/json';
      const change = edit.field === 'photo' ? { image: Buffer.from(edit.jpeg).toString('base64') } : { [edit.field]: edit.value };
      body = JSON.stringify({ groupJid: groupId, ...change });
    }
    url = baseUrl + '/group/' + action + '/' + encodeURIComponent(conn.instance_name) + '?groupJid=' + encodeURIComponent(groupId);
  }
  try {
    const res = await fetch(url, { method: edit ? 'POST' : 'GET', headers, body, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || data.error) {
      const error = edit
        ? 'O WhatsApp não confirmou a alteração. Confira se o número conectado pode editar este grupo.'
        : 'Não foi possível consultar as propriedades do grupo no WhatsApp.';
      return { ok: false as const, error };
    }
    return { ok: true as const, data, meta };
  } catch {
    return { ok: false as const, error: 'Sem confirmação do WhatsApp. Consulte o grupo antes de tentar novamente.' };
  }
}

export async function readGroupProperties(conn: WaConnectionRow, groupId: string): Promise<Ok<{ properties: GroupProperties }> | Fail> {
  const result = await groupRequest(conn, groupId);
  if (!result.ok) return result;
  const { subject, desc, description, pictureUrl } = result.data;
  if (typeof subject !== 'string') return { ok: false, error: 'O WhatsApp não disponibilizou os dados deste grupo.' };
  return { ok: true, properties: {
    subject, description: (result.meta ? description : desc) ?? '',
    pictureUrl: typeof pictureUrl === 'string' && pictureUrl.startsWith('https://') ? pictureUrl : null,
  } };
}

export async function editGroupProperty(conn: WaConnectionRow, groupId: string, edit: GroupEdit): Promise<Ok<{ pending: boolean }> | Fail> {
  const result = await groupRequest(conn, groupId, edit);
  if (!result.ok) return result;
  if (result.meta ? !result.data.request_id && result.data.success !== true : result.data.update !== 'success') {
    return { ok: false, error: 'O WhatsApp não confirmou a alteração. Atualize o grupo para conferir.' };
  }
  return { ok: true, pending: !!result.data.request_id };
}
