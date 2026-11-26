import type { ApiKeyAccessMode } from './accessModes';

export type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  scopes: string[] | null;
};

/** As rotas resolvem a organização da aba e exigem um administrador. */
export async function apiKeysRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body as T;
}

export async function createOrganizationApiKey(name: string, accessMode: ApiKeyAccessMode) {
  const { data } = await apiKeysRequest<{ data: ApiKeyRow & { token: string } }>('/api/api-keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, accessMode }),
  });
  if (!data?.token || !data.key_prefix) throw new Error('Resposta inválida ao criar chave');
  return data;
}
