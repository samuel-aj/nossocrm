/**
 * Cliente da API da ZapSign (assinatura eletrônica). Só o que a integração usa:
 * listar modelos, criar documento a partir de modelo, consultar documento,
 * baixar arquivo e manter o webhook da conta. Token Bearer da conta ZapSign,
 * produção ou sandbox (docs.zapsign.com.br).
 */

export const ZAPSIGN_PROD_BASE = 'https://api.zapsign.com.br/api/v1';
export const ZAPSIGN_SANDBOX_BASE = 'https://sandbox.api.zapsign.com.br/api/v1';
export const ZAPSIGN_SIGN_URL = 'https://app.zapsign.com.br/verificar/';

const TIMEOUT_MS = 25_000;

export class ZapSignError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'ZapSignError';
    this.status = status;
    this.body = body;
  }
}

export type ZapSignTemplate = {
  token: string;
  name: string;
  template_type?: string | null;
  active?: boolean;
  template_file?: string | null;
  created_at?: string;
  last_update_at?: string;
  lang?: string | null;
  folder_path?: string | null;
};

export type ZapSignSigner = {
  token: string;
  sign_url?: string | null;
  status: string;
  name: string;
  email?: string | null;
  phone_country?: string | null;
  phone_number?: string | null;
  signed_at?: string | null;
  last_view_at?: string | null;
  times_viewed?: number | null;
  external_id?: string | null;
};

export type ZapSignDoc = {
  token: string;
  open_id?: number;
  name: string;
  status: string; // pending | signed | refused ...
  original_file?: string | null;
  signed_file?: string | null;
  created_at?: string;
  last_update_at?: string;
  signers: ZapSignSigner[];
  answers?: Array<{ variable: string; value: string }>;
  external_id?: string | null;
};

export type ZapSignSignerInput = {
  name: string;
  email?: string;
  phone_country?: string;
  phone_number?: string;
  auth_mode?: string;
  send_automatic_email?: boolean;
  send_automatic_whatsapp?: boolean;
  require_cpf?: boolean;
  require_selfie_photo?: boolean;
  require_document_photo?: boolean;
  qualification?: string;
  external_id?: string;
  custom_message?: string;
};

export type CreateDocFromTemplateInput = {
  template_id: string;
  signer_name: string;
  signer_email?: string;
  signer_phone_country?: string;
  signer_phone_number?: string;
  data: Array<{ de: string; para: string }>;
  name?: string;
  lang?: 'pt-br' | 'es' | 'en';
  external_id?: string;
  send_automatic_email?: boolean;
  send_automatic_whatsapp?: boolean;
  signer_has_incomplete_fields?: boolean;
  allow_refuse_signature?: boolean;
  brand_name?: string;
  folder_path?: string;
  metadata?: Array<{ key: string; value: string }>;
};

export type ZapSignWebhook = { id: number | string; url: string; type?: string | null };

export function zapsignBaseUrl(sandbox: boolean): string {
  return sandbox ? ZAPSIGN_SANDBOX_BASE : ZAPSIGN_PROD_BASE;
}

/** Link de assinatura de um signatário (o mesmo que a ZapSign devolve em sign_url). */
export function signerLink(signerToken: string): string {
  return `${ZAPSIGN_SIGN_URL}${signerToken}`;
}

type FetchLike = typeof fetch;

export class ZapSignClient {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: { token: string; sandbox: boolean; fetchImpl?: FetchLike }) {
    this.base = zapsignBaseUrl(opts.sandbox);
    this.token = opts.token.trim();
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        redirect: 'manual',
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }
      if (!res.ok) throw new ZapSignError(describeError(res.status, json), res.status, json);
      return json as T;
    } catch (err) {
      if (err instanceof ZapSignError) throw err;
      const aborted = (err as { name?: string })?.name === 'AbortError';
      throw new ZapSignError(aborted ? 'a ZapSign demorou demais para responder' : `falha de rede ao falar com a ZapSign: ${(err as Error).message}`, 0);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Modelos da conta (todas as páginas, até um teto). */
  async listTemplates(maxPages = 10): Promise<ZapSignTemplate[]> {
    const out: ZapSignTemplate[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const res = await this.request<{ results?: ZapSignTemplate[]; next?: string | null }>('GET', `/templates/?page=${page}`);
      out.push(...(res.results ?? []));
      if (!res.next) break;
    }
    return out;
  }

  async createDocFromTemplate(input: CreateDocFromTemplateInput): Promise<ZapSignDoc> {
    return this.request<ZapSignDoc>('POST', '/models/create-doc/', input);
  }

  async addSigner(docToken: string, signer: ZapSignSignerInput): Promise<ZapSignSigner> {
    return this.request<ZapSignSigner>('POST', `/docs/${encodeURIComponent(docToken)}/add-signer/`, signer);
  }

  /** Ajusta um signatário que ainda não assinou (autenticação, CPF, envio). */
  async updateSigner(signerToken: string, input: Partial<ZapSignSignerInput>): Promise<ZapSignSigner> {
    return this.request<ZapSignSigner>('POST', `/signers/${encodeURIComponent(signerToken)}/`, input);
  }

  async getDoc(docToken: string): Promise<ZapSignDoc> {
    return this.request<ZapSignDoc>('GET', `/docs/${encodeURIComponent(docToken)}/`);
  }

  async deleteDoc(docToken: string): Promise<void> {
    await this.request<unknown>('DELETE', `/docs/${encodeURIComponent(docToken)}/`);
  }

  async createWebhook(input: { url: string; type?: string; headers?: Array<{ name: string; value: string }> }): Promise<ZapSignWebhook> {
    return this.request<ZapSignWebhook>('POST', '/user/company/webhook/', { type: '', ...input });
  }

  async deleteWebhook(id: number | string): Promise<void> {
    await this.request<unknown>('DELETE', '/user/company/webhook/delete/', { id });
  }

  /** Baixa um arquivo (link temporário da ZapSign) para memória. */
  async download(url: string, maxBytes = 25 * 1024 * 1024): Promise<{ bytes: Uint8Array; contentType: string | null }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await this.fetchImpl(url, { signal: ctrl.signal });
      if (!res.ok) throw new ZapSignError(`não foi possível baixar o arquivo (HTTP ${res.status})`, res.status);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > maxBytes) throw new ZapSignError('arquivo maior que o limite', 0);
      return { bytes: buf, contentType: res.headers.get('content-type') };
    } finally {
      clearTimeout(timer);
    }
  }
}

function describeError(status: number, body: unknown): string {
  const b = body as { detail?: unknown; message?: unknown; error?: unknown; non_field_errors?: unknown } | string | null;
  let msg = '';
  if (typeof b === 'string') msg = b.slice(0, 200);
  else if (b && typeof b === 'object') {
    const v = b.detail ?? b.message ?? b.error ?? b.non_field_errors;
    if (typeof v === 'string') msg = v;
    else if (Array.isArray(v)) msg = v.map(String).join('; ');
    else if (v && typeof v === 'object') msg = JSON.stringify(v).slice(0, 200);
    else msg = JSON.stringify(b).slice(0, 200);
  }
  if (status === 401 || status === 403) return `a ZapSign recusou o token (HTTP ${status})${msg ? `: ${msg}` : ''}`;
  if (status === 429) return 'limite de requisições da ZapSign atingido, tente de novo em instantes';
  return `ZapSign respondeu HTTP ${status}${msg ? `: ${msg}` : ''}`;
}
