/**
 * API4com no CRM: conexão por usuário (token + ramal + webhook), clique para
 * ligar, desligar e o retorno da chamada (atendida, duração, gravação) que vai
 * para o histórico do lead.
 *
 * Fluxo de uma ligação:
 *   1. a pessoa clica em Ligar no lead -> linha em api4com_calls (dialing)
 *   2. POST /calls na API4com: toca no Webphone do usuário e, quando ele atende,
 *      disca para o cliente -> a resposta traz o id (ringing)
 *   3. webhook channel-answer -> answered; channel-hangup -> ended com o
 *      resultado, a duração e a gravação; evento `call` no histórico do lead.
 * Só chamadas feitas pelo CRM chegam no webhook (filtro por metadata.gateway).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { normalizePhoneE164 } from '@/lib/phone';
import { Api4comError, clientFor, type Api4comClient } from './client';
import { resultFor, type CallResult, type CallRow } from './shared';

export const API4COM_GATEWAY = 'nossocrm';
export const CALL_EVENT_KIND = 'call';

export type Api4comUserRow = {
  organization_id: string;
  user_id: string;
  api_token: string;
  api4com_uuid: string | null;
  api4com_name: string | null;
  api4com_email: string | null;
  extension: string | null;
  domain: string | null;
  integration_id: string | null;
  webhook_url: string | null;
  webhook_secret: string;
  verified_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type Api4comUserView = {
  connected: true;
  name: string | null;
  email: string | null;
  extension: string | null;
  domain: string | null;
  webhook_ok: boolean;
  verified_at: string | null;
  last_error: string | null;
  token_hint: string;
};

export type Deps = {
  client?: (token: string) => Api4comClient;
  now?: () => Date;
};

export type WebhookPayload = {
  version?: string;
  eventType?: string;
  id?: string;
  domain?: string;
  direction?: string;
  caller?: string;
  called?: string;
  startedAt?: string;
  answeredAt?: string;
  endedAt?: string;
  duration?: number | string;
  hangupCause?: string;
  hangupCauseCode?: string | number;
  recordUrl?: string;
  metadata?: Record<string, unknown> | null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tokenHint(token: string): string {
  return token.length <= 8 ? '****' : `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export function newWebhookSecret(): string {
  return randomBytes(24).toString('base64url');
}

export function publicView(row: Api4comUserRow): Api4comUserView {
  return {
    connected: true,
    name: row.api4com_name,
    email: row.api4com_email,
    extension: row.extension,
    domain: row.domain,
    webhook_ok: !!row.integration_id,
    verified_at: row.verified_at,
    last_error: row.last_error,
    token_hint: tokenHint(row.api_token),
  };
}

export async function loadUserSettings(admin: SupabaseClient, orgId: string, userId: string): Promise<Api4comUserRow | null> {
  const { data, error } = await admin.from('api4com_user_settings').select('*').eq('organization_id', orgId).eq('user_id', userId).maybeSingle();
  if (error) {
    if (/api4com_user_settings/.test(error.message)) return null; // migração ainda não aplicada
    throw new Error(error.message);
  }
  return (data as Api4comUserRow | null) ?? null;
}

/** Telefone do contato -> E.164 que a API4com aceita; null quando não dá para ligar. */
export function normalizeCalled(phone: string | null | undefined): string | null {
  const e164 = normalizePhoneE164(phone ?? '');
  return /^\+\d{8,15}$/.test(e164) ? e164 : null;
}

