'use client';

/**
 * Tipos e consultas dos documentos de assinatura de UM lead, compartilhados
 * pela aba Contrato, pelo modal de conferência e pelo histórico.
 */
import { useQuery } from '@tanstack/react-query';

export type SignerLite = { name: string; status: string; signed_at: string | null; role: string };

export type Signature = {
  id: string;
  origin: 'rule' | 'manual';
  status: string;
  stage_id: string | null;
  template_name: string | null;
  doc_name: string | null;
  sign_url: string | null;
  sent_via: string | null;
  sent_at: string | null;
  signed_at: string | null;
  refused_at: string | null;
  refused_reason: string | null;
  file_id: string | null;
  last_error: string | null;
  signers: SignerLite[];
  created_at: string;
};

export type DealSignatures = {
  connected: boolean;
  sandbox?: boolean;
  signatures: Signature[];
  file_url: string | null;
  file_signature_id: string | null;
  pendingMigration?: boolean;
};

export const STATUS_LABEL: Record<string, string> = {
  review: 'Aguardando conferência',
  queued: 'Na fila para envio',
  processing: 'Enviando...',
  pending: 'Aguardando assinatura',
  signed: 'Assinado',
  refused: 'Recusado',
  deleted: 'Excluído na ZapSign',
  expired: 'Expirado',
  failed: 'Falha no envio',
  cancelled: 'Cancelado',
};

/** Estados em que ainda pode acontecer algo (o CRM continua consultando). */
export const LIVE_STATUSES = ['queued', 'processing', 'pending'];

export const DT = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export const dealSignaturesKey = (dealId: string) => ['zapsign', 'deal', dealId] as const;

export function useDealSignatures(dealId: string, enabled = true) {
  return useQuery<DealSignatures>({
    queryKey: dealSignaturesKey(dealId),
    enabled,
    queryFn: async () => {
      const res = await fetch(`/api/integrations/zapsign/deal/${dealId}`, { credentials: 'include' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      return body as DealSignatures;
    },
    retry: false,
    staleTime: 10_000,
    refetchInterval: (query) => {
      const list = query.state.data?.signatures ?? [];
      return list.some((s) => LIVE_STATUSES.includes(s.status)) ? 15_000 : false;
    },
  });
}

export type SendOutcome = { status: string; sent_via?: string; note?: string; error?: string; reason?: string };
export type SendResponse = { error?: string; signature?: Signature; outcome?: SendOutcome };
