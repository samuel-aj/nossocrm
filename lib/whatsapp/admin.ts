/**
 * Operações ADMINISTRATIVAS na Evolution API — usam a chave GLOBAL do servidor
 * (EVOLUTION_API_KEY), nunca exposta ao client. Ficam fora do adapter porque
 * não são escopo de UMA instância: criar/recuperar instâncias por organização.
 *
 * Cada organização do CRM tem a SUA instância (1 número por org). O nome é
 * derivado do id da org, então o botão "Conectar" na UI não pede nada técnico.
 */
import { envEvolution, getProvider, type ConnectionLike } from './index';

/** Nome determinístico da instância da org (ex.: nossocrm_44a14051b9f2). */
export function instanceNameForOrg(orgId: string): string {
  return `nossocrm_${orgId.replace(/-/g, '').slice(0, 12)}`;
}

/** Registra o webhook da instância -> Edge Function do ambiente atual (best-effort). */
export async function registerWebhook(
  conn: ConnectionLike & { webhook_secret: string }
): Promise<void> {
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

async function evoAdminCall<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<{ ok: boolean; status: number; data: T | null }> {
  const { baseUrl, token } = envEvolution();
  if (!baseUrl || !token) {
    throw new Error('EVOLUTION_BASE_URL/EVOLUTION_API_KEY não configurados no servidor');
  }
  const res = await fetch(`${baseUrl.replace(/\/+$/, '').replace(/\/manager$/, '')}${path}`, {
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

interface EvoInstanceInfo {
  name?: string;
  instanceName?: string;
  token?: string;
  hash?: string | { apikey?: string };
  instance?: { instanceName?: string; token?: string };
}

function extractToken(info: EvoInstanceInfo | null | undefined): string | null {
  if (!info) return null;
  if (typeof info.hash === 'string') return info.hash;
  return info.hash?.apikey ?? info.token ?? info.instance?.token ?? null;
}

/** Credenciais da Meta pro modo API oficial (Cloud API via Evolution). */
export interface BusinessInstanceOpts {
  mode: 'business';
  /** Token PERMANENTE do usuário de sistema da Business Manager. */
  metaToken: string;
  /** phone_number_id do painel da Meta (NÃO é o número de telefone). */
  metaNumberId: string;
  /** WhatsApp Business Account ID (WABA) — opcional; necessário p/ templates. */
  metaBusinessId?: string;
}

/**
 * Garante que a instância exista na Evolution e devolve o token dela.
 * Modo padrão (Baileys/QR): se o nome já estiver em uso (org reconectando),
 * recupera o token existente.
 * Modo business (API oficial da Meta): a instância carrega as credenciais no
 * create; se já existir uma com o mesmo nome, ela é APAGADA e recriada — é o
 * único jeito de trocar um token da Meta rotacionado.
 */
export async function ensureEvolutionInstance(
  instanceName: string,
  opts?: BusinessInstanceOpts
): Promise<{ token: string | null }> {
  const createBody =
    opts?.mode === 'business'
      ? {
          instanceName,
          integration: 'WHATSAPP-BUSINESS',
          qrcode: false,
          token: opts.metaToken,
          number: opts.metaNumberId,
          ...(opts.metaBusinessId ? { businessId: opts.metaBusinessId } : {}),
        }
      : {
          instanceName,
          integration: 'WHATSAPP-BAILEYS',
          qrcode: false,
        };

  const create = await evoAdminCall<EvoInstanceInfo>('POST', '/instance/create', createBody);
  if (create.ok) {
    return { token: extractToken(create.data) };
  }

  if (opts?.mode === 'business') {
    // Nome em uso: apaga e recria com as credenciais NOVAS (token pode ter
    // sido rotacionado na Meta; a Evolution não atualiza token de instância).
    await evoAdminCall('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`);
    const retry = await evoAdminCall<EvoInstanceInfo>('POST', '/instance/create', createBody);
    if (retry.ok) return { token: extractToken(retry.data) };
    throw new Error(`Evolution não criou a instância business (HTTP ${retry.status})`);
  }

  // Nome já em uso (403/409): recupera o token da instância existente.
  const list = await evoAdminCall<EvoInstanceInfo[]>(
    'GET',
    `/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`
  );
  if (list.ok && Array.isArray(list.data) && list.data.length > 0) {
    const found =
      list.data.find(
        i => (i.name ?? i.instanceName ?? i.instance?.instanceName) === instanceName
      ) ?? list.data[0];
    return { token: extractToken(found) };
  }

  throw new Error(`Evolution não criou a instância (HTTP ${create.status})`);
}

/** Apaga a instância na Evolution (best-effort; usada ao desconectar o modo API). */
export async function deleteEvolutionInstance(instanceName: string): Promise<void> {
  try {
    await evoAdminCall('DELETE', `/instance/delete/${encodeURIComponent(instanceName)}`);
  } catch {
    // best-effort: instância pode já não existir
  }
}