/** O que dizer para a pessoa quando a API4com recusa a ligação. */
export function friendlyCallError(err: unknown): string {
  if (!(err instanceof Api4comError)) return err instanceof Error ? err.message : 'Falha ao ligar';
  switch (err.status) {
    case 401:
      return 'O token da API4com não vale mais. Conecte de novo em Configurações > Geral.';
    case 402:
    case 403:
      return 'O plano ou a situação do usuário na API4com não permite ligar agora.';
    case 404:
      return 'O ramal não foi encontrado na API4com. Conecte de novo em Configurações > Geral.';
    case 422:
      return 'A API4com não aceitou o número do contato.';
    case 424:
      return 'O Webphone da API4com não atendeu. Abra a extensão do Webphone no Chrome, entre com o seu usuário e tente de novo.';
    case 429:
      return 'Muitas ligações em um minuto. Aguarde um pouco e tente de novo.';
    case 503:
      return 'A API4com está indisponível no momento. Tente em alguns segundos.';
    default:
      if (err.code === 'TIMEOUT') return 'A API4com não respondeu a tempo. A ligação pode ter saído: veja o Webphone.';
      return err.message;
  }
}

/**
 * Conecta a API4com do usuário: valida o token, descobre o ramal e cadastra
 * (ou atualiza) o webhook de retorno apontando para este CRM.
 */
export async function connectUser(
  admin: SupabaseClient,
  input: { orgId: string; userId: string; token: string; webhookUrlFor: (secret: string) => string },
  deps: Deps = {}
): Promise<Api4comUserRow> {
  const token = input.token.trim();
  const client = (deps.client ?? clientFor)(token);
  const me = await client.me();

  const sip = await client.findIntegrations('sippulse');
  const meta = (sip[0]?.metadata ?? {}) as { username?: string; domain?: string };
  const extension = meta.username ? String(meta.username) : null;
  if (!extension) {
    throw new Api4comError('Este usuário ainda não tem ramal na API4com. O administrador da conta API4com precisa liberar um plano com ramal para ele.', 404, 'NO_EXTENSION');
  }

  const existing = await loadUserSettings(admin, input.orgId, input.userId);
  const secret = existing?.webhook_secret ?? newWebhookSecret();
  const url = input.webhookUrlFor(secret);

  // Integração de webhook: atualiza a existente (precisa do id) ou cria
  let integrationId: string | null = null;
  let webhookError: string | null = null;
  try {
    const ours = await client.findIntegrations(API4COM_GATEWAY);
    const currentId = ours[0]?.id ?? null;
    const saved = await client.upsertIntegration({
      ...(currentId != null ? { id: currentId } : {}),
      gateway: API4COM_GATEWAY,
      webhook: true,
      webhookConstraint: { metadata: { gateway: API4COM_GATEWAY } },
      metadata: { webhookUrl: url, webhookVersion: 'v1.8', webhookTypes: ['channel-answer', 'channel-hangup'] },
    });
    integrationId = saved?.id != null ? String(saved.id) : currentId != null ? String(currentId) : null;
    if (!integrationId) webhookError = 'a API4com não devolveu o id da integração do webhook';
  } catch (err) {
    webhookError = `webhook não cadastrado: ${(err as Error).message}`;
  }

  const now = (deps.now?.() ?? new Date()).toISOString();
  const row = {
    organization_id: input.orgId,
    user_id: input.userId,
    api_token: token,
    api4com_uuid: me.uuid ?? null,
    api4com_name: me.name ?? null,
    api4com_email: me.email ?? null,
    extension,
    domain: meta.domain ? String(meta.domain) : null,
    integration_id: integrationId,
    webhook_url: url,
    webhook_secret: secret,
    verified_at: now,
    last_error: webhookError,
    updated_at: now,
  };
  const { data, error } = await admin.from('api4com_user_settings').upsert(row, { onConflict: 'organization_id,user_id' }).select('*').single();
  if (error) {
    if (/api4com_user_settings/.test(error.message)) throw new Api4comError('A integração com a API4com ainda não foi instalada no banco. Fale com o suporte.', 503, 'PENDING_MIGRATION');
    throw new Error(error.message);
  }
  return data as Api4comUserRow;
}

