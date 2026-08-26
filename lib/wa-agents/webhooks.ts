/**
 * Webhooks por evento do agente. Best-effort: nunca lança; devolve os
 * resultados para o motor gravar em run.events.
 *
 * `postWebhook` é o POST genérico (timeout, retentativa, cabeçalhos) reusado
 * pelas ações do tipo webhook (resultados, ações durante a conversa) e pelo
 * passo webhook dos robôs.
 */
import { lookup } from 'node:dns/promises';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationContext } from './context';
import { errorMessage } from './errors';
import { renderJsonTemplate } from './template';
import type { AgentEvent, AgentRow } from './types';
import { isPublicHttpUrl, isPublicIpAddress } from './url';

export type WebhookResult = { id: string; url: string; ok: boolean; status?: number; error?: string };

/** Nome que vai no cabeçalho X-Webhook-Event: eventos do agente ou os das ações/robôs. */
export type WebhookEventName = AgentEvent | 'outcome_action' | 'bot_webhook';

const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 2_000;
const DNS_TIMEOUT_MS = 5_000;

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Confere, no servidor, para onde o host da URL resolve: um nome público que
 * aponta para rede privada, link-local, CGNAT ou NAT64 é recusado (a URL já
 * passou por isPublicHttpUrl, que só vê o texto). null quando ok; senão o motivo.
 */
export async function resolvesToPrivateAddress(rawUrl: string): Promise<string | null> {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return 'URL inválida';
  }
  // IP literal: já validado pelo isPublicHttpUrl
  if (host.includes(':') || /^[0-9.]+$/.test(host)) return null;
  try {
    const addresses = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('tempo esgotado ao resolver o host')), DNS_TIMEOUT_MS)),
    ]);
    if (!addresses || addresses.length === 0) return 'host sem endereço';
    const bad = addresses.find(a => !isPublicIpAddress(a.address));
    return bad ? `host resolve para endereço não público (${bad.address})` : null;
  } catch (e) {
    return `não foi possível resolver o host: ${errorMessage(e)}`;
  }
}

/** Payload padrão enviado a todos os webhooks de um evento. */
export function buildWebhookPayload(input: {
  agent: AgentRow;
  event: WebhookEventName;
  ctx: ConversationContext;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const { agent, event, ctx, extra } = input;
  const c = ctx.conversation;
  return {
    event,
    occurred_at: new Date().toISOString(),
    organization_id: c.organization_id,
    agent: { id: agent.id, name: agent.name, persona_name: agent.persona_name ?? null },
    conversation: {
      id: c.id,
      phone: c.wa_phone,
      name: ctx.contact?.name ?? c.wa_name ?? null,
      contact_id: c.contact_id,
      deal_id: ctx.deal?.id ?? c.deal_id ?? null,
      ai_status: c.ai_status,
      agent_id: c.ai_agent_id,
    },
    contact: ctx.contact,
    deal: ctx.deal,
    ...(extra ?? {}),
  };
}

async function postOnce(
  url: string,
  body: string,
  headers: Record<string, string>
): Promise<{ ok: boolean; status?: number; error?: string; retryable: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // Sem seguir redirecionamentos: um 3xx poderia apontar para um host interno
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal, redirect: 'manual' });
    if (res.ok) return { ok: true, status: res.status, retryable: false };
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, status: res.status, error: `redirecionamento não permitido (HTTP ${res.status})`, retryable: false };
    }
    return { ok: false, status: res.status, error: `HTTP ${res.status}`, retryable: res.status >= 500 };
  } catch (e) {
    return { ok: false, error: errorMessage(e), retryable: true };
  } finally {
    clearTimeout(timer);
  }
}

export type PostWebhookInput = {
  url: string;
  event: WebhookEventName;
  /** Payload padrão (também são as variáveis do corpo personalizado) */
  payload: Record<string, unknown>;
  secret?: string | null;
  /** Corpo personalizado com {{variáveis}}; vazio = payload em JSON */
  body_template?: string | null;
};

/**
 * POST com timeout de 10 s, cabeçalhos padrão (X-Webhook-Event, segredo) e
 * uma retentativa após 2 s em erro de rede/5xx. Só URL pública http/https
 * (texto e endereço resolvido), sem seguir redirecionamentos. Nunca lança.
 */
export async function postWebhook(input: PostWebhookInput): Promise<Omit<WebhookResult, 'id'>> {
  try {
    if (!isPublicHttpUrl(input.url)) return { url: input.url, ok: false, error: 'URL precisa ser pública (http/https)' };
    const dnsError = await resolvesToPrivateAddress(input.url);
    if (dnsError) return { url: input.url, ok: false, error: `URL recusada: ${dnsError}` };
    const bodyValue = input.body_template?.trim()
      ? renderJsonTemplate(input.body_template, input.payload)
      : input.payload;
    const body = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': input.event,
    };
    const secret = (input.secret ?? '').trim();
    if (secret) {
      headers['X-Webhook-Secret'] = secret;
      headers['Authorization'] = `Bearer ${secret}`;
    }
    let r = await postOnce(input.url, body, headers);
    if (!r.ok && r.retryable) {
      await wait(RETRY_DELAY_MS);
      r = await postOnce(input.url, body, headers);
    }
    return { url: input.url, ok: r.ok, status: r.status, error: r.error };
  } catch (e) {
    return { url: input.url, ok: false, error: errorMessage(e) };
  }
}

export async function dispatchAgentEvent(
  _admin: SupabaseClient,
  input: { agent: AgentRow; event: AgentEvent; ctx: ConversationContext; extra?: Record<string, unknown> }
): Promise<WebhookResult[]> {
  const results: WebhookResult[] = [];
  try {
    const hooks = (input.agent.webhooks ?? []).filter(w => w.active !== false && w.event === input.event);
    if (hooks.length === 0) return results;
    const payload = buildWebhookPayload(input);

    for (const hook of hooks) {
      const r = await postWebhook({
        url: hook.url,
        event: input.event,
        payload,
        secret: hook.secret,
        body_template: hook.body_template,
      });
      results.push({ id: hook.id, ...r });
    }
  } catch (e) {
    console.error('[wa-agents] webhooks falharam:', errorMessage(e));
  }
  return results;
}
