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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const supabaseUrl = Deno.env.get("CRM_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("CRM_SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Supabase não configurado no runtime" });
  const supabase = createClient(supabaseUrl, serviceKey);

  const pathSecret = getSecretFromPath(req);
  if (!pathSecret) return json(404, { error: "sem secret" });

  // Resolve a conexão pelo secret do path (cada org tem sua URL/secret).
  const { data: conn } = await supabase
    .from("wa_connections")
    .select("id, organization_id, webhook_secret, instance_token, provider, meta_phone_number_id, phone_number, status")
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

  const orgId = conn.organization_id as string;
  const token = String(conn.instance_token ?? "");

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value ?? {};
      const metadata = value?.metadata ?? {};

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
      const echoes = Array.isArray(value?.message_echoes) ? value.message_echoes : [];
      // deno-lint-ignore no-explicit-any
      const inbound = (Array.isArray(value?.messages) ? value.messages : []).map((m: any) => ({ m, isEcho: false }));
      // deno-lint-ignore no-explicit-any
      const outbound = echoes.map((m: any) => ({ m, isEcho: true }));
      for (const { m, isEcho } of [...inbound, ...outbound]) {
        if (!m) continue;
        const providerId = m.id;
        // No eco quem interessa é o destinatário (`to`); na recebida, o remetente.
        const phone = waIdToE164(isEcho ? m.to : m.from);
        if (!providerId || !phone) continue;

        const { text, mediaType, mediaId, mediaMime, fileName, skip } = extractContent(m);
        if (skip) continue;
        const tsNum = typeof m.timestamp === "string" ? parseInt(m.timestamp, 10) : m.timestamp;
        const waTs = tsNum ? new Date(tsNum * 1000).toISOString() : new Date().toISOString();
        const pushName = isEcho ? null : nameByWaId[String(m.from)] || null;

        // conversa (casa contato pelo telefone, testando variantes BR do 9)
        const variants = brPhoneVariants(phone);
        let convId: string | null = null;
        const { data: convList } = await supabase
          .from("wa_conversations")
          .select("id, contact_id")
          .eq("organization_id", orgId)
          .in("wa_phone", variants);
        const conv = (convList ?? []).find((c) => c.contact_id) ?? (convList ?? [])[0];
        if (conv) {
          convId = conv.id;
        } else {
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
            // Corrida: outra entrega concorrente da Meta já criou a conversa
            // (viola uq_wa_conversations_org_phone). Relê em vez de descartar.
            const { data: again } = await supabase
              .from("wa_conversations")
              .select("id")
              .eq("organization_id", orgId)
              .in("wa_phone", variants)
              .limit(1)
              .maybeSingle();
            convId = again?.id ?? null;
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

        const { error: insErr } = await supabase.from("wa_messages").insert({
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
        });
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

  return json(200, { ok: true });
});
