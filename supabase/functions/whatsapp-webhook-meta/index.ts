/**
 * Webhook de entrada do WhatsApp — MODO DIRETO (WhatsApp Cloud API da Meta),
 * SEM Evolution.
 *
 * Rota (Supabase Edge Function, pública):
 *   GET/POST /functions/v1/whatsapp-webhook-meta/<webhook_secret>
 *
 * A Meta manda o webhook DIRETO pra cá (o admin cola esta URL + o verify token
 * no painel do app da Meta). Cada org tem seu próprio app/URL com o secret no
 * path — o secret é o gate (a função roda com service role).
 *
 * - GET  = verificação da Meta (hub.mode/hub.verify_token/hub.challenge).
 * - POST = eventos: entry[].changes[].value.{messages,statuses,contacts,metadata}.
 *
 * Formato da Cloud API != Evolution: telefones vêm como wa_id (dígitos) e a
 * mídia vem por media-id (baixa via Graph).
 *
 * ECOS: com o campo `message_echoes` assinado, a Meta também avisa o que ESTE
 * número enviou fora do CRM (celular, WhatsApp Web, outra ferramenta). Esses
 * eventos entram como mensagem enviada (direction "out"); a dedup por
 * evolution_message_id evita duplicar o que o próprio CRM já gravou ao enviar.
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH_VERSION = Deno.env.get("META_GRAPH_VERSION") ?? "v21.0";

// AUTO-CURA da assinatura: última cura por conexão nesta instância. Repete a
// cada CURA_TTL_MS — se outro sistema "rouba" o webhook (ex.: outro CRM
// configurado com o mesmo app/WABA), o CRM retoma sozinho em minutos. O ping
// periódico chega pelo pg_cron em POST /whatsapp-webhook-meta/heal-all.
const CURA_TTL_MS = 10 * 60 * 1000;
const RENOVACAO_TTL_MS = 24 * 60 * 60 * 1000;
// Atalho local; a trava de verdade é wa_connections.last_webhook_heal_at
// (compartilhada entre TODAS as instâncias da função).
const ultimaCura = new Map<string, number>();

// deno-lint-ignore no-explicit-any
type ConnRow = any;

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Reaplica a assinatura do webhook desta conexão na Meta (app + override da
 * WABA) e renova o token do Cadastro Embutido (1x/dia). Idempotente.
 */
