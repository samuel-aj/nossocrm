/**
 * Setup AUTOMÁTICO da conexão meta_cloud (Cloud API direto na Meta).
 *
 * Faz pelo admin tudo que antes era manual no painel da Meta:
 *  1. valida token + IDs (detecta Phone Number ID e WABA ID TROCADOS e corrige);
 *  2. (com App ID + App Secret) configura o webhook DO APP apontando pro CRM
 *     e assina o campo `messages` — POST /{app-id}/subscriptions;
 *  3. assina o app na WABA e registra um callback EXCLUSIVO desta WABA pro CRM
 *     (override_callback_uri) — imune a mudanças no painel do app.
 *
 * Tudo best-effort com resultado estruturado: a rota devolve o checklist e a
 * UI mostra o que ficou pronto e o que (se algo) ficou pendente.
 */

const GRAPH = () => `https://graph.facebook.com/${(process.env.META_GRAPH_VERSION || 'v21.0').trim()}`;

interface GraphResult<T = Record<string, unknown>> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function graph<T = Record<string, unknown>>(
  method: 'GET' | 'POST',
  path: string,
  params: Record<string, string>
): Promise<GraphResult<T>> {
  const body = new URLSearchParams(params);
  const url = method === 'GET' ? `${GRAPH()}${path}?${body.toString()}` : `${GRAPH()}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      ...(method === 'POST'
        ? { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() }
        : {}),
      cache: 'no-store',
    });
  } catch (e) {
    return { ok: false, status: 0, data: null, error: `Falha de rede ao falar com a Meta: ${(e as Error).message}` };
  }
  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    data = null;
  }
  const err = (data as { error?: { message?: string } } | null)?.error?.message;
  return { ok: res.ok && !err, status: res.status, data, error: err };
}

export interface MetaCredentialsCheck {
  ok: boolean;
  /** IDs válidos, já na ordem certa (corrigidos se vieram trocados). */
  phoneNumberId?: string;
  wabaId?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
  swapped?: boolean;
  error?: string;
}

/**
 * Valida token + IDs. Detecta os DOIS erros clássicos:
 * - Phone Number ID e WABA ID trocados (a tela da BM mostra o WABA id);
 * - "Phone Number ID" que na verdade é uma WABA com 1 número (auto-descobre).
 */
export async function validateMetaCredentials(
  token: string,
  numberId: string,
  wabaId: string
): Promise<MetaCredentialsCheck> {
  const asPhone = async (id: string) =>
    graph<{ display_phone_number?: string; verified_name?: string }>('GET', `/${encodeURIComponent(id)}`, {
      fields: 'display_phone_number,verified_name',
      access_token: token,
    });
  const listPhones = async (id: string) =>
    graph<{ data?: Array<{ id?: string; display_phone_number?: string; verified_name?: string }> }>(
      'GET',
      `/${encodeURIComponent(id)}/phone_numbers`,
      { fields: 'id,display_phone_number,verified_name', access_token: token }
    );

  // Caso feliz: numberId é mesmo um número.
  const direct = await asPhone(numberId);
  if (direct.ok && direct.data?.display_phone_number) {
    return {
      ok: true,
      phoneNumberId: numberId,
      wabaId,
      displayPhoneNumber: direct.data.display_phone_number,
      verifiedName: direct.data.verified_name,
    };
  }

  // numberId pode ser uma WABA (IDs trocados ou só a WABA informada).
  const asWaba = await listPhones(numberId);
  const phones = asWaba.ok ? asWaba.data?.data ?? [] : [];
  if (phones.length > 0) {
    // O campo "WABA" pode conter o número verdadeiro (troca simples)...
    if (wabaId) {
      const other = await asPhone(wabaId);
      if (other.ok && other.data?.display_phone_number) {
        return {
          ok: true,
          phoneNumberId: wabaId,
          wabaId: numberId,
          displayPhoneNumber: other.data.display_phone_number,
          verifiedName: other.data.verified_name,
          swapped: true,
        };
      }
    }
    // ...ou a WABA tem um único número: usa ele.
    if (phones.length === 1 && phones[0]?.id) {
      return {
        ok: true,
        phoneNumberId: phones[0].id,
        wabaId: numberId,
        displayPhoneNumber: phones[0].display_phone_number,
        verifiedName: phones[0].verified_name,
        swapped: true,
      };
    }
    return {
      ok: false,
      error:
        'O ID informado como Phone Number ID é de uma CONTA (WABA) com vários números. Informe o Phone Number ID do número desejado (painel do app, WhatsApp > API Setup).',
    };
  }

  return {
    ok: false,
    error: `A Meta não reconheceu o Phone Number ID com este token${direct.error ? ` (${direct.error})` : ''}. Confira o token (permanente, com acesso à conta de WhatsApp atribuído) e os IDs.`,
  };
}

/**
 * Diagnóstico: o que a Meta REALMENTE tem configurado para esta conexão.
 * Serve pra responder "por que a mensagem que mandei do celular não apareceu?"
 * sem precisar abrir o painel da Meta. Não devolve token nem segredo.
 */
export async function inspectMetaWebhooks(input: {
  token: string;
  wabaId: string;
  appId?: string | null;
  appSecret?: string | null;
}): Promise<{
  camposAssinadosNoApp: string[] | null;
  ecosAssinados: boolean | null;
  callbackDoApp: string | null;
  appAssinadoNaWaba: boolean | null;
  erro?: string;
}> {
  const out: {
    camposAssinadosNoApp: string[] | null;
    ecosAssinados: boolean | null;
    callbackDoApp: string | null;
    appAssinadoNaWaba: boolean | null;
    erro?: string;
  } = { camposAssinadosNoApp: null, ecosAssinados: null, callbackDoApp: null, appAssinadoNaWaba: null };

  if (input.appId && input.appSecret) {
    const appToken = `${input.appId.trim()}|${input.appSecret.trim()}`;
    const r = await graph<{
      data?: Array<{ object?: string; callback_url?: string; fields?: Array<{ name?: string } | string> }>;
    }>('GET', `/${encodeURIComponent(input.appId.trim())}/subscriptions`, { access_token: appToken });
    if (r.ok) {
      const waba = (r.data?.data ?? []).find(s => s.object === 'whatsapp_business_account');
      const campos = (waba?.fields ?? []).map(f => (typeof f === 'string' ? f : f?.name ?? '')).filter(Boolean);
      out.camposAssinadosNoApp = campos;
      out.ecosAssinados = campos.includes('smb_message_echoes') || campos.includes('message_echoes');
      out.callbackDoApp = waba?.callback_url ?? null;
    } else {
      out.erro = r.error || `HTTP ${r.status}`;
    }
  }

  const sub = await graph<{ data?: Array<{ whatsapp_business_api_data?: { id?: string } }> }>(
    'GET',
    `/${encodeURIComponent(input.wabaId)}/subscribed_apps`,
    { access_token: input.token }
  );
  if (sub.ok) out.appAssinadoNaWaba = (sub.data?.data ?? []).length > 0;
  else if (!out.erro) out.erro = sub.error || `HTTP ${sub.status}`;

  return out;
}

export interface WebhookSetupResult {
  /** Webhook do APP configurado (exige App ID + App Secret). */
  appWebhook: 'ok' | 'skipped' | 'failed';
  appWebhookError?: string;
  /** App assinado na WABA. */
  subscribed: boolean;
  subscribedError?: string;
  /** Callback exclusivo desta WABA apontando pro CRM. */
  override: boolean;
  overrideError?: string;
}

/**
 * Liga o recebimento: webhook do app (opcional, com secret) + assinatura na
 * WABA + callback exclusivo por WABA. Best-effort em cada passo.
 */
export async function setupMetaWebhooks(input: {
  token: string;
  wabaId: string;
  appId?: string | null;
  appSecret?: string | null;
  callbackUrl: string;
  verifyToken: string;
}): Promise<WebhookSetupResult> {
  const result: WebhookSetupResult = { appWebhook: 'skipped', subscribed: false, override: false };

  // 1. Webhook do APP + campo messages (só com App ID + Secret). A Meta
  //    verifica o callback na hora (nosso GET responde o challenge).
  if (input.appId && input.appSecret) {
    const appToken = `${input.appId.trim()}|${input.appSecret.trim()}`;
    // Ecos = o que este número enviou POR FORA do CRM. Dois campos na Meta:
    // smb_message_echoes (enviado pelo APP do WhatsApp Business no celular,
    // números em coexistência) e message_echoes (enviado via Cloud API).
    // Sem assinar, a Meta nunca avisa e a mensagem não aparece no chat.
    // Se a Meta recusar um campo de eco (varia por tipo de conta/versão),
    // tenta conjuntos menores — a assinatura nunca falha por inteiro.
    // Grupos (Groups API): tenta primeiro com os campos group_*; app sem esse
    // acesso cai nos conjuntos de sempre (a cura periódica reaplica se a org
    // ligar grupos depois).
    const GRUPOS = ',group_lifecycle_update,group_participants_update,group_settings_update,group_status_update';
    const conjuntos = [
      `messages,message_echoes,smb_message_echoes${GRUPOS}`,
      'messages,message_echoes,smb_message_echoes',
      'messages,message_echoes',
      'messages',
    ];
    let ultimoErro: string | undefined;
    for (const fields of conjuntos) {
      const r = await graph('POST', `/${encodeURIComponent(input.appId.trim())}/subscriptions`, {
        object: 'whatsapp_business_account',
        callback_url: input.callbackUrl,
        verify_token: input.verifyToken,
        fields,
        access_token: appToken,
      });
      if (r.ok) {
        result.appWebhook = 'ok';
        // conseguiu, mas SEM todos os ecos: registra pro admin saber
        if (fields !== conjuntos[0]) {
          result.appWebhookError = `Meta aceitou só os campos: ${fields} (${ultimoErro ?? 'campo de eco recusado'})`;
        }
        break;
      }
      ultimoErro = r.error || `HTTP ${r.status}`;
      result.appWebhook = 'failed';
      result.appWebhookError = ultimoErro;
    }
  }

  // 2. Assina o app na WABA (idempotente).
  const sub = await graph('POST', `/${encodeURIComponent(input.wabaId)}/subscribed_apps`, {
    access_token: input.token,
  });
  result.subscribed = sub.ok;
  if (!sub.ok) result.subscribedError = sub.error || `HTTP ${sub.status}`;

  // 3. Callback EXCLUSIVO desta WABA -> CRM (imune ao painel do app). Exige o
  //    campo messages assinado no app (passo 1, ou feito no painel alguma vez).
  const ov = await graph('POST', `/${encodeURIComponent(input.wabaId)}/subscribed_apps`, {
    override_callback_uri: input.callbackUrl,
    verify_token: input.verifyToken,
    access_token: input.token,
  });
  result.override = ov.ok;
  if (!ov.ok) result.overrideError = ov.error || `HTTP ${ov.status}`;

  return result;
}
