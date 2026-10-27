'use client';

/** Consultas da integração ZapSign usadas pelas telas (modelos, variáveis, regra da etapa). */
import { useQuery } from '@tanstack/react-query';
import { useCRM } from '@/context/CRMContext';
import { SOURCE_CATALOG, type SourceOption } from '@/lib/zapsign/variables';

export type ZapSignTemplateItem = { token: string; name: string; lang: string | null; folder_path: string | null };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: 'include' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((body as { error?: string }).error || `HTTP ${res.status}`) as Error & { code?: string; status?: number };
    err.code = (body as { code?: string }).code;
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export function useZapSignTemplates(enabled = true) {
  return useQuery<{ templates: ZapSignTemplateItem[] }>({
    queryKey: ['zapsign', 'templates'],
    enabled,
    queryFn: () => getJson('/api/integrations/zapsign/templates'),
    staleTime: 60_000,
    retry: false,
  });
}

export function useZapSignTemplateVariables(token: string | null) {
  return useQuery<{ variables: string[]; suggestions: Record<string, string>; note?: string }>({
    queryKey: ['zapsign', 'template-vars', token ?? ''],
    enabled: !!token,
    queryFn: () => getJson(`/api/integrations/zapsign/templates?token=${encodeURIComponent(token as string)}&variables=1`),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Origens disponíveis: fixas + campos personalizados da organização. */
export function useVariableSources(): SourceOption[] {
  const { customFieldDefinitions } = useCRM();
  return [
    ...SOURCE_CATALOG,
    ...customFieldDefinitions.map((f) => ({ value: `campo:${f.key}`, label: f.label, group: 'Campos personalizados' })),
  ];
}

export const SEND_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'crm_whatsapp', label: 'Link pelo WhatsApp do CRM', hint: 'Mensagem sai pelo número conectado e fica na conversa. Sem custo na ZapSign.' },
  { value: 'zapsign_whatsapp', label: 'WhatsApp da ZapSign', hint: 'A ZapSign manda o convite pelo WhatsApp dela (cobrado por envio).' },
  { value: 'zapsign_email', label: 'E-mail da ZapSign', hint: 'A ZapSign manda o convite por e-mail. O contato precisa ter e-mail.' },
  { value: 'link', label: 'Só gerar o link', hint: 'Ninguém recebe nada; o link fica no lead para enviar como quiser.' },
];

export const AUTH_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'assinaturaTela', label: 'Assinatura na tela (padrão)' },
  { value: 'tokenWhatsapp', label: 'Código por WhatsApp' },
  { value: 'tokenEmail', label: 'Código por e-mail' },
  { value: 'tokenSms', label: 'Código por SMS' },
  { value: 'certificadoDigital', label: 'Certificado digital (ICP-Brasil)' },
];

export const DEFAULT_SIGN_MESSAGE = 'Olá {{primeiro_nome}}, segue o documento "{{documento}}" para assinatura eletrônica: {{link}}';
