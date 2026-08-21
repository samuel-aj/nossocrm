/**
 * Cadastro Embutido da Meta (Embedded Signup) — conexão estilo Kommo:
 * o admin clica "Conectar com o Facebook", loga na Meta, escolhe a conta e o
 * número, e o CRM se configura sozinho (token, webhook, tudo). Nada de copiar
 * token/IDs na mão.
 *
 * GET   -> config pública pro front abrir o fluxo (appId + configId; sem segredo)
 * PATCH -> super_admin cola o Configuration ID (criado 1x no painel da Meta);
 *          fica em platform_config — sem depender de env var na Vercel
 * POST  -> { code, wabaId, phoneNumberId } vindos do fluxo:
 *          troca o code por token (server-side), valida IDs, registra o número
 *          (best-effort), grava a conexão e assina webhooks (messages + ecos).
 *
 * Credenciais do app: env META_ES_APP_ID/META_ES_APP_SECRET se existirem;
 * senão, REUSA o App ID + Chave Secreta já salvos nas conexões meta_cloud
 * (todas usam o app da casa). Configuration ID: env META_ES_CONFIG_ID ou
 * platform_config['meta_es_config_id'].
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { requireOrgUser, isOrgAdmin, json } from '@/lib/whatsapp/api';
import { upsertConnection, updateConnectionStatus } from '@/lib/whatsapp/service';
import { instanceNameForOrg } from '@/lib/whatsapp/admin';
import { setupMetaWebhooks, validateMetaCredentials } from '@/lib/whatsapp/metaCloudSetup';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { UserRole } from '@/types/constants';

const GRAPH = () => `https://graph.facebook.com/${(process.env.META_GRAPH_VERSION || 'v21.0').trim()}`;

async function resolveEsConfig(admin: SupabaseClient) {
  let appId = (process.env.META_ES_APP_ID || '').trim();
  let appSecret = (process.env.META_ES_APP_SECRET || '').trim();
  let configId = (process.env.META_ES_CONFIG_ID || '').trim();

  if (!appId || !appSecret) {
    // App OFICIAL da plataforma: fixado em platform_config (o da agência).
    // Sem isso o servidor poderia pegar um app avulso de cliente (ex.: o da
    // RCA) — a Configuration só existe no app da agência.
    const { data: fixado } = await admin
      .from('platform_config')
      .select('value')
      .eq('key', 'meta_es_app_id')
      .maybeSingle();
    const appFixado = String(fixado?.value ?? '').trim();

    let q = admin
      .from('wa_connections')
      .select('meta_app_id, meta_app_secret, last_connected_at')
      .eq('provider', 'meta_cloud')
      .not('meta_app_id', 'is', null)
      .not('meta_app_secret', 'is', null);
    if (appFixado) q = q.eq('meta_app_id', appFixado);
    const { data } = await q
      .order('last_connected_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    // O app FIXADO vale por si só (a conexão que o fornecia pode ter sido
    // excluída): sem linha correspondente, o id continua sendo o fixado e a
    // secret vem de platform_config (bloco abaixo).
    appId = appId || String(data?.meta_app_id ?? '').trim() || appFixado;
    appSecret = appSecret || String(data?.meta_app_secret ?? '').trim();
  }

  if (!configId) {
    const { data } = await admin
      .from('platform_config')
      .select('value')
      .eq('key', 'meta_es_config_id')
      .maybeSingle();
    configId = String(data?.value ?? '').trim();
  }

  // Chave secreta com CASA PRÓPRIA: se não veio de env nem de conexão (a
  // conexão que a guardava pode ser excluída, como aconteceu com a da AJ),
  // vem de platform_config — colada 1x pelo super_admin na tela.
  if (!appSecret) {
    const { data } = await admin
      .from('platform_config')
      .select('value')
      .eq('key', 'meta_es_app_secret')
      .maybeSingle();
    appSecret = String(data?.value ?? '').trim();
  }

  return { appId, appSecret, configId };
}

export async function GET() {
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const { appId, appSecret, configId } = await resolveEsConfig(auth.admin);
  return json({
    configured: Boolean(appId && appSecret && configId),
    // Sem o configId falta SÓ o passo do painel da Meta: a UI mostra o campo
    // de colar o ID pro super_admin quando temAppSalvo é true.
    temAppSalvo: Boolean(appId && appSecret),
    appId: appId || null,
    configId: configId || null,
    // Falta SÓ a chave secreta do app (a conexão que a guardava foi excluída):
    // a UI mostra o campo de colar pro super_admin.
    faltaSecret: Boolean(appId && !appSecret),
    graphVersion: (process.env.META_GRAPH_VERSION || 'v21.0').trim(),
  });
}

export async function PATCH(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (auth.user.role !== UserRole.SUPER_ADMIN) return json({ error: 'Forbidden' }, 403);

  const body = (await req.json().catch(() => null)) as { configId?: string; appSecret?: string } | null;
  const configId = (body?.configId || '').trim().replace(/\D/g, '');
  const appSecret = (body?.appSecret || '').trim();
  if (!configId && !appSecret) {
    return json({ error: 'Informe o Configuration ID e/ou a Chave Secreta do app.' }, 400);
  }

  const now = new Date().toISOString();
  if (configId) {
    const up = await auth.admin
      .from('platform_config')
      .upsert({ key: 'meta_es_config_id', value: configId, updated_at: now });
    if (up.error) return json({ error: up.error.message }, 500);
  }
  if (appSecret) {
    if (!/^[a-f0-9]{20,64}$/i.test(appSecret)) {
      return json({ error: 'Chave Secreta com formato inesperado (copie do painel da Meta, Configurações > Básico).' }, 400);
    }
    const up = await auth.admin
      .from('platform_config')
      .upsert({ key: 'meta_es_app_secret', value: appSecret, updated_at: now });
    if (up.error) return json({ error: up.error.message }, 500);
  }
  return json({ ok: true });
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);

  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  if (!isOrgAdmin(auth.user.role)) return json({ error: 'Forbidden' }, 403);

  const { appId, appSecret, configId } = await resolveEsConfig(auth.admin);
  if (!appId || !appSecret || !configId) {
    return json({ error: 'Cadastro embutido não configurado.' }, 400);
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
  // Número JÁ conectado nesta org: reusa a linha (atualiza token/webhook) em
  // vez de criar um cartão duplicado.
  const { data: jaExiste } = await auth.admin
    .from('wa_connections')
    .select('instance_name')
    .eq('organization_id', orgId)
    .eq('provider', 'meta_cloud')
    .eq('meta_phone_number_id', check.phoneNumberId)
    .limit(1)
    .maybeSingle();
  const instanceName =
    (jaExiste?.instance_name as string | undefined) ??
    `${base}_cloud_${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;

  let conn;
  try {
    conn = await upsertConnection(auth.admin, orgId, {
      instanceName,
      token: businessToken,
      // Marcador: conexão criada pelo Cadastro Embutido -> o token (60 dias)
      // é RENOVADO automaticamente pela autocura do webhook.
      baseUrl: 'embedded_signup',
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
