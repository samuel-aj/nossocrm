/**
 * Templates da API oficial da Meta via Evolution (instância business).
 * Criar um modelo whatsapp_api no CRM cria o template NA META; a aba Modelos
 * também sincroniza (puxa) os templates que já existem lá, com o status de
 * aprovação (APPROVED | PENDING | REJECTED).
 *
 * Endpoints da Evolution v2:
 *   POST /template/create/{instance}  body { name, category, language, components }
 *   GET  /template/find/{instance}
 * Auth: apikey da INSTÂNCIA business (que é o próprio token da Meta).
 */
import type { WaConnectionRow } from './service';
import { envEvolution } from './index';
import type { TemplateButton } from '@/lib/messageTemplates';

/** Componente BUTTONS da Meta -> nossos botões (ignora tipos que não usamos). */
function parseButtons(comps: Record<string, unknown>[]): TemplateButton[] | null {
  const comp = comps.find(c => String(c?.type ?? '').toUpperCase() === 'BUTTONS');
  const raw = Array.isArray(comp?.buttons) ? (comp!.buttons as Record<string, unknown>[]) : [];
  const out: TemplateButton[] = [];
  for (const b of raw) {
    const type = String(b?.type ?? '').toUpperCase();
    const text = String(b?.text ?? '').trim();
    if (!text) continue;
    if (type === 'QUICK_REPLY') out.push({ type, text });
    else if (type === 'URL') out.push({ type, text, url: String(b?.url ?? '') });
    else if (type === 'PHONE_NUMBER') out.push({ type, text, phone_number: String(b?.phone_number ?? '') });
  }
  return out.length ? out : null;
}

