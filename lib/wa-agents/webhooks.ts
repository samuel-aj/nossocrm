/**
 * Webhooks por evento do agente. Best-effort: nunca lança; devolve os
 * resultados para o motor gravar em run.events.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConversationContext } from './context';
import { errorMessage } from './errors';
import { renderJsonTemplate } from './template';
import type { AgentEvent, AgentRow } from './types';

export type WebhookResult = { id: string; url: string; ok: boolean; status?: number; error?: string };

const TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 2_000;

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Payload padrão enviado a todos os webhooks de um evento. */
export function buildWebhookPayload(input: {
  agent: AgentRow;
  event: AgentEvent;
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
    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    if (res.ok) return { ok: true, status: res.status, retryable: false };
    return { ok: false, status: res.status, error: `HTTP ${res.status}`, retryable: res.status >= 500 };
  } catch (e) {
    return { ok: false, error: errorMessage(e), retryable: true };
  } finally {
    clearTimeout(timer);
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
      try {
        const bodyValue = hook.body_template?.trim()
          ? renderJsonTemplate(hook.body_template, payload)
          : payload;
        const body = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue);
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Webhook-Event': input.event,
        };
        const secret = (hook.secret ?? '').trim();
        if (secret) {
          headers['X-Webhook-Secret'] = secret;
          headers['Authorization'] = `Bearer ${secret}`;
        }
        let r = await postOnce(hook.url, body, headers);
        if (!r.ok && r.retryable) {
          await wait(RETRY_DELAY_MS);
          r = await postOnce(hook.url, body, headers);
        }
        results.push({ id: hook.id, url: hook.url, ok: r.ok, status: r.status, error: r.error });
      } catch (e) {
        results.push({ id: hook.id, url: hook.url, ok: false, error: errorMessage(e) });
      }
    }
  } catch (e) {
    console.error('[wa-agents] webhooks falharam:', errorMessage(e));
  }
  return results;
}
