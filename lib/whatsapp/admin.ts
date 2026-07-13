/**
 * Operações ADMINISTRATIVAS na Evolution API — usam a chave GLOBAL do servidor
 * (EVOLUTION_API_KEY), nunca exposta ao client. Ficam fora do adapter porque
 * não são escopo de UMA instância: criar/recuperar instâncias por organização.
 *
 * Cada organização do CRM tem a SUA instância (1 número por org). O nome é
 * derivado do id da org, então o botão "Conectar" na UI não pede nada técnico.
 */
import { envEvolution } from './index';

/** Nome determinístico da instância da org (ex.: nossocrm_44a14051b9f2). */
export function instanceNameForOrg(orgId: string): string {
  return `nossocrm_${orgId.replace(/-/g, '').slice(0, 12)}`;
}

async function evoAdminCall<T = unknown>(
  method: 'GET' | 'POST',
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

/**
 * Garante que a instância exista na Evolution e devolve o token dela.
 * Se o nome já estiver em uso (org reconectando), recupera o token existente.
 */
export async function ensureEvolutionInstance(instanceName: string): Promise<{ token: string | null }> {
  const create = await evoAdminCall<EvoInstanceInfo>('POST', '/instance/create', {
    instanceName,
    integration: 'WHATSAPP-BAILEYS',
    qrcode: false,
  });
  if (create.ok) {
    return { token: extractToken(create.data) };
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