// deno-lint-ignore no-explicit-any
async function curarConexao(supabase: any, supabaseUrl: string, conn: ConnRow): Promise<void> {
  const token = String(conn.instance_token ?? "");
  const base = supabaseUrl.replace(/\/+$/, "");
  const cb = `${base}/functions/v1/whatsapp-webhook-meta/${conn.webhook_secret}`;
  const nossoPrefixo = `${base}/functions/v1/whatsapp-webhook-meta/`;
  const { data: full } = await supabase
    .from("wa_connections")
    .select("meta_app_id, meta_app_secret, meta_waba_id, token_renewed_at")
    .eq("id", conn.id)
    .maybeSingle();
  const appId = String(full?.meta_app_id ?? "").trim();
  const appSecret = String(full?.meta_app_secret ?? "").trim();
  const wabaId = String(full?.meta_waba_id ?? "").trim();
  if (appId && appSecret) {
    const appToken = `${appId}|${appSecret}`;
    const atual = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${appId}/subscriptions?access_token=${encodeURIComponent(appToken)}`,
    ).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    const sub = Array.isArray(atual?.data)
      ? atual.data.find((d: { object?: string }) => d?.object === "whatsapp_business_account")
      : null;
    const camposAtuais: string[] = Array.isArray(sub?.fields)
      ? sub.fields.map((f: { name?: string }) => String(f?.name ?? ""))
      : [];
    const jaNosso = typeof sub?.callback_url === "string" && sub.callback_url.startsWith(nossoPrefixo) &&
      camposAtuais.includes("messages") &&
      (camposAtuais.includes("smb_message_echoes") || camposAtuais.includes("message_echoes"));
    console.log(
      `[wa-meta-cura] conn=${conn.id} app_callback=${String(sub?.callback_url ?? "").slice(0, 120)} campos=${camposAtuais.join(",")} ok=${jaNosso}${
        sub ? "" : ` resposta=${JSON.stringify(atual).slice(0, 200)}`
      }`,
    );
    // Só reescreve o webhook do APP quando ele NÃO aponta pro CRM (ou perdeu
    // campos): o app é compartilhado por todos os números; o roteamento por
    // número é o override da WABA, logo abaixo.
    if (!jaNosso) {
      for (
        const fields of [
          "messages,message_echoes,smb_message_echoes",
          "messages,smb_message_echoes",
          "messages,message_echoes",
        ]
      ) {
        const r = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${appId}/subscriptions`, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            object: "whatsapp_business_account",
            callback_url: cb,
            verify_token: String(conn.webhook_secret),
            fields,
            access_token: appToken,
          }).toString(),
        }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
        const ok = r?.success === true;
        console.log(
          `[wa-meta-cura] conn=${conn.id} assinar[${fields}] => ${ok ? "OK" : JSON.stringify(r?.error?.message ?? r).slice(0, 300)}`,
        );
        if (ok) break;
      }
    }
  } else {
    console.log(`[wa-meta-cura] conn=${conn.id} sem app_id/app_secret salvos`);
  }
  if (wabaId && token) {
    // Override da WABA: é ISSO que garante que os eventos DESTE número chegam
    // aqui, mesmo que outro sistema tenha mexido no app.
    const ov = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/subscribed_apps`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        override_callback_uri: cb,
        verify_token: String(conn.webhook_secret),
        access_token: token,
      }).toString(),
    }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    console.log(`[wa-meta-cura] conn=${conn.id} override => ${JSON.stringify(ov).slice(0, 300)}`);
  }
  // RENOVAÇÃO do token (só Cadastro Embutido, token de 60 dias): 1x por dia,
  // controlada no banco (token_renewed_at), não na memória da instância.
  const agora = Date.now();
  const renovadoEm = full?.token_renewed_at ? Date.parse(String(full.token_renewed_at)) : 0;
  if (
    String(conn.base_url ?? "") === "embedded_signup" && appId && appSecret && token &&
    (!renovadoEm || renovadoEm < agora - RENOVACAO_TTL_MS)
  ) {
    const ren = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&fb_exchange_token=${encodeURIComponent(token)}`,
    ).then((r) => r.json()).catch((e) => ({ error: { message: String(e) } }));
    const novoTok = (ren as { access_token?: string }).access_token;
    if (novoTok && novoTok !== token) {
      const up = await supabase
        .from("wa_connections")
        .update({ instance_token: novoTok, token_renewed_at: new Date(agora).toISOString() })
        .eq("id", conn.id);
      console.log(`[wa-meta-cura] conn=${conn.id} token renovado => ${up.error ? up.error.message : "OK"}`);
    } else if ((ren as { error?: { message?: string } }).error) {
      console.log(`[wa-meta-cura] conn=${conn.id} renovacao falhou => ${(ren as { error?: { message?: string } }).error?.message}`);
    }
  }
}

/**
 * Agenda a cura em background se a última desta conexão já passou do TTL.
 * A trava é a linha no banco: só a instância que "pegar" a atualização
 * (última cura há mais de CURA_TTL) roda — várias instâncias em paralelo
 * (rajada de webhooks) não bombardeiam a Graph API (#80008).
 */
// deno-lint-ignore no-explicit-any
async function agendarCura(supabase: any, supabaseUrl: string, conn: ConnRow): Promise<boolean> {
  const agora = Date.now();
  if ((ultimaCura.get(conn.id) ?? 0) > agora - CURA_TTL_MS) return false;
  // RPC (UPDATE ... RETURNING atômico): o PATCH do PostgREST com filtro `or`
  // dá 42703 nessa coluna, por isso a trava vive numa função SQL.
  const { data: pegou, error } = await supabase.rpc("wa_claim_heal", {
    p_connection_id: conn.id,
    p_ttl_seconds: Math.floor(CURA_TTL_MS / 1000),
  });
  if (error) {
    console.error(`[wa-meta-cura] conn=${conn.id} trava falhou: ${error.message}`);
    return false;
  }
  if (pegou !== true) return false;
  // só marca localmente quando a trava foi obtida (falha no banco tenta de novo)
  ultimaCura.set(conn.id, agora);
  const p = curarConexao(supabase, supabaseUrl, conn).catch((e) => console.error("[wa-meta-cura] falhou:", e));
  try {
    // @ts-ignore: EdgeRuntime existe no runtime das Edge Functions da Supabase
    EdgeRuntime.waitUntil(p);
  } catch {
    void p;
  }
  return true;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function getSecretFromPath(req: Request): string | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = parts.findIndex((p) => p === "whatsapp-webhook-meta");
  if (idx === -1) return null;
  return parts[idx + 1] ?? null;
}