/** Desconecta: apaga o webhook na API4com (se der) e o token no CRM. */
export async function disconnectUser(admin: SupabaseClient, input: { orgId: string; userId: string }, deps: Deps = {}): Promise<void> {
  const existing = await loadUserSettings(admin, input.orgId, input.userId);
  if (!existing) return;
  if (existing.integration_id) {
    try {
      await (deps.client ?? clientFor)(existing.api_token).deleteIntegration(existing.integration_id);
    } catch {
      /* token pode já não valer; o CRM esquece mesmo assim */
    }
  }
  const { error } = await admin.from('api4com_user_settings').delete().eq('organization_id', input.orgId).eq('user_id', input.userId);
  if (error) throw new Error(error.message);
}

async function loadCall(admin: SupabaseClient, orgId: string, id: string): Promise<CallRow | null> {
  const { data, error } = await admin.from('api4com_calls').select('*').eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CallRow | null) ?? null;
}

/**
 * Clique para ligar. Grava a linha antes de chamar a API4com, porque o webhook
 * pode chegar antes da resposta (acha a linha pelo metadata.call).
 */
export async function startCall(
  admin: SupabaseClient,
  input: { orgId: string; userId: string; dealId?: string | null; contactId?: string | null; phone: string },
  deps: Deps = {}
): Promise<CallRow> {
  const settings = await loadUserSettings(admin, input.orgId, input.userId);
  if (!settings) throw new Api4comError('Conecte a API4com em Configurações > Geral para ligar pelo CRM.', 409, 'NOT_CONNECTED');
  if (!settings.extension) throw new Api4comError('O seu usuário da API4com não tem ramal. Conecte de novo em Configurações > Geral.', 409, 'NO_EXTENSION');
  const called = normalizeCalled(input.phone);
  if (!called) throw new Api4comError('O telefone do contato não está num formato válido para ligar.', 422, 'INVALID_PHONE');

  const { data: created, error: insErr } = await admin
    .from('api4com_calls')
    .insert({
      organization_id: input.orgId,
      user_id: input.userId,
      deal_id: input.dealId ?? null,
      contact_id: input.contactId ?? null,
      called,
      extension: settings.extension,
      status: 'dialing',
      metadata: { gateway: API4COM_GATEWAY },
    })
    .select('*')
    .single();
  if (insErr) {
    if (/api4com_calls/.test(insErr.message)) throw new Api4comError('A integração com a API4com ainda não foi instalada no banco. Fale com o suporte.', 503, 'PENDING_MIGRATION');
    throw new Error(insErr.message);
  }
  const row = created as CallRow;

  const client = (deps.client ?? clientFor)(settings.api_token);
  try {
    const r = await client.call({ extension: settings.extension, called, metadata: { gateway: API4COM_GATEWAY, org: input.orgId, call: row.id } });
    const callId = r?.id ? String(r.id) : null;
    const now = (deps.now?.() ?? new Date()).toISOString();
    if (callId) await admin.from('api4com_calls').update({ call_id: callId, updated_at: now }).eq('id', row.id);
    // o webhook pode já ter marcado "answered"/"ended": só avança quem ainda está discando
    await admin.from('api4com_calls').update({ status: 'ringing', updated_at: now }).eq('id', row.id).eq('status', 'dialing');
  } catch (err) {
    const message = friendlyCallError(err);
    const now = (deps.now?.() ?? new Date()).toISOString();
    await admin.from('api4com_calls').update({ status: 'failed', result: 'failed', error: message, ended_at: now, updated_at: now }).eq('id', row.id);
    throw new Api4comError(message, err instanceof Api4comError ? err.status : 502, err instanceof Api4comError ? err.code : null);
  }
  return (await loadCall(admin, input.orgId, row.id)) ?? row;
}

