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
}

/** Cria o template na Meta (WABA da conexão business). */
export async function createMetaTemplate(
  conn: Pick<WaConnectionRow, 'base_url' | 'instance_token' | 'instance_name'>,
  input: { name: string; category: 'UTILITY' | 'MARKETING'; language: string; bodyText: string; examples: string[] }
): Promise<{ ok: boolean; error?: string }> {
  const components: Record<string, unknown>[] = [
    {
      type: 'BODY',
      text: input.bodyText,
      // a Meta EXIGE exemplos quando o corpo tem placeholders {{n}}
      ...(input.examples.length > 0 ? { example: { body_text: [input.examples] } } : {}),
    },
  ];
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
  conn: Pick<WaConnectionRow, 'base_url' | 'instance_token' | 'instance_name'>
): Promise<{ ok: boolean; templates: MetaTemplateInfo[]; error?: string }> {
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
    });
  }
  return { ok: true, templates: templates.filter(t => t.name) };
}
