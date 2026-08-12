/**
 * GET    /api/whatsapp/connection  -> status da conexão da org (token mascarado)
 * POST   /api/whatsapp/connection  -> vincula a org a uma instância da Evolution (admin)
 *                                     { autoCreate: true } cria a instância da org sozinho
 * DELETE /api/whatsapp/connection  -> desconecta o número da org (logout; admin)
 */
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import {
  getConnectionByOrg,
  upsertConnection,
  updateConnectionStatus,
  type WaConnectionRow,
} from '@/lib/whatsapp/service';
import {
  envEvolution,
  getProvider,
  isBusinessConnection,
  isEvolutionBusinessConnection,
  isMetaCloudConnection,
} from '@/lib/whatsapp';
import {
  deleteEvolutionInstance,
  ensureEvolutionInstance,
  instanceNameForOrg,
  registerWebhook,
} from '@/lib/whatsapp/admin';
import { setupMetaWebhooks, validateMetaCredentials } from '@/lib/whatsapp/metaCloudSetup';

function mask(conn: WaConnectionRow) {
  return {
    id: conn.id,
    provider: conn.provider,
    instanceName: conn.instance_name,
    baseUrl: conn.base_url,
    phoneNumber: conn.phone_number,
    profileName: conn.profile_name,
    status: conn.status,
  };
}

// Dados do webhook da Meta mostrados pro ADMIN na tela de conexão da API oficial.
// SÓ existem quando a org TEM uma conexão de API oficial (a URL do CRM leva o
// webhook_secret da conexão — sem conexão, não há o que mostrar; a UI orienta
// a conectar primeiro).
// - meta_cloud (DIRETO): a URL é do PRÓPRIO CRM (Edge Function whatsapp-webhook-meta)
//   com o webhook_secret da conexão no path; o verify token = o mesmo secret.
// - evolution_business (legado via Evolution): a URL é do endpoint /webhook/meta
//   da Evolution e o verify token vem da env EVOLUTION_META_VERIFY_TOKEN
//   (padrão 'evolution').
function metaWebhookInfo(role: string, conn: WaConnectionRow | null) {
  if (!isOrgAdmin(role)) return null;
  if (!conn || !isBusinessConnection(conn)) return null;
  if (isMetaCloudConnection(conn)) {
    const supabase = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
    if (!supabase) return null;
    return {
      url: `${supabase}/functions/v1/whatsapp-webhook-meta/${conn.webhook_secret}`,
      verifyToken: conn.webhook_secret,
    };
  }
  const base = envEvolution().baseUrl.replace(/\/+$/, '').replace(/\/manager$/, '');
  if (!base) return null;
  return {
    url: `${base}/webhook/meta`,
    verifyToken: process.env.EVOLUTION_META_VERIFY_TOKEN?.trim() || 'evolution',
  };
}

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  const metaWebhook = metaWebhookInfo(auth.user.role, conn);
  if (!conn) return json({ connected: false, connection: null, metaWebhook });

  // Só pra ADMIN e só no modo API oficial: as credenciais salvas, pra tela de
  // edição abrir preenchida (o admin foi quem cadastrou o token — poder rever
  // o que está salvo é parte de operar a conexão).
  const metaCredentials =
    isOrgAdmin(auth.user.role) && isBusinessConnection(conn)
      ? {
          token: conn.instance_token,
          phoneNumberId: conn.meta_phone_number_id,
          wabaId: conn.meta_waba_id,
        }
      : null;

  let status = conn.status;
  try {
    const live = await getProvider(conn).getConnectionState();
    if (live !== conn.status) {
      await updateConnectionStatus(auth.admin, conn.id, { status: live });
      status = live;
    }
  } catch {
    // Evolution indisponível: mantém o último status salvo
  }
  return json({
    connected: status === 'connected',
    connection: { ...mask(conn), status },
    metaWebhook,
    metaCredentials,
  });
}