/** Desliga uma ligação em andamento (a própria pessoa, ou um admin). */
export async function hangupCall(admin: SupabaseClient, input: { orgId: string; userId: string; isAdmin: boolean; id: string }, deps: Deps = {}): Promise<CallRow | null> {
  const row = await loadCall(admin, input.orgId, input.id);
  if (!row) return null;
  if (row.user_id !== input.userId && !input.isAdmin) throw new Api4comError('Esta ligação é de outra pessoa.', 403, 'FORBIDDEN');
  if (row.call_id && (row.status === 'dialing' || row.status === 'ringing' || row.status === 'answered')) {
    const settings = await loadUserSettings(admin, input.orgId, row.user_id);
    if (settings) {
      try {
        await (deps.client ?? clientFor)(settings.api_token).hangup(row.call_id);
      } catch {
        /* já pode ter caído; o webhook fecha o estado */
      }
    }
  }
  return row;
}

export function webhookDedupeKey(p: WebhookPayload): string {
  return `${p.id ?? 'sem-id'}:${p.eventType ?? 'sem-tipo'}`;
}

async function findCallForPayload(admin: SupabaseClient, orgId: string, p: WebhookPayload): Promise<CallRow | null> {
  const ref = (p.metadata as { call?: unknown } | null)?.call;
  if (typeof ref === 'string' && UUID_RE.test(ref)) {
    const row = await loadCall(admin, orgId, ref);
    if (row) return row;
  }
  if (p.id) {
    const { data } = await admin.from('api4com_calls').select('*').eq('organization_id', orgId).eq('call_id', p.id).maybeSingle();
    if (data) return data as CallRow;
  }
  return null;
}

/**
 * Retorno da API4com. Usa o relógio do CRM na chegada do aviso (os horários da
 * API4com vêm sem fuso); a duração vem dela.
 */
export async function handleApi4comWebhook(admin: SupabaseClient, orgId: string, payload: WebhookPayload, deps: Deps = {}): Promise<{ action: string }> {
  const row = await findCallForPayload(admin, orgId, payload);
  if (!row) return { action: 'ignored:unknown-call' };
  const now = deps.now?.() ?? new Date();
  const nowIso = now.toISOString();

  if (payload.eventType === 'channel-answer') {
    if (row.status === 'ended' || row.status === 'failed') return { action: 'ignored:already-ended' };
    await admin
      .from('api4com_calls')
      .update({ status: 'answered', answered_at: row.answered_at ?? nowIso, call_id: row.call_id ?? payload.id ?? null, record_url: payload.recordUrl ?? row.record_url, updated_at: nowIso })
      .eq('id', row.id);
    return { action: 'answered' };
  }

  if (payload.eventType === 'channel-hangup') {
    if (row.status === 'ended') return { action: 'ignored:duplicate' };
    const duration = Math.max(0, Math.round(Number(payload.duration ?? 0) || 0));
    const result: CallResult = resultFor(payload.hangupCause, duration);
    const answeredAt = row.answered_at ?? (duration > 0 ? new Date(now.getTime() - duration * 1000).toISOString() : null);
    await admin
      .from('api4com_calls')
      .update({
        status: 'ended',
        result,
        call_id: row.call_id ?? payload.id ?? null,
        answered_at: answeredAt,
        ended_at: nowIso,
        duration,
        hangup_cause: payload.hangupCause ?? null,
        hangup_cause_code: payload.hangupCauseCode != null ? String(payload.hangupCauseCode) : null,
        record_url: payload.recordUrl ?? row.record_url,
        updated_at: nowIso,
      })
      .eq('id', row.id);
    if (row.deal_id) {
      await admin.from('deal_events').insert({
        organization_id: orgId,
        deal_id: row.deal_id,
        kind: CALL_EVENT_KIND,
        field: row.called,
        new_value: result,
        detail: {
          provider: 'api4com',
          call_id: row.call_id ?? payload.id ?? null,
          result,
          duration,
          record_url: duration > 0 ? (payload.recordUrl ?? row.record_url ?? null) : null,
          hangup_cause: payload.hangupCause ?? null,
          called: row.called,
          extension: row.extension,
        },
        actor_kind: 'user',
        actor_id: row.user_id,
      });
    }
    return { action: `ended:${result}` };
  }

  return { action: `ignored:${payload.eventType ?? 'sem-tipo'}` };
}