/** wa_id (só dígitos) -> E.164 (+55...). */
function waIdToE164(waId?: string): string {
  const digits = String(waId ?? "").replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

/** Variantes do nono dígito BR (espelho de brPhoneVariants em lib/phone.ts). */
function brPhoneVariants(e164: string): string[] {
  if (!e164) return [];
  const m = e164.match(/^\+55(\d{2})(\d{8,9})$/);
  if (!m) return [e164];
  const ddd = m[1];
  const local = m[2];
  if (local.length === 9 && local.startsWith("9") && /^[6-9]/.test(local[1])) {
    return [e164, `+55${ddd}${local.slice(1)}`];
  }
  if (local.length === 8 && /^[6-9]/.test(local)) {
    return [e164, `+55${ddd}9${local}`];
  }
  return [e164];
}

function extFromMime(mime?: string, fileName?: string): string {
  const m = (mime ?? "").split(";")[0].trim().toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/amr": "amr",
    "audio/wav": "wav",
    "application/pdf": "pdf",
  };
  if (map[m]) return map[m];
  const fromName = (fileName ?? "").split(".").pop();
  if (fromName && fromName.length <= 5 && /^[a-zA-Z0-9]+$/.test(fromName)) return fromName.toLowerCase();
  return "bin";
}

/** Extrai texto/mídia de uma mensagem no formato Cloud API. */
// deno-lint-ignore no-explicit-any
function extractContent(m: any): {
  text?: string;
  mediaType?: string;
  mediaId?: string;
  mediaMime?: string;
  fileName?: string;
  skip?: boolean;
} {
  const type = String(m?.type ?? "");
  switch (type) {
    case "text":
      return { text: m.text?.body };
    case "image":
      return { mediaType: "image", mediaId: m.image?.id, mediaMime: m.image?.mime_type, text: m.image?.caption };
    case "video":
      return { mediaType: "video", mediaId: m.video?.id, mediaMime: m.video?.mime_type, text: m.video?.caption };
    case "audio":
      return { mediaType: "audio", mediaId: m.audio?.id, mediaMime: m.audio?.mime_type };
    case "voice":
      return { mediaType: "audio", mediaId: m.voice?.id, mediaMime: m.voice?.mime_type };
    case "sticker":
      return { mediaType: "sticker", mediaId: m.sticker?.id, mediaMime: m.sticker?.mime_type };
    case "document":
      return {
        mediaType: "document",
        mediaId: m.document?.id,
        mediaMime: m.document?.mime_type,
        fileName: m.document?.filename,
        text: m.document?.caption,
      };
    case "location": {
      const loc = m.location ?? {};
      const label = loc.name || loc.address || "Localização";
      if (loc.latitude === undefined) return {};
      return { text: `📍 ${label}\nhttps://maps.google.com/?q=${loc.latitude},${loc.longitude}` };
    }
    case "contacts": {
      const rows = (m.contacts ?? []).map((c: { name?: { formatted_name?: string }; phones?: Array<{ phone?: string }> }) => {
        const name = c.name?.formatted_name || "sem nome";
        const phone = c.phones?.[0]?.phone || "";
        return `${name}${phone ? ` — ${phone}` : ""}`;
      });
      return { text: `👤 Contatos compartilhados:\n${rows.join("\n")}` };
    }
    case "button":
      return { text: m.button?.text };
    case "interactive": {
      const it = m.interactive ?? {};
      const label = it.button_reply?.title ?? it.list_reply?.title ?? it.nfm_reply?.body;
      return label ? { text: String(label) } : {};
    }
    case "reaction":
    case "system":
      // Reação/evento de protocolo: não é "mensagem", não gera bolha.
      return { skip: true };
    case "unsupported":
      // Enquete, evento e afins: a Cloud API não entrega o conteúdo, mas a
      // mensagem EXISTE — melhor uma bolha avisando do que sumir em silêncio.
      return { text: "⚠️ O contato enviou um conteúdo que a API do WhatsApp não entrega (ex.: enquete ou evento). Abra o WhatsApp do número pra ver." };
    case "order":
      return { text: "🛒 O contato enviou um pedido de catálogo (não suportado aqui)." };
    default:
      return { text: `[mensagem do tipo "${type}" não suportada]` };
  }
}