export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  let body: {
    instanceName?: string;
    token?: string;
    baseUrl?: string;
    autoCreate?: boolean;
    mode?: string;
    metaToken?: string;
    metaNumberId?: string;
    metaBusinessId?: string;
    metaAppId?: string;
    metaAppSecret?: string;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'JSON inválido' }, 400);
  }

  let instanceName = (body.instanceName || '').trim();
  let token = body.token?.trim() || null;
  let baseUrl = body.baseUrl?.trim() || null;
  let provider: string | undefined;
  // Só preenchidos no modo meta_cloud (undefined = não mexer nas colunas Meta).
  let metaPhoneNumberId: string | null | undefined;
  let metaWabaId: string | null | undefined;
  // Conexão anterior da org (capturada ANTES do upsert): numa troca de modo
  // o nome da instância muda e a antiga precisa ser derrubada na Evolution,
  // senão ela segue viva emitindo webhooks que o CRM passa a descartar.
  const previous = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  let managedSwitch = false;

  // Resultado do setup automático do meta_cloud (devolvido pra UI no fim).
  let metaSetup: {
    displayPhoneNumber?: string;
    verifiedName?: string;
    idsCorrigidos?: boolean;
    appWebhook?: string;
    appWebhookError?: string;
    subscribed?: boolean;
    override?: boolean;
    overrideError?: string;
    recebimentoOk?: boolean;
  } | null = null;

  if (body.mode === 'meta_cloud') {
    managedSwitch = true;
    // MODO DIRETO (Cloud API da Meta, SEM Evolution): conexão por credenciais,
    // com setup AUTOMÁTICO: valida token/IDs (corrige IDs trocados), configura
    // o webhook e assina a WABA com callback exclusivo pro CRM. Nada manual.
    const metaToken = (body.metaToken || '').trim();
    const metaNumberId = (body.metaNumberId || '').trim().replace(/\D/g, '');
    const wabaId = (body.metaBusinessId || '').trim().replace(/\D/g, '');
    if (!metaToken || !metaNumberId) {
      return json({ error: 'Token permanente e Phone Number ID da Meta são obrigatórios' }, 400);
    }

    // Valida ANTES de salvar: token com acesso + IDs na ordem certa (a tela
    // "Contas do WhatsApp" da BM mostra o WABA id — erro clássico de troca).
    const check = await validateMetaCredentials(metaToken, metaNumberId, wabaId);
    if (!check.ok || !check.phoneNumberId) {
      return json({ error: check.error || 'Credenciais da Meta inválidas' }, 400);
    }

    // Nome sintético por org (satisfaz NOT NULL/UNIQUE); sufixo _cloud não
    // colide com a instância QR (_) nem com a business via Evolution (_api).
    instanceName = `${instanceNameForOrg(auth.user.organizationId)}_cloud`;
    token = metaToken;
    baseUrl = null;
    provider = 'meta_cloud';
    metaPhoneNumberId = check.phoneNumberId;
    metaWabaId = check.wabaId || null;
    metaSetup = {
      displayPhoneNumber: check.displayPhoneNumber,
      verifiedName: check.verifiedName,
      idsCorrigidos: Boolean(check.swapped),
    };
  } else if (body.mode === 'business') {
    managedSwitch = true;
    // MODO API OFICIAL (Meta Cloud API via Evolution): conexão por credenciais,
    // sem QR. A instância nasce "open"; erro de token só aparece no envio.
    const metaToken = (body.metaToken || '').trim();
    const metaNumberId = (body.metaNumberId || '').trim().replace(/\D/g, '');
    const metaBusinessId = (body.metaBusinessId || '').trim().replace(/\D/g, '');
    if (!metaToken || !metaNumberId) {
      return json({ error: 'Token permanente e Phone Number ID da Meta são obrigatórios' }, 400);
    }
    // Sufixo _api: nunca colide com a instância QR da org (senão o create
    // devolveria a instância Baileys existente em silêncio).
    instanceName = `${instanceNameForOrg(auth.user.organizationId)}_api`;
    try {
      const created = await ensureEvolutionInstance(instanceName, {
        mode: 'business',
        metaToken,
        metaNumberId,
        metaBusinessId: metaBusinessId || undefined,
      });
      token = created.token ?? metaToken;
      baseUrl = envEvolution().baseUrl.replace(/\/+$/, '').replace(/\/manager$/, '') || null;
      provider = 'evolution_business';
    } catch (e) {
      return json({ error: `Falha ao criar a instância business: ${(e as Error).message}` }, 502);
    }
  } else if (body.autoCreate) {
    managedSwitch = true;
    // Fluxo da UI: cria a instância DESTA org na Evolution automaticamente,
    // sem o admin do cliente precisar saber nome/token/servidor.
    instanceName = instanceNameForOrg(auth.user.organizationId);
    try {
      const created = await ensureEvolutionInstance(instanceName);
      token = created.token;
      // persiste a base também (normalizada): a Edge Function usa p/ buscar mídia
      baseUrl = envEvolution().baseUrl.replace(/\/+$/, '').replace(/\/manager$/, '') || null;
      provider = 'evolution';
    } catch (e) {
      return json({ error: `Falha ao criar a instância: ${(e as Error).message}` }, 502);
    }
  }
  if (!instanceName) return json({ error: 'instanceName é obrigatório' }, 400);

  let conn: WaConnectionRow;
  try {
    conn = await upsertConnection(auth.admin, auth.user.organizationId, {
      instanceName,
      token,
      baseUrl,
      provider,
      phoneNumberId: metaPhoneNumberId,
      wabaId: metaWabaId,
    });
  } catch (e) {
    return json({ error: `Falha ao salvar conexão: ${(e as Error).message}` }, 400);
  }

  // Recebimento: Evolution aponta o webhook da instância; meta_cloud faz o
  // setup AUTOMÁTICO na Meta (webhook do app se tiver App Secret, assinatura
  // na WABA e callback exclusivo pro CRM).
  if (!isMetaCloudConnection(conn)) {
    await registerWebhook(conn);
  } else if (body.mode === 'meta_cloud' && metaSetup) {
    const supabaseBase = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
    const callbackUrl = `${supabaseBase}/functions/v1/whatsapp-webhook-meta/${conn.webhook_secret}`;
    const hooks = await setupMetaWebhooks({
      token: (body.metaToken || '').trim(),
      wabaId: conn.meta_waba_id || '',
      appId: body.metaAppId?.trim() || null,
      appSecret: body.metaAppSecret?.trim() || null,
      callbackUrl,
      verifyToken: conn.webhook_secret,
    });
    metaSetup = {
      ...metaSetup,
      appWebhook: hooks.appWebhook,
      appWebhookError: hooks.appWebhookError,
      subscribed: hooks.subscribed,
      override: hooks.override,
      overrideError: hooks.overrideError,
      // Recebimento garantido quando o callback exclusivo entrou OU quando o
      // webhook do app foi configurado agora apontando pro CRM.
      recebimentoOk: hooks.override || hooks.appWebhook === 'ok',
    };
    // Já valida e grava o número na conexão (sem esperar o 1º evento).
    await updateConnectionStatus(auth.admin, conn.id, {
      status: 'connected',
      phone_number: metaSetup.displayPhoneNumber
        ? `+${metaSetup.displayPhoneNumber.replace(/\D/g, '')}`
        : undefined,
      profile_name: metaSetup.verifiedName ?? undefined,
    });
  }

  // Troca de modo gerenciada: derruba a instância anterior na Evolution DEPOIS
  // do novo vínculo estar salvo. Se ela ficasse viva, seguiria emitindo webhooks
  // com um instance_name que não casa mais com a conexão e as mensagens seriam
  // descartadas em silêncio. Só faz sentido quando a conexão anterior VIVIA na
  // Evolution (meta_cloud não tem instância lá).
  if (
    managedSwitch &&
    previous?.instance_name &&
    previous.instance_name !== conn.instance_name &&
    !isMetaCloudConnection(previous)
  ) {
    try {
      await getProvider(previous).logout();
    } catch {
      // best-effort: a sessão pode nem existir mais
    }
    // O delete usa a apikey/servidor GLOBAL: só roda quando a conexão antiga
    // morava nesse servidor (vínculo manual pra outro servidor fica de fora,
    // senão apagaria uma instância homônima de outro tenant de lá).
    const normalize = (u: string) => u.replace(/\/+$/, '').replace(/\/manager$/, '');
    const prevBase = normalize(previous.base_url || '');
    if (!prevBase || prevBase === normalize(envEvolution().baseUrl)) {
      await deleteEvolutionInstance(previous.instance_name);
    }
  }

  let status = conn.status;
  try {
    const live = await getProvider(conn).getConnectionState();
    await updateConnectionStatus(auth.admin, conn.id, { status: live });
    status = live;
  } catch {
    // segue com o status salvo
  }
  return json({ connection: { ...mask(conn), status }, metaSetup });
}

