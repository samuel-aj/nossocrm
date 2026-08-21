/**
 * Cadastro Embutido da Meta (Embedded Signup) — conexão estilo Kommo:
 * o admin clica "Conectar com o Facebook", loga na Meta, escolhe a conta e o
 * número, e o CRM se configura sozinho (token, webhook, tudo). Nada de copiar
 * token/IDs na mão.
 *
 * GET  -> config pública pro front abrir o fluxo (appId + configId; sem segredo)
 * POST -> { code, wabaId, phoneNumberId } vindos do fluxo:
 *         1. troca o code por um token de negócio (server-side, com o segredo);
 *         2. valida os IDs e descobre o número exibido;
 *         3. registra o número na Cloud API (best-effort; coexistência já vem
 *            registrada) e assina os webhooks (messages + ecos, com fallback);
 *         4. grava a conexão da org — pronta pra enviar e receber.
 *
 * Requer no ambiente (Vercel): META_ES_APP_ID, META_ES_APP_SECRET,
 * META_ES_CONFIG_ID. Sem eles o GET devolve configured:false e a UI esconde o
 * botão (o caminho manual continua existindo).
 */
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import { upsertConnection, updateConnectionStatus } from '@/lib/whatsapp/service';
import { instanceNameForOrg } from '@/lib/whatsapp/admin';
import { setupMetaWebhooks, validateMetaCredentials } from '@/lib/whatsapp/metaCloudSetup';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

const GRAPH = () => `https://graph.facebook.com/${(process.env.META_GRAPH_VERSION || 'v21.0').trim()}`;

const esConfig = () => ({
  appId: (process.env.META_ES_APP_ID || '').trim(),
  appSecret: (process.env.META_ES_APP_SECRET || '').trim(),
  configId: (process.env.META_ES_CONFIG_ID || '').trim(),
});

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const { appId, appSecret, configId } = esConfig();
  return json({
    configured: Boolean(appId && appSecret && configId),
    appId: appId || null,
    configId: configId || null,
    graphVersion: (process.env.META_GRAPH_VERSION || 'v21.0').trim(),
  });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  const { appId, appSecret, configId } = esConfig();
  if (!appId || !appSecret || !configId) {
    return json({ error: 'Cadastro embutido não configurado no servidor.' }, 400);
  }

  const body = (await req.json().catch(() => null)) as {
    code?: string;
    wabaId?: string;
    phoneNumberId?: string;
  } | null;
  const code = (body?.code || '').trim();
  const wabaId = (body?.wabaId || '').trim().replace(/\D/g, '');
  const phoneNumberId = (body?.phoneNumberId || '').trim().replace(/\D/g, '');
  if (!code || !wabaId || !phoneNumberId) {
    return json({ error: 'Fluxo incompleto: faltou code, conta (WABA) ou número.' }, 400);
  }

  // 1) code -> token de negócio (o code expira em ~30s: nada de retries lentos)
  const tokenRes = await fetch(
    `${GRAPH()}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(
      appSecret
    )}&code=${encodeURIComponent(code)}`,
    { cache: 'no-store' }
  );
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    error?: { message?: string };
  };
  const businessToken = tokenJson.access_token;
  if (!businessToken) {
    console.error('[embedded-signup] troca de code falhou:', tokenJson.error?.message);
    return json(
      { error: `A Meta recusou a autorização: ${tokenJson.error?.message || 'token não veio'}. Tente de novo.` },
      502
    );
  }

  // 2) valida os IDs com o token novo e descobre o número exibido
  const check = await validateMetaCredentials(businessToken, phoneNumberId, wabaId);
  if (!check.ok) {
    return json({ error: check.error || 'A Meta não reconheceu o número autorizado.' }, 502);
  }

  // 3) registro na Cloud API (números novos exigem; coexistência já vem
  //    registrada e responde erro inofensivo — por isso best-effort)
  const reg = await fetch(`${GRAPH()}/${encodeURIComponent(check.phoneNumberId!)}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${businessToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', pin: '000000' }),
    cache: 'no-store',
  }).then(r => r.json()).catch(e => ({ error: { message: String(e) } }));
  if ((reg as { error?: { message?: string } }).error) {
    console.log('[embedded-signup] register (ok falhar em coexistência):', (reg as { error?: { message?: string } }).error?.message);
  }

  // 4) grava a conexão (mesma convenção de nomes do fluxo manual) e assina os
  //    webhooks — inclusive os ECOS (mensagens enviadas por fora)
  const orgId = auth.user.organizationId;
  const base = instanceNameForOrg(orgId);
  const instanceName = `${base}_cloud_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;

  let conn;
  try {
    conn = await upsertConnection(auth.admin, orgId, {
      instanceName,
      token: businessToken,
      baseUrl: null,
      provider: 'meta_cloud',
      phoneNumberId: check.phoneNumberId,
      wabaId: check.wabaId || wabaId,
      appId,
      appSecret,
    });
  } catch (e) {
    return json({ error: `Falha ao salvar a conexão: ${(e as Error).message}` }, 500);
  }

  const supabaseBase = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const callbackUrl = `${supabaseBase}/functions/v1/whatsapp-webhook-meta/${conn.webhook_secret}`;
  const hooks = await setupMetaWebhooks({
    token: businessToken,
    wabaId: check.wabaId || wabaId,
    appId,
    appSecret,
    callbackUrl,
    verifyToken: conn.webhook_secret,
  });

  await updateConnectionStatus(auth.admin, conn.id, {
    status: 'connected',
    phone_number: check.displayPhoneNumber
      ? `+${check.displayPhoneNumber.replace(/\D/g, '')}`
      : undefined,
    profile_name: check.verifiedName || undefined,
  });

  return json({
    ok: true,
    numero: check.displayPhoneNumber || null,
    nome: check.verifiedName || null,
    recebimentoOk: hooks.override || hooks.appWebhook === 'ok',
    avisoWebhook: hooks.appWebhookError || hooks.overrideError || null,
  });
}