/** Baixa a mídia da Cloud API por media-id (2 passos: metadata -> bytes). */
async function downloadMetaMedia(
  mediaId: string,
  token: string
): Promise<{ bytes: Uint8Array; mime?: string } | null> {
  try {
    const metaRes = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!metaRes.ok) return null;
    const meta = await metaRes.json();
    if (!meta?.url) return null;
    const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${token}` } });
    if (!binRes.ok) return null;
    const bytes = new Uint8Array(await binRes.arrayBuffer());
    return bytes.length > 0 ? { bytes, mime: meta.mime_type } : null;
  } catch {
    return null;
  }
}

/**
 * Processa os eventos do payload PARA UMA conexão (org): mensagens, ecos,
 * statuses e mídia, cada um no chat da org dona da conexão.
 */
// deno-lint-ignore no-explicit-any
async function processarEventos(supabase: any, conn: ConnRow, payload: any): Promise<void> {
  const orgId = conn.organization_id as string;
  const token = String(conn.instance_token ?? "");

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value ?? {};
      const metadata = value?.metadata ?? {};

      // INSTRUMENTAÇÃO (diagnóstico dos ecos): registra o tipo de evento e o
      // formato, pra sabermos com certeza o que a Meta entrega a este app.
      // Barato (uma linha por evento) e visível nos logs da função.
      try {
        const temEcho = Array.isArray(value?.message_echoes) || Array.isArray(value?.smb_message_echoes);
        const nMsgs = Array.isArray(value?.messages) ? value.messages.length : 0;
        const froms = (Array.isArray(value?.messages) ? value.messages : [])
          .map((m: { from?: string }) => m?.from)
          .filter(Boolean)
          .slice(0, 3);
        console.log(
          `[wa-meta-diag] field=${change?.field ?? '?'} echoes=${temEcho} msgs=${nMsgs} statuses=${
            Array.isArray(value?.statuses) ? value.statuses.length : 0
          } display=${metadata?.display_phone_number ?? '?'} froms=${froms.join(',')}`
        );
      } catch { /* diagnóstico nunca derruba o webhook */ }

      // Preenche o número da conexão a partir do metadata (a 1ª vez que chega
      // evento já popula o phone_number que nasce nulo). Só grava quando MUDA —
      // a Meta manda metadata em TODO evento (inclusive recibos), não faz sentido
      // um write por evento.
      const displayPhone = waIdToE164(metadata?.display_phone_number);
      if (displayPhone && (conn.phone_number !== displayPhone || conn.status !== "connected")) {
        await supabase
          .from("wa_connections")
          .update({
            phone_number: displayPhone,
            status: "connected",
            last_connected_at: new Date().toISOString(),
          })
          .eq("id", conn.id);
        conn.phone_number = displayPhone;
        conn.status = "connected";
      }

      // --- Status de entrega/leitura (✓✓) das mensagens que NÓS enviamos ---
      const statuses = Array.isArray(value?.statuses) ? value.statuses : [];
      const statusMap: Record<string, string> = {
        sent: "sent",
        delivered: "delivered",
        read: "read",
        failed: "failed",
      };
      const lowerThan: Record<string, string[]> = {
        sent: ["queued"],
        delivered: ["queued", "sent"],
        read: ["queued", "sent", "delivered"],
        failed: ["queued", "sent", "delivered"],
      };
      for (const st of statuses) {
        const id = st?.id;
        const status = statusMap[String(st?.status ?? "").toLowerCase()];
        if (!id || !status) continue;
        // Recibo de FALHA vem com o motivo (errors[]): persiste no registro da
        // mensagem pro chat mostrar POR QUE não entregou (ex.: fora da janela
        // de 24h, portfólio restrito), e loga pra diagnóstico.
        let errText: string | null = null;
        if (status === "failed" && Array.isArray(st?.errors) && st.errors.length > 0) {
          errText = st.errors
            // deno-lint-ignore no-explicit-any
            .map((e: any) =>
              [e?.code, e?.title, e?.message !== e?.title ? e?.message : null, e?.error_data?.details]
                .filter(Boolean)
                .join(" — ")
            )
            .join(" | ")
            .slice(0, 800);
          console.error("[wa-webhook-meta] status failed:", id, errText);
        }
        await supabase
          .from("wa_messages")
          .update({ status, ...(errText ? { error: errText } : {}) })
          .eq("organization_id", orgId)
          .eq("evolution_message_id", id)
          .in("status", lowerThan[status] ?? []);
      }

      // --- Mensagens recebidas + ECOS (o que ESTE número enviou por fora) ---
      const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
      const nameByWaId: Record<string, string> = {};
      for (const c of contacts) {
        if (c?.wa_id) nameByWaId[String(c.wa_id)] = c?.profile?.name ?? "";
      }

      // message_echoes = mensagens que ESTE número enviou em outro lugar
      // (celular, WhatsApp Web, outra ferramenta). Mesmo formato de `messages`,
      // mas o interlocutor está em `to` em vez de `from` — por isso a marca
      // `isEcho`, que inverte direção e telefones na hora de gravar.
      // A Meta entrega os ecos em value.message_echoes; por robustez, aceita
      // também value.smb_message_echoes (nome do CAMPO assinado pros envios
      // feitos pelo app do WhatsApp Business no celular).
      const echoes = [
        ...(Array.isArray(value?.message_echoes) ? value.message_echoes : []),
        ...(Array.isArray(value?.smb_message_echoes) ? value.smb_message_echoes : []),
      ];
      // deno-lint-ignore no-explicit-any
      const inbound = (Array.isArray(value?.messages) ? value.messages : []).map((m: any) => ({ m, isEcho: false }));
      // deno-lint-ignore no-explicit-any
      const outbound = echoes.map((m: any) => ({ m, isEcho: true }));
      // Número da própria conexão (só dígitos), pra reconhecer eco disfarçado:
      // alguns fluxos da Meta entregam o que o número ENVIOU dentro de
      // value.messages com from = o próprio número.
      const digitosConexao = String(metadata?.display_phone_number ?? conn.phone_number ?? "").replace(/\D/g, "");

      for (const item of [...inbound, ...outbound]) {
        const m = item.m;
        if (!m) continue;
        const fromDigits = String(m.from ?? "").replace(/\D/g, "");
        const isEcho = item.isEcho || (!!digitosConexao && fromDigits === digitosConexao);
        const providerId = m.id;
        // No eco quem interessa é o destinatário (`to`); na recebida, o remetente.
        const phone = waIdToE164(isEcho ? m.to : m.from);
        if (!providerId || !phone) continue;

        const { text, mediaType, mediaId, mediaMime, fileName, skip } = extractContent(m);
        if (skip) continue;
        // RESPONDER/ENCAMINHAR: a Cloud API manda `context` { from, id,
        // forwarded, frequently_forwarded } quando a mensagem cita outra ou
        // foi encaminhada (só o id da citada; o conteúdo vem do nosso banco).
        const ctxQuotedId = typeof m.context?.id === "string" ? m.context.id : "";
        const ctxFrom = waIdToE164(m.context?.from);
        const forwarded = !!(m.context?.forwarded || m.context?.frequently_forwarded);
        const tsNum = typeof m.timestamp === "string" ? parseInt(m.timestamp, 10) : m.timestamp;
        const waTs = tsNum ? new Date(tsNum * 1000).toISOString() : new Date().toISOString();
        const pushName = isEcho ? null : nameByWaId[String(m.from)] || null;

        // Conversa POR NÚMERO CONECTADO (cada número é um "WhatsApp" próprio):
        // 1) conversa desta conexão; 2) reivindica uma órfã (connection_id
        // NULL, era pré multi-número ou conexão excluída); 3) cria; 4) se o
        // insert conflitar, relê — primeiro por conexão e, enquanto a trava
        // antiga (org+telefone) existir no banco, cai na conversa única da org
        // (comportamento antigo até a migração rodar).
        const variants = brPhoneVariants(phone);
        let convId: string | null = null;
        const { data: convList } = await supabase
          .from("wa_conversations")
          .select("id, contact_id")
          .eq("organization_id", orgId)
          .eq("connection_id", conn.id)
          .in("wa_phone", variants);
        const conv = (convList ?? []).find((c) => c.contact_id) ?? (convList ?? [])[0];
        if (conv) {
          convId = conv.id;
        }
        if (!convId) {
          const { data: orfas } = await supabase
            .from("wa_conversations")
            .select("id, contact_id")
            .eq("organization_id", orgId)
            .is("connection_id", null)
            .in("wa_phone", variants);
          // preferir a órfã LIGADA a contato (carrega o histórico certo)
          const orfa = (orfas ?? []).find((o) => o.contact_id) ?? (orfas ?? [])[0];
          if (orfa?.id) {
            const { data: claimed } = await supabase
              .from("wa_conversations")
              .update({ connection_id: conn.id })
              .eq("id", orfa.id)
              .is("connection_id", null)
              .select("id")
              .maybeSingle();
            if (claimed?.id) convId = claimed.id;
          }
        }
        if (!convId) {
          const { data: contact } = await supabase
            .from("contacts")
            .select("id")
            .eq("organization_id", orgId)
            .in("phone", variants)
            .limit(1)
            .maybeSingle();
          const { data: created, error: convErr } = await supabase
            .from("wa_conversations")
            .insert({
              organization_id: orgId,
              connection_id: conn.id,
              contact_id: contact?.id ?? null,
              wa_phone: phone,
              wa_name: pushName,
            })
            .select("id")
            .single();
          if (created?.id) {
            convId = created.id;
          } else if (convErr) {
            // Corrida com outra entrega, ou trava antiga org+telefone ainda
            // ativa. Relê por conexão; senão, usa a conversa única da org.
            const { data: again } = await supabase
              .from("wa_conversations")
              .select("id")
              .eq("organization_id", orgId)
              .eq("connection_id", conn.id)
              .in("wa_phone", variants)
              .limit(1)
              .maybeSingle();
            convId = again?.id ?? null;
            if (!convId && String(convErr.message).includes("uq_wa_conversations_org_phone")) {
              // Trava ANTIGA (org+telefone) ainda no banco: cai na conversa
              // única da org (comportamento antigo até a migração rodar).
              const { data: qualquer } = await supabase
                .from("wa_conversations")
                .select("id")
                .eq("organization_id", orgId)
                .in("wa_phone", variants)
                .limit(1)
                .maybeSingle();
              convId = qualquer?.id ?? null;
            }
          }
        }
        if (!convId) continue;

        // idempotência: se já temos essa mensagem (reentrega da Meta), pula.
        const { data: existingMsg } = await supabase
          .from("wa_messages")
          .select("id")
          .eq("organization_id", orgId)
          .eq("evolution_message_id", providerId)
          .maybeSingle();
        if (existingMsg) continue;

        // Mídia: baixa por media-id na Graph API e sobe pro Storage privado.
        let mediaPath: string | null = null;
        let mediaMimeFinal = mediaMime ?? null;
        if (mediaId && token) {
          const dl = await downloadMetaMedia(mediaId, token);
          if (dl) {
            if (dl.mime) mediaMimeFinal = dl.mime;
            const ext = extFromMime(mediaMimeFinal ?? undefined, fileName);
            const safeId = String(providerId).replace(/[^a-zA-Z0-9_-]/g, "");
            const path = `${orgId}/${convId}/${safeId}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from("wa-media")
              .upload(path, dl.bytes, {
                contentType: mediaMimeFinal ?? "application/octet-stream",
                upsert: true,
              });
            if (!upErr) mediaPath = path;
            else console.error("[wa-webhook-meta] upload:", upErr.message);
          }
        }

        // RESPONDER: liga à mensagem citada quando ela está no CRM; senão
        // guarda só o id e de quem era (a Meta não manda o conteúdo).
        let quotedMessageId: string | null = null;
        let quotedSnapshot: Record<string, unknown> | null = null;
        if (ctxQuotedId) {
          const { data: orig } = await supabase
            .from("wa_messages")
            .select("id, body, media_type, direction")
            .eq("organization_id", orgId)
            .eq("evolution_message_id", ctxQuotedId)
            .maybeSingle();
          if (orig) {
            quotedMessageId = orig.id;
            quotedSnapshot = {
              provider_id: ctxQuotedId,
              body: orig.body ?? null,
              media_type: orig.media_type ?? null,
              direction: orig.direction ?? null,
            };
          } else {
            const own = digitosConexao ? `+${digitosConexao}` : "";
            const direction = own && ctxFrom ? (brPhoneVariants(own).includes(ctxFrom) ? "out" : "in") : null;
            quotedSnapshot = { provider_id: ctxQuotedId, body: null, media_type: null, direction };
          }
        }

        const baseRow = {
          organization_id: orgId,
          conversation_id: convId,
          direction: isEcho ? "out" : "in",
          status: isEcho ? "sent" : "received",
          body: text ?? null,
          media_type: mediaType ?? null,
          media_mime: mediaMimeFinal,
          media_url: mediaPath,
          evolution_message_id: providerId,
          from_phone: isEcho ? null : phone,
          to_phone: isEcho ? phone : null,
          wa_timestamp: waTs,
          // webhook de saída: echo = enviada por fora (celular/Kommo)
          source: isEcho ? "echo" : "inbound",
        };
        let { error: insErr } = await supabase.from("wa_messages").insert({
          ...baseRow,
          quoted_message_id: quotedMessageId,
          quoted: quotedSnapshot,
          forwarded,
        });
        // Banco ainda sem as colunas de responder/encaminhar (migração pendente):
        // grava sem elas em vez de perder a mensagem.
        if (insErr && /column/i.test(String(insErr.message)) && /quoted|forwarded/i.test(String(insErr.message))) {
          console.error("[wa-webhook-meta] colunas de responder/encaminhar ausentes; gravando sem elas");
          ({ error: insErr } = await supabase.from("wa_messages").insert(baseRow));
        }
        const dup = insErr && String(insErr.message).toLowerCase().includes("duplicate");
        if (insErr && !dup) {
          console.error("[wa-webhook-meta] insert:", insErr.message);
          continue;
        }
        if (dup) continue;

        const preview = text ? text.slice(0, 140) : mediaType ? `[${mediaType}]` : "";
        await supabase
          .from("wa_conversations")
          .update({ last_message_at: waTs, last_message_preview: preview })
          .eq("id", convId);

        // Eco é mensagem NOSSA: não conta como não lida (e, se a pessoa
        // respondeu pelo celular, zera o contador — ela já viu a conversa).
        if (isEcho) {
          await supabase.from("wa_conversations").update({ unread_count: 0 }).eq("id", convId);
        } else {
          await supabase.rpc("wa_increment_unread", { p_conversation_id: convId });
        }
      }
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("CRM_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("CRM_SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Supabase não configurado no runtime" });
  const supabase = createClient(supabaseUrl, serviceKey);

  const pathSecret = getSecretFromPath(req);
  if (!pathSecret) return json(404, { error: "sem secret" });

  // Ping do pg_cron (a cada 10 min): reaplica o webhook de todos os números
  // da API oficial. Sem segredo na URL — é idempotente e limitado pelo TTL.
  if (pathSecret === "heal-all") {
    const { data: conns } = await supabase
      .from("wa_connections")
      .select("id, organization_id, webhook_secret, instance_token, provider, meta_phone_number_id, phone_number, status, base_url")
      .eq("provider", "meta_cloud")
      .eq("status", "connected");
    let agendadas = 0;
    for (const c of conns ?? []) {
      if (!c.instance_token || !c.webhook_secret) continue;
      if (await agendarCura(supabase, supabaseUrl, c)) agendadas += 1;
    }
    return json(200, { ok: true, conexoes: (conns ?? []).length, curas_agendadas: agendadas });
  }

  // Resolve a conexão pelo secret do path (cada org tem sua URL/secret).
  const { data: conn } = await supabase
    .from("wa_connections")
    .select("id, organization_id, webhook_secret, instance_token, provider, meta_phone_number_id, phone_number, status, base_url, forward_webhook_url, meta_app_secret")
    .eq("webhook_secret", pathSecret)
    .maybeSingle();

  // --- Verificação da Meta (GET) ---
  if (req.method === "GET") {
    const u = new URL(req.url);
    const mode = u.searchParams.get("hub.mode");
    const verifyToken = u.searchParams.get("hub.verify_token");
    const challenge = u.searchParams.get("hub.challenge") ?? "";
    // verify_token esperado = o próprio webhook_secret da conexão.
    if (mode === "subscribe" && conn && verifyToken && String(verifyToken) === String(conn.webhook_secret)) {
      return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
    }
    return json(403, { error: "verify token inválido" });
  }

  if (req.method !== "POST") return json(405, { error: "Método não permitido" });
  if (!conn) return json(200, { ok: true, ignored: "secret nao vinculado" });
  if (String(conn.provider) !== "meta_cloud") return json(200, { ok: true, ignored: "conexao nao e meta_cloud" });
  // Conexão DESATIVADA (admin desconectou = credenciais zeradas): ignora tudo.
  // Sem esse gate, o webhook ressuscitaria o status pra 'connected' e seguiria
  // gravando mensagens depois do Desconectar (o webhook na Meta é manual e não
  // some no DELETE). Enquanto o número não for removido lá, a URL segue viva.
  if (!conn.instance_token || !conn.meta_phone_number_id) {
    return json(200, { ok: true, ignored: "conexao desativada" });
  }

  // AUTO-CURA da assinatura (a cada 10 min por conexão; ver curarConexao).
  await agendarCura(supabase, supabaseUrl, conn);

  // deno-lint-ignore no-explicit-any
  let payload: any;
  let rawBody = "";
  try {
    rawBody = await req.text();
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  // ESPELHO: outro sistema (ex.: outro CRM) que também precisa dos eventos
  // deste número. A Meta só entrega pra UM destino por app, então o CRM fica
  // com o webhook e repassa o payload BRUTO (assinado com o app secret, igual
  // à Meta) — os dois recebem tudo. Pings do cron não são espelhados.
  const espelhoUrl = String(conn.forward_webhook_url ?? "").trim();
  if (
    espelhoUrl && req.headers.get("x-wa-heal") !== "1" &&
    Array.isArray(payload?.entry) && payload.entry.length > 0
  ) {
    const espelho = (async () => {
      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "user-agent": "NossoCRM-Webhook-Mirror/1.0",
        };
        const appSecret = String(conn.meta_app_secret ?? "");
        if (appSecret) headers["x-hub-signature-256"] = `sha256=${await hmacSha256Hex(appSecret, rawBody)}`;
        const r = await fetch(espelhoUrl, { method: "POST", headers, body: rawBody });
        console.log(`[wa-meta-espelho] conn=${conn.id} => ${r.status}`);
      } catch (e) {
        console.error("[wa-meta-espelho] falhou:", e);
      }
    })();
    try {
      // @ts-ignore: EdgeRuntime existe no runtime das Edge Functions da Supabase
      EdgeRuntime.waitUntil(espelho);
    } catch {
      void espelho;
    }
  }

  // FAN-OUT: o MESMO número pode estar conectado em mais de uma organização
  // (ex.: agência e cliente). A Meta entrega cada evento UMA vez (na URL de
  // uma das conexões); aqui ele é processado para TODAS as conexões ativas
  // desse phone_number_id, cada uma no chat da própria org.
  const { data: irmas } = await supabase
    .from("wa_connections")
    .select("id, organization_id, webhook_secret, instance_token, provider, meta_phone_number_id, phone_number, status, base_url")
    .eq("provider", "meta_cloud")
    .eq("meta_phone_number_id", conn.meta_phone_number_id)
    .eq("status", "connected")
    .neq("id", conn.id);
  const alvos: ConnRow[] = [conn, ...(irmas ?? []).filter((c: ConnRow) => c.instance_token)];
  for (const alvo of alvos) {
    try {
      await processarEventos(supabase, alvo, payload);
    } catch (e) {
      console.error(`[wa-webhook-meta] processar conn=${alvo.id}:`, e);
    }
  }

  return json(200, { ok: true });
});
