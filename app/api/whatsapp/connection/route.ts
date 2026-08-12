/**
 * GET    /api/whatsapp/connection  -> status da conexão da org (token mascarado)
 * POST   /api/whatsapp/connection  -> vincula a org a uma instância da Evolution (admin)
 *                                     { autoCreate: true } cria a instância da org sozinho
 * DELETE /api/whatsapp/connection  -> desconecta o número da org (logout; admin)
 */
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import {
  getConnectionByOrg,
  getConnectionsByOrg,
  getConnectionByIdForOrg,
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

  const conns = await getConnectionsByOrg(auth.admin, auth.user.organizationId);
  if (conns.length === 0) {
    return json({ connected: false, connection: null, metaWebhook: null, connections: [] });
  }

  // Status ao vivo POR conexão (meta_cloud é checagem local; Evolution é rede,
  // em paralelo e com fallback pro status salvo).
  const withStatus = await Promise.all(
    conns.map(async c => {
      let status = c.status;
      try {
        const live = await getProvider(c).getConnectionState();
        if (live !== c.status) {
          await updateConnectionStatus(auth.admin, c.id, { status: live });
          status = live;
        }
      } catch {
        // provedor indisponível: mantém o último status salvo
      }
      return { conn: c, status };
    })
  );

  // Só pra ADMIN e só no modo API oficial: as credenciais salvas, pra tela de
  // edição abrir preenchida (o admin foi quem cadastrou o token — poder rever
  // o que está salvo é parte de operar a conexão).
  const admin = isOrgAdmin(auth.user.role);
  const credsOf = (c: WaConnectionRow) =>
    admin && isBusinessConnection(c)
      ? {
          token: c.instance_token,
          phoneNumberId: c.meta_phone_number_id,
          wabaId: c.meta_waba_id,
          appId: c.meta_app_id,
          // A chave em si NUNCA vai pro navegador: só o fato de existir e o
          // tamanho (a UI mostra 1 bolinha por caractere; intacto = mantém).
          appSecretSet: Boolean(c.meta_app_secret),
          appSecretLength: c.meta_app_secret?.length ?? 0,
        }
      : null;

  const connections = withStatus.map(({ conn: c, status }) => ({
    ...mask(c),
    status,
    metaCredentials: credsOf(c),
  }));

  // Conexão PADRÃO (compat com a UI antiga): primeira conectada, senão a mais antiga
  const def = withStatus.find(w => w.status === 'connected') ?? withStatus[0];

  return json({
    connected: withStatus.some(w => w.status === 'connected'),
    connection: { ...mask(def.conn), status: def.status },
    metaWebhook: metaWebhookInfo(auth.user.role, def.conn),
    metaCredentials: credsOf(def.conn),
    connections,
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
    /** Multi-número: qual conexão o form está EDITANDO (atualiza a linha certa
     *  mesmo quando o Phone Number ID muda; omitido = número novo) */
    editingConnectionId?: string;
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
  let metaAppId: string | null | undefined;
  let metaAppSecret: string | null | undefined;
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
    // MULTI-NÚMERO: conectar um número da API oficial é ADITIVO — nunca mexe
    // nas outras conexões da org (managedSwitch fica false de propósito).
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

    // Nome sintético (satisfaz NOT NULL/UNIQUE e é a chave do upsert): mesma
    // org + mesmo phone_number_id = EDIÇÃO da conexão existente; número novo
    // = conexão nova com sufixo do número. O 1º número mantém o sufixo _cloud
    // puro (compat com as conexões criadas antes do multi-número).
    const metaConns = (previous ? await getConnectionsByOrg(auth.admin, auth.user.organizationId) : []).filter(
      isMetaCloudConnection
    );
    const samePhone = metaConns.find(c => c.meta_phone_number_id === check.phoneNumberId);
    // Form de EDIÇÃO aponta a linha exata (permite trocar o Phone Number ID
    // sem criar uma segunda conexão). Se o número digitado já é de OUTRA
    // linha da org, a dedup por número vence (atualiza aquela linha).
    const editingId = (body.editingConnectionId || '').trim();
    const editing = editingId ? metaConns.find(c => c.id === editingId) ?? null : null;
    // Desconectar LIMPA as credenciais da linha (meta_phone_number_id vira
    // null): reconectar reaproveita essa "vaga" em vez de criar linha zumbi.
    const emptySlot = metaConns.find(c => !c.meta_phone_number_id && c.status !== 'connected');
    const base = instanceNameForOrg(auth.user.organizationId);
    // Nome de linha NOVA leva sufixo aleatório: nomes derivados do número já
    // causaram colisão (vaga reusada guarda outro número sob o nome antigo).
    instanceName =
      samePhone?.instance_name ??
      editing?.instance_name ??
      emptySlot?.instance_name ??
      (metaConns.length === 0
        ? `${base}_cloud`
        : `${base}_cloud_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`);
    token = metaToken;
    baseUrl = null;
    provider = 'meta_cloud';
    metaPhoneNumberId = check.phoneNumberId;
    metaWabaId = check.wabaId || null;
    // App ID/Chave Secreta ficam SALVOS (edição abre preenchida; reconectar
    // reusa). Campo vazio no form = undefined = mantém o que já está salvo.
    metaAppId = body.metaAppId?.trim() || undefined;
    metaAppSecret = body.metaAppSecret?.trim() || undefined;
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
      appId: metaAppId,
      appSecret: metaAppSecret,
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
      // conn pós-upsert: valores recém-enviados OU os já salvos (reconexão
      // sem redigitar App ID/Chave Secreta continua com webhook automático)
      appId: conn.meta_app_id || null,
      appSecret: conn.meta_app_secret || null,
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

  // Troca de modo gerenciada (QR/business): derruba as instâncias evolution
  // ANTERIORES da org DEPOIS do novo vínculo estar salvo — senão seguiriam
  // vivas emitindo webhooks duplicados. Alvo EXPLÍCITO (linhas evolution que
  // não são a nova): a conexão "padrão" da org pode ser uma meta_cloud sem
  // relação com a troca. meta_cloud nunca entra aqui (conectar número da API
  // é ADITIVO, managedSwitch=false).
  if (managedSwitch) {
    const others = (await getConnectionsByOrg(auth.admin, auth.user.organizationId)).filter(
      c => !isMetaCloudConnection(c) && c.instance_name !== conn.instance_name
    );
    const normalize = (u: string) => u.replace(/\/+$/, '').replace(/\/manager$/, '');
    for (const old of others) {
      try {
        await getProvider(old).logout();
      } catch {
        // best-effort: a sessão pode nem existir mais
      }
      // O delete usa a apikey/servidor GLOBAL: só roda quando a conexão antiga
      // morava nesse servidor (vínculo manual pra outro servidor fica de fora,
      // senão apagaria uma instância homônima de outro tenant de lá).
      const prevBase = normalize(old.base_url || '');
      if (!prevBase || prevBase === normalize(envEvolution().baseUrl)) {
        await deleteEvolutionInstance(old.instance_name);
      }
      // a linha não é mais sobrescrita pelo upsert — marca desconectada pra
      // não ficar "conectada" zumbi na lista
      await updateConnectionStatus(auth.admin, old.id, { status: 'disconnected' });
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

export async function DELETE(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  // Multi-número: ?id=<connectionId> desconecta UMA conexão específica;
  // sem id, cai na conexão padrão (compat com a UI antiga de 1 número).
  const targetId = (new URL(req.url).searchParams.get('id') || '').trim();
  const conn = targetId
    ? await getConnectionByIdForOrg(auth.admin, auth.user.organizationId, targetId)
    : await getConnectionByOrg(auth.admin, auth.user.organizationId);
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
        meta_app_id: null,
        meta_app_secret: null,
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