async function evoInstanceCall<T = unknown>(
  conn: Pick<WaConnectionRow, 'base_url' | 'instance_token' | 'instance_name'>,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const env = envEvolution();
  const baseUrl = (conn.base_url || env.baseUrl).replace(/\/+$/, '').replace(/\/manager$/, '');
  const token = conn.instance_token || env.token;
  if (!baseUrl || !token) {
    throw new Error('Evolution não configurada (base URL/token ausentes)');
  }
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', apikey: token },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

export interface MetaTemplateInfo {
  metaId: string | null;
  name: string;
  status: string | null;
  category: string | null;
  language: string | null;
  bodyText: string | null;
  buttons: TemplateButton[] | null;
}

/** Cria o template na Meta (WABA da conexão business). */
const GRAPH_TPL = () => `https://graph.facebook.com/${(process.env.META_GRAPH_VERSION || 'v21.0').trim()}`;

/** Conexão DIRETA na Meta (meta_cloud): templates vivem na WABA, via Graph. */
const isMetaCloudTpl = (conn: { provider?: string | null }) =>
  String(conn.provider ?? '').toLowerCase() === 'meta_cloud';

export async function createMetaTemplate(
  conn: Pick<WaConnectionRow, 'base_url' | 'instance_token' | 'instance_name' | 'provider' | 'meta_waba_id'>,
  input: {
    name: string;
    category: 'UTILITY' | 'MARKETING';
    language: string;
    bodyText: string;
    examples: string[];
    buttons?: TemplateButton[] | null;
  }
): Promise<{ ok: boolean; error?: string }> {
  const components: Record<string, unknown>[] = [
    {
      type: 'BODY',
      text: input.bodyText,
      // a Meta EXIGE exemplos quando o corpo tem placeholders {{n}}
      ...(input.examples.length > 0 ? { example: { body_text: [input.examples] } } : {}),
    },
  ];
  if (input.buttons && input.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map(b =>
        b.type === 'URL'
          ? { type: 'URL', text: b.text, url: b.url }
          : b.type === 'PHONE_NUMBER'
            ? { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number }
            : { type: 'QUICK_REPLY', text: b.text }
      ),
    });
  }

  // meta_cloud: cria direto na WABA pela Graph API (sem Evolution no meio)
  if (isMetaCloudTpl(conn)) {
    if (!conn.meta_waba_id || !conn.instance_token) {
      return { ok: false, error: 'Conexão da Meta sem WABA/token salvos. Reconecte na aba Conexão.' };
    }
    const res = await fetch(`${GRAPH_TPL()}/${encodeURIComponent(conn.meta_waba_id)}/message_templates`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${conn.instance_token}` },
      body: JSON.stringify({
        name: input.name,
        category: input.category,
        language: input.language,
        components,
      }),
      cache: 'no-store',
    });
    const j = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; error_user_msg?: string };
    };
    if (!res.ok || j.error) {
      return { ok: false, error: j.error?.error_user_msg || j.error?.message || `Meta respondeu ${res.status}` };
    }
    return { ok: true };
  }

  const { ok, status, data } = await evoInstanceCall<Record<string, unknown>>(
    conn,
    'POST',
    `/template/create/${encodeURIComponent(conn.instance_name)}`,
    { name: input.name, category: input.category, language: input.language, components }
  );
  if (!ok) {
    const detail =
      (data as { message?: string; error?: string } | null)?.message ||
      (data as { error?: string } | null)?.error ||
      `Evolution respondeu ${status}`;
    return { ok: false, error: String(detail) };
  }
  return { ok: true };
}

/** Lista os templates existentes na Meta (pra sincronizar com o CRM). */
export async function listMetaTemplates(
  conn: Pick<WaConnectionRow, 'base_url' | 'instance_token' | 'instance_name' | 'provider' | 'meta_waba_id'>
): Promise<{ ok: boolean; templates: MetaTemplateInfo[]; error?: string }> {
  // meta_cloud: lista direto da WABA pela Graph API
  if (isMetaCloudTpl(conn)) {
    if (!conn.meta_waba_id || !conn.instance_token) {
      return { ok: false, templates: [], error: 'Conexão da Meta sem WABA/token salvos.' };
    }
    const res = await fetch(
      `${GRAPH_TPL()}/${encodeURIComponent(conn.meta_waba_id)}/message_templates?fields=id,name,status,category,language,components&limit=200`,
      { headers: { authorization: `Bearer ${conn.instance_token}` }, cache: 'no-store' }
    );
    const j = (await res.json().catch(() => ({}))) as {
      data?: Record<string, unknown>[];
      error?: { message?: string };
    };
    if (!res.ok || j.error) {
      return { ok: false, templates: [], error: j.error?.message || `Meta respondeu ${res.status}` };
    }
    const templates: MetaTemplateInfo[] = [];
    for (const t of j.data ?? []) {
      if (!t || typeof t !== 'object') continue;
      const comps = Array.isArray(t.components) ? (t.components as Record<string, unknown>[]) : [];
      const bodyComp = comps.find(c => String(c?.type ?? '').toUpperCase() === 'BODY');
      templates.push({
        metaId: t.id != null ? String(t.id) : null,
        name: String(t.name ?? ''),
        status: t.status != null ? String(t.status).toUpperCase() : null,
        category: t.category != null ? String(t.category).toUpperCase() : null,
        language: t.language != null ? String(t.language) : null,
        bodyText: bodyComp?.text != null ? String(bodyComp.text) : null,
        buttons: parseButtons(comps),
      });
    }
    return { ok: true, templates };
  }

  const { ok, status, data } = await evoInstanceCall<unknown>(
    conn,
    'GET',
    `/template/find/${encodeURIComponent(conn.instance_name)}`
  );
  if (!ok) {
    return { ok: false, templates: [], error: `Evolution respondeu ${status}` };
  }
  // formatos variam por versão: array direto ou { data: [...] }
  const raw = Array.isArray(data)
    ? data
    : Array.isArray((data as { data?: unknown[] } | null)?.data)
      ? ((data as { data: unknown[] }).data)
      : [];
  const templates: MetaTemplateInfo[] = [];
  for (const t of raw as Record<string, unknown>[]) {
    if (!t || typeof t !== 'object') continue;
    const comps = Array.isArray(t.components) ? (t.components as Record<string, unknown>[]) : [];
    const bodyComp = comps.find(c => String(c?.type ?? '').toUpperCase() === 'BODY');
    templates.push({
      metaId: t.id != null ? String(t.id) : null,
      name: String(t.name ?? ''),
      status: t.status != null ? String(t.status).toUpperCase() : null,
      category: t.category != null ? String(t.category).toUpperCase() : null,
      language: t.language != null ? String(t.language) : null,
      bodyText: bodyComp?.text != null ? String(bodyComp.text) : null,
      buttons: parseButtons(comps),
    });
  }
  return { ok: true, templates: templates.filter(t => t.name) };
}
