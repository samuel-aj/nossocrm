/**
 * GET    /api/whatsapp/connection  -> status da conexão da org (token mascarado)
 * POST   /api/whatsapp/connection  -> vincula a org a uma instância da Evolution (admin)
 *                                     { autoCreate: true } cria a instância da org sozinho
 * DELETE /api/whatsapp/connection  -> desconecta o número da org (logout; admin)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { logSecurityEvent } from '@/lib/security/auditLog';
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import { filterAllowedConnections, getVisibilityRules } from '@/lib/permissions/server';
import {
  getConnectionByOrg,
  getConnectionsByOrg,
  getConnectionByIdForOrg,
  upsertConnection,
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
import {
  enforceOneConnectionPerNumber,
  phoneKey,
  findConnectedSameNumber,
  mergeConnectionConversations,
  repointConnectionRefs,
  tearDownEvolutionInstance,
} from '@/lib/whatsapp/dedupe';

import { getLineDiagnostics } from '@/lib/whatsapp/connectionDiagnostics';
import { isPublicHttpUrl } from '@/lib/wa-agents/url';
import { resolvesToPrivateAddress } from '@/lib/wa-agents/webhooks';
import { observeConnection } from '@/lib/whatsapp/connectionIncidents';
import type { WhatsAppProvider } from '@/lib/whatsapp/providers/types';

function mask(conn: WaConnectionRow) {
  return {
    id: conn.id,
    provider: conn.provider,
    instanceName: conn.instance_name,
    baseUrl: conn.base_url,
    phoneNumber: conn.phone_number,
    profileName: conn.profile_name,
    status: conn.status,
    alertOwnerId: conn.health_alert_owner_id ?? null,
    forwardWebhookUrl: conn.forward_webhook_url ?? null,
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

  const orgId = auth.user.organizationId;
  let allConns: WaConnectionRow[];
  try {
    allConns = await getConnectionsByOrg(auth.admin, orgId, true);
  } catch {
    return json({ error: 'Não foi possível consultar as conexões.' }, 503);
  }
  const vis = await getVisibilityRules(auth.admin, orgId, auth.user.id, auth.user.role);
  const allowed = filterAllowedConnections(vis, allConns);
  if (!allowed.length) return json({ connected: false, connection: null, metaWebhook: null, connections: [], removed: [] });

  // Só pra ADMIN e só no modo API oficial: as credenciais salvas, pra tela de
  // edição abrir preenchida (o admin foi quem cadastrou o token — poder rever
  // o que está salvo é parte de operar a conexão).
  const admin = isOrgAdmin(auth.user.role);
  const credsOf = (c: WaConnectionRow) =>
    admin && isBusinessConnection(c)
      ? {
          // O token da Meta também não vai mais pro navegador (auditoria 23/11/2026):
          // quem roubasse a sessão do admin levava um token que vale fora do CRM.
          // A UI mostra bolinhas; intacto = o servidor mantém o token salvo.
          token: null,
          tokenSet: Boolean(c.instance_token),
          tokenLength: c.instance_token?.length ?? 0,
          phoneNumberId: c.meta_phone_number_id,
          wabaId: c.meta_waba_id,
          appId: c.meta_app_id,
          // A chave em si NUNCA vai pro navegador: só o fato de existir e o
          // tamanho (a UI mostra 1 bolinha por caractere; intacto = mantém).
          appSecretSet: Boolean(c.meta_app_secret),
          appSecretLength: c.meta_app_secret?.length ?? 0,
        }
      : null;

  const health = await getLineDiagnostics(auth.admin, orgId, allowed);
  const connections = allowed.map((conn, i) => ({
    ...mask(conn),
    diagnostics: health[i],
    metaCredentials: credsOf(conn),
  }));
  // Os consumidores de chats/modelos usam o estado operacional. A tela de saúde usa diagnostics.
  const def = allowed.find(c => c.status === 'connected') ?? allowed[0];
  const result = json({
    connected: allowed.some(c => c.status === 'connected'),
    connection: connections.find(c => c.id === def.id),
    metaWebhook: metaWebhookInfo(auth.user.role, def),
    metaCredentials: credsOf(def),
    connections,
    removed: [],
  });
  result.headers.set('Cache-Control', 'private, no-store');
  return result;
}

export async function POST(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  const requestedAt = new Date().toISOString();
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
    /** Hub: com autoCreate, força criar OUTRA linha QR (não reusa a existente) */
    newNumber?: boolean;
    connectionId?: string;
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
  // HUB multi-número: TODA conexão é ADITIVA (QR e API oficial convivem em
  // qualquer quantidade); nada é derrubado implicitamente — só o Desconectar
  // explícito de cada linha. Lista atual da org guia nomes/reuso de vagas.
  const existing = await getConnectionsByOrg(auth.admin, auth.user.organizationId);

  if (body.mode === 'finish_pairing') {
    const target = existing.find(c => c.id === body.connectionId);
    if (!target || isBusinessConnection(target)) return json({ error: 'Pareamento não encontrado.' }, 404);
    if (target.health_monitor_enabled === false) return json({ error: 'A conexão foi desligada. Inicie um novo pareamento.' }, 409);
    // A linha pode estar "open" logo após ler o QR, mesmo com outro aparelho pareado.
    const provider = getProvider(target);
    const checkedAt = new Date().toISOString();
    const [check, identity] = await Promise.all([provider.checkConnectionHealth(), provider.getPairingIdentity?.()]).catch(() => [null, null] as const);
    if (check?.state !== 'connected' || !identity?.phone) {
      return json({ error: 'Não foi possível confirmar o número pareado. Confira o aparelho e tente novamente.' }, 409);
    }
    await observeConnection(auth.admin, target.id, 'connected', 'manual', checkedAt, 'pairing_confirmed', identity);
    const paired = await getConnectionByIdForOrg(auth.admin, auth.user.organizationId, target.id);
    if (!paired || paired.status !== 'connected' || paired.health_identity_mismatch_at || phoneKey(paired.phone_number) !== phoneKey(identity.phone)) {
      return json({ error: 'Conexão não confirmada. Verifique se o aparelho usa o número original.' }, 409);
    }
    const numberKey = phoneKey(paired.phone_number);
    if (!numberKey) return json({ error: 'O provedor não confirmou o número pareado.' }, 409);
    const sameNumber = [...existing.filter(c => c.id !== paired.id && phoneKey(c.phone_number) === numberKey), paired];
    const removed = await enforceOneConnectionPerNumber(auth.admin, auth.user.organizationId, sameNumber);
    return json({ ok: true, removed });
  }

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
  // Token efetivo do meta_cloud (o digitado ou, se a tela mandou o campo intacto, o salvo).
  let resolvedMetaToken = '';

  if (body.mode === 'meta_cloud') {
    // MULTI-NÚMERO: conectar um número da API oficial é ADITIVO — nunca mexe
    // nas outras conexões da org (managedSwitch fica false de propósito).
    // MODO DIRETO (Cloud API da Meta, SEM Evolution): conexão por credenciais,
    // com setup AUTOMÁTICO: valida token/IDs (corrige IDs trocados), configura
    // o webhook e assina a WABA com callback exclusivo pro CRM. Nada manual.
    let metaToken = (body.metaToken || '').trim();
    const metaNumberId = (body.metaNumberId || '').trim().replace(/\D/g, '');
    const wabaId = (body.metaBusinessId || '').trim().replace(/\D/g, '');
    if (!metaToken) {
      // Campo intacto na edição: usa o token já salvo da conexão desta org
      // (a linha em edição ou a do mesmo Phone Number ID).
      const saved = existing.find(c => isBusinessConnection(c) && (
        (body.editingConnectionId && c.id === body.editingConnectionId) ||
        (metaNumberId && c.meta_phone_number_id === metaNumberId)
      ));
      metaToken = saved?.instance_token?.trim() || '';
    }
    if (!metaToken || !metaNumberId) {
      return json({ error: 'Token permanente e Phone Number ID da Meta são obrigatórios' }, 400);
    }
    resolvedMetaToken = metaToken;

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
    const metaConns = existing.filter(isMetaCloudConnection);
    const samePhone = metaConns.find(c => c.meta_phone_number_id === check.phoneNumberId);
    // Form de EDIÇÃO aponta a linha exata (permite trocar o Phone Number ID
    // sem criar uma segunda conexão). Se o número digitado já é de OUTRA
    // linha da org, a dedup por número vence (atualiza aquela linha).
    const editingId = (body.editingConnectionId || '').trim();
    const editing = editingId ? metaConns.find(c => c.id === editingId) ?? null : null;
    const verifiedPhone = phoneKey(check.displayPhoneNumber);
    const sameIdentity = (c: WaConnectionRow) => Boolean(verifiedPhone && phoneKey(c.phone_number) === verifiedPhone);
    if (editing?.last_connected_at && editing.meta_phone_number_id !== check.phoneNumberId && !sameIdentity(editing)) {
      return json({ error: 'Este telefone é diferente do número original. Use “Conectar outro número” para manter as conversas separadas.' }, 409);
    }
    // Uma vaga antiga com histórico só pode ser reativada pelo mesmo telefone.
    const emptySlot = metaConns.find(c => !c.meta_phone_number_id && c.status !== 'connected'
      && (sameIdentity(c) || (!c.last_connected_at && !c.phone_number)));
    // Número JÁ conectado em OUTRA conexão da org (QR ou API): proíbe, senão o
    // chat se divide entre as duas. Editar a própria linha continua liberado.
    if (check.displayPhoneNumber) {
      const phone = `+${check.displayPhoneNumber.replace(/\D/g, '')}`;
      const own = new Set([samePhone?.id, editing?.id].filter(Boolean));
      const taken = findConnectedSameNumber(existing.filter(c => !own.has(c.id)), phone);
      if (taken) {
        return json(
          { error: `O número ${taken.phone_number} já está conectado no CRM. Desconecte a conexão atual antes de conectar de novo.` },
          409
        );
      }
    }
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
    // Fluxo da UI: cria a instância DESTA org na Evolution automaticamente,
    // sem o admin do cliente precisar saber nome/token/servidor.
    // HUB: QR também é multi. newNumber=true força OUTRA linha (sufixo
    // aleatório); sem a flag, reusa a linha QR existente (re-pareamento) ou
    // cria a primeira com o nome base (compat com as instâncias antigas).
    const qrRows = existing.filter(c => !isBusinessConnection(c));
    const base = instanceNameForOrg(auth.user.organizationId);
    instanceName = body.newNumber
      ? `${base}_qr_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
      : qrRows[0]?.instance_name ?? base;
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
  // Servidor da Evolution digitado pelo admin (modo manual): o CRM chama esse
  // endereço com a apikey, então ele precisa ser público (sem rede interna).
  if (baseUrl && baseUrl === body.baseUrl?.trim()) {
    const blocked = isPublicHttpUrl(baseUrl) ? await resolvesToPrivateAddress(baseUrl) : 'endereço não público';
    if (blocked) return json({ error: `Servidor da Evolution recusado: ${blocked}` }, 400);
  }

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
  await logSecurityEvent({
    action: 'whatsapp.connection.saved',
    actorId: auth.user.id,
    organizationId: auth.user.organizationId,
    resourceType: 'wa_connection',
    resourceId: conn.id,
    details: { provider, instance: instanceName, editing: !!body.editingConnectionId, custom_server: !!baseUrl },
    severity: 'warning',
  }, req, auth.admin);

  // Recebimento: Evolution aponta o webhook da instância; meta_cloud faz o
  // setup AUTOMÁTICO na Meta (webhook do app se tiver App Secret, assinatura
  // na WABA e callback exclusivo pro CRM).
  if (!isMetaCloudConnection(conn)) {
    await registerWebhook(conn);
  } else if (body.mode === 'meta_cloud' && metaSetup) {
    const supabaseBase = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
    const callbackUrl = `${supabaseBase}/functions/v1/whatsapp-webhook-meta/${conn.webhook_secret}`;
    const hooks = await setupMetaWebhooks({
      token: resolvedMetaToken,
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
    await observeConnection(auth.admin, conn.id, 'connected', 'manual', requestedAt, 'meta_validated', {
      phone: metaSetup.displayPhoneNumber
        ? `+${metaSetup.displayPhoneNumber.replace(/\D/g, '')}`
        : undefined,
      profileName: metaSetup.verifiedName,
    });
    return json({ connection: { ...mask(conn), status: 'connected' }, metaSetup });
  }

  // HUB: nenhuma outra conexão é derrubada implicitamente ao conectar — QR e
  // API oficial convivem em qualquer quantidade; limpeza só pelo Desconectar
  // explícito de cada linha (DELETE ?id=).

  await observeConnection(auth.admin, conn.id, 'connecting', 'manual', requestedAt, 'connect_requested');
  const checkedAt = new Date().toISOString();
  let check: Awaited<ReturnType<WhatsAppProvider['checkConnectionHealth']>>;
  try {
    check = await getProvider(conn).checkConnectionHealth();
  } catch {
    check = { state: 'unknown', reason: 'provider_unavailable' };
  }
  await observeConnection(auth.admin, conn.id, check.state, 'poll', checkedAt, check.reason);
  return json({ connection: { ...mask(conn), status: check.state }, metaSetup });
}

/**
 * Mesmo número pareado de novo (nova linha em wa_connections): as conversas presas à
 * conexão antiga passam para a nova CONECTADA, senão o chat continuaria tentando enviar
 * pela instância morta. Devolve quantas conversas mudaram (0 quando não há irmã).
 */
async function migrateConversationsToSibling(
  admin: SupabaseClient,
  orgId: string,
  conn: WaConnectionRow
): Promise<number> {
  const digits = (conn.phone_number || '').replace(/\D/g, '');
  const connected = (await getConnectionsByOrg(admin, orgId)).filter(c => c.id !== conn.id && c.status === 'connected');
  const sameNumber = digits ? connected.filter(c => (c.phone_number || '').replace(/\D/g, '') === digits) : [];
  // Mesmo número; senão a ÚNICA conexão conectada da org (número repareado ainda sem telefone
  // gravado, ou conexão antiga já sem telefone depois de desconectar)
  const target = sameNumber[0] ?? (connected.length === 1 ? connected[0] : undefined);
  if (!target) return 0;
  // Unifica em vez de só trocar a conexão: conversa do mesmo telefone que já
  // existe no destino batia na trava (org, conexão, telefone) e nada migrava.
  // 1) presas à conexão antiga; 2) órfãs (conexão excluída antes, FK SET NULL)
  // Agentes, robôs e modelos acompanham (senão ficam presos ao id que some)
  if (sameNumber[0]) await repointConnectionRefs(admin, orgId, conn.id, target.id);
  const fromConn = await mergeConnectionConversations(admin, orgId, conn.id, target.id);
  const fromOrphans = await mergeConnectionConversations(admin, orgId, null, target.id);
  return fromConn + fromOrphans;
}

export async function DELETE(req: Request) {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  // Multi-número: ?id=<connectionId> desconecta UMA conexão específica;
  // sem id, cai na conexão padrão (compat com a UI antiga de 1 número).
  // ?purge=true EXCLUI a conexão da lista de vez (linha some do hub).
  const url = new URL(req.url);
  const targetId = (url.searchParams.get('id') || '').trim();
  const purge = url.searchParams.get('purge') === 'true';
  const conn = targetId
    ? await getConnectionByIdForOrg(auth.admin, auth.user.organizationId, targetId)
    : await getConnectionByOrg(auth.admin, auth.user.organizationId);
  if (!conn) return json({ error: 'Conexão não configurada' }, 404);

  // Fecha o monitor antes do logout: o webhook de desconexão pode chegar durante a chamada.
  await observeConnection(auth.admin, conn.id, 'disconnected', 'manual', new Date().toISOString(), 'operator_disconnect');
  await logSecurityEvent({
    action: 'whatsapp.connection.removed',
    actorId: auth.user.id,
    organizationId: auth.user.organizationId,
    resourceType: 'wa_connection',
    resourceId: conn.id,
    details: { instance: conn.instance_name, excluida: purge },
    severity: 'warning',
  }, req, auth.admin);
  if (purge) {
    // EXCLUIR: derruba a instância na Evolution (quando houver) e apaga a
    // LINHA. O histórico de conversas fica (FK é SET NULL) — excluir a
    // conexão nunca apaga mensagens.
    if (!isMetaCloudConnection(conn)) {
      try {
        await getProvider(conn).logout();
      } catch {
        // best-effort: a sessão pode nem existir mais
      }
      const normalize = (u: string) => u.replace(/\/+$/, '').replace(/\/manager$/, '');
      const base = normalize(conn.base_url || '');
      if (!base || base === normalize(envEvolution().baseUrl)) {
        await deleteEvolutionInstance(conn.instance_name);
      }
    }
    const migrated = await migrateConversationsToSibling(auth.admin, auth.user.organizationId, conn);
    const { error } = await auth.admin.from('wa_connections').delete().eq('id', conn.id);
    if (error) return json({ error: `Falha ao excluir a conexão: ${error.message}` }, 500);
    return json({ ok: true, migrated });
  }

  if (isMetaCloudConnection(conn)) {
    // Modo direto: não há instância na Evolution. Só limpa as credenciais —
    // reconectar exige informar token + phone_number_id de novo.
    await auth.admin
      .from('wa_connections')
      .update({
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
      .update({ profile_name: null, instance_token: null })
      .eq('id', conn.id);
    return json({ ok: true });
  }

  // Logout best-effort: instância com sessão morta responde 500 aqui e, antes, isso travava a
  // desconexão (a conexão ficava "conectada" para sempre). O que manda é o estado no CRM.
  let logoutError: string | null = null;
  try {
    await getProvider(conn).logout();
  } catch (e) {
    logoutError = (e as Error).message;
  }
  if (logoutError) {
    // Logout recusado = sessão presa na Evolution, que seguia pareada com o
    // celular e mandando mensagens mesmo "desconectada" no CRM. Derruba a
    // instância de vez; Reconectar recria sozinha pela rota do QR.
    await tearDownEvolutionInstance(conn);
  }
  const migrated = await migrateConversationsToSibling(auth.admin, auth.user.organizationId, conn);
  // O número FICA gravado na linha: se a pessoa parear o mesmo número de novo
  // em outra conexão, a regra de número único reconhece esta linha e unifica
  // as conversas dela na nova (sem o número, o histórico ficava escondido).
  return json({ ok: true, migrated, logoutError });
}
