'use client';

/**
 * API4com no navegador: a conexão da própria pessoa (token + ramal), a lista
 * da equipe (admin) e as chamadas de ligar, consultar e desligar.
 */
import { useQuery } from '@tanstack/react-query';
import type { CallRow } from '@/lib/api4com/shared';

export type Api4comMe =
  | { connected: false }
  | {
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

export type Api4comTeamUser = {
  user_id: string;
  name: string;
  api4com_name: string | null;
  email: string | null;
  extension: string | null;
  webhook_ok: boolean;
  verified_at: string | null;
  last_error: string | null;
};

export const API4COM_ME_KEY = ['api4com', 'me'] as const;
export const API4COM_TEAM_KEY = ['api4com', 'team'] as const;

export class Api4comRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Api4comRequestError(body.error || `HTTP ${res.status}`, res.status);
  return body as T;
}

export function useApi4comMe(enabled = true) {
  return useQuery<Api4comMe>({
    queryKey: API4COM_ME_KEY,
    queryFn: () => call<Api4comMe>('/api/integrations/api4com/me'),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useApi4comTeam(enabled = true) {
  return useQuery<{ users: Api4comTeamUser[]; pendingMigration?: boolean }>({
    queryKey: API4COM_TEAM_KEY,
    queryFn: () => call('/api/integrations/api4com/team'),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

export const connectApi4com = (apiToken: string) => call<Api4comMe>('/api/integrations/api4com/me', { method: 'PUT', body: JSON.stringify({ api_token: apiToken }) });
export const disconnectApi4com = () => call<Api4comMe>('/api/integrations/api4com/me', { method: 'DELETE' });

export const startApi4comCall = (input: { phone: string; dealId?: string | null; contactId?: string | null }) =>
  call<{ call: CallRow }>('/api/integrations/api4com/calls', {
    method: 'POST',
    body: JSON.stringify({ phone: input.phone, deal_id: input.dealId ?? null, contact_id: input.contactId ?? null }),
  });
export const getApi4comCall = (id: string) => call<{ call: CallRow }>(`/api/integrations/api4com/calls/${id}`);
export const hangupApi4comCall = (id: string) => call<{ call: CallRow }>(`/api/integrations/api4com/calls/${id}/hangup`, { method: 'POST', body: '{}' });