export async function DELETE() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  const conn = await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn) return json({ error: 'Conexão não configurada' }, 404);

  if (isMetaCloudConnection(conn)) {
    // Modo direto: não há instância na Evolution. Só limpa as credenciais —
    // reconectar exige informar token + phone_number_id de novo.
    await auth.admin
      .from('wa_connections')
      .update({
        status: 'disconnected',
        phone_number: null,
        profile_name: null,
        instance_token: null,
        meta_phone_number_id: null,
        meta_waba_id: null,
      })
      .eq('id', conn.id);
    return json({ ok: true });
  }

  if (isEvolutionBusinessConnection(conn)) {
    // API oficial via Evolution: apaga a instância na Evolution (purga o token
    // da Meta) e limpa o token salvo — reconectar exige as credenciais de novo.
    await deleteEvolutionInstance(conn.instance_name);
    await auth.admin
      .from('wa_connections')
      .update({ status: 'disconnected', phone_number: null, profile_name: null, instance_token: null })
      .eq('id', conn.id);
    return json({ ok: true });
  }

  try {
    await getProvider(conn).logout();
  } catch (e) {
    return json({ error: `Falha ao desconectar: ${(e as Error).message}` }, 502);
  }
  await updateConnectionStatus(auth.admin, conn.id, {
    status: 'disconnected',
    phone_number: null,
    profile_name: null,
  });
  return json({ ok: true });
}
