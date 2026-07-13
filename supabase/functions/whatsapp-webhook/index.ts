/**
 * Webhook de entrada do WhatsApp (Evolution API).
 *
 * Rota (Supabase Edge Function, pública):
 *   POST /functions/v1/whatsapp-webhook/<webhook_secret>
 *
 * Por que Edge Function (e não rota Next): o preview do app tem Vercel
 * Authentication (SSO), que bloquearia o POST da Evolution. A Edge Function
 * fica fora desse bloqueio (mesmo padrão do webhook-in).
 *
 * Fluxo: valida o secret -> acha a conexão pela `instance` do payload ->
 * casa o telefone com um contato -> grava conversa + mensagem (idempotente
 * por evolution_message_id) -> atualiza a conversa. Também trata status e
 * connection.update.
 *
 * Usa SUPABASE_SERVICE_ROLE_KEY (ignora RLS).
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  const idx = parts.findIndex((p) => p === "whatsapp-webhook");
  if (idx === -1) return null;
  return parts[idx + 1] ?? null;
}

function jidToE164(jid?: string): string {
  if (!jid) return "";
  const digits = String(jid).split("@")[0].split(":")[0].replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

/**
 * Variantes equivalentes de um celular BR (nono dígito): o JID do WhatsApp
 * pode vir SEM o 9 (+55 DD 9XXXXXXXX <-> +55 DD XXXXXXXX). O casamento de
 * conversa/contato precisa testar as duas formas, senão duplica conversa.
 * (Espelho de brPhoneVariants em lib/phone.ts do app.)
 */
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

/**
 * Desembrulha contêineres do WhatsApp: GIFs, mensagens temporárias e
 * "ver uma vez" chegam como { ephemeralMessage|viewOnceMessage*|
 * documentWithCaptionMessage|deviceSentMessage: { message: {...} } }.
 */
// deno-lint-ignore no-explicit-any
function unwrapMessage(message: any): any {
  let msg = message;
  for (let i = 0; i < 3 && msg; i++) {
    const wrapper =
      msg.ephemeralMessage ??
      msg.viewOnceMessage ??
      msg.viewOnceMessageV2 ??
      msg.viewOnceMessageV2Extension ??
      msg.documentWithCaptionMessage ??
      msg.deviceSentMessage;
    if (wrapper?.message) msg = wrapper.message;
    else break;
  }
  return msg;
}

// deno-lint-ignore no-explicit-any
function extractContent(rawMessage: any): { text?: string; mediaType?: string; mediaMime?: string; fileName?: string } {
  const message = unwrapMessage(rawMessage);
  if (!message) return {};
  if (typeof message.conversation === "string") return { text: message.conversation };
  if (message.extendedTextMessage?.text) return { text: message.extendedTextMessage.text };
  const kinds: [string, string][] = [
    ["imageMessage", "image"],
    ["videoMessage", "video"],
    ["audioMessage", "audio"],
    ["documentMessage", "document"],
    ["stickerMessage", "sticker"],
  ];
  for (const [field, type] of kinds) {
    if (message[field]) {
      return {
        text: message[field].caption,
        mediaType: type,
        mediaMime: message[field].mimetype,
        fileName: message[field].fileName,
      };
    }
  }
  return {};
}

/** Extensão de arquivo a partir do mime (fallback: nome original ou .bin). */
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
    "audio/wav": "wav",
    "audio/webm": "webm",
    "application/pdf": "pdf",
  };
  if (map[m]) return map[m];
  const fromName = (fileName ?? "").split(".").pop();
  if (fromName && fromName.length <= 5 && /^[a-zA-Z0-9]+$/.test(fromName)) return fromName.toLowerCase();
  return "bin";
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
    const bin = atob(clean);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function mapState(s?: string): string {
  if (s === "open") return "connected";
  if (s === "connecting") return "connecting";
  return "disconnected";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Método não permitido" });

  const supabaseUrl = Deno.env.get("CRM_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
  const serviceKey =
    Deno.env.get("CRM_SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "Supabase não configurado no runtime" });
  const supabase = createClient(supabaseUrl, serviceKey);

  // deno-lint-ignore no-explicit-any
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const event = String(payload?.event ?? "").toLowerCase().replace(/_/g, ".");
  const instanceName = payload?.instance ?? payload?.instanceName;
  if (!instanceName) return json(200, { ok: true, ignored: "sem instance" });

  const { data: conn } = await supabase
    .from("wa_connections")
    .select("id, organization_id, webhook_secret, instance_token, base_url")
    .eq("instance_name", instanceName)
    .maybeSingle();
  if (!conn) return json(200, { ok: true, ignored: "instancia nao vinculada" });

  // Secret OBRIGATÓRIO: sem o segmento na URL (ou com valor errado), rejeita.
  // Este secret é o único gate real da função (roda com service role).
  const pathSecret = getSecretFromPath(req);
  if (!pathSecret || String(conn.webhook_secret) !== String(pathSecret)) {
    return json(401, { error: "secret inválido" });
  }

  const orgId = conn.organization_id as string;
  const data = payload?.data;

  // --- Estado da conexão ---
  if (event === "connection.update") {
    const state = mapState(data?.state);
    await supabase
      .from("wa_connections")
      .update({ status: state, ...(state === "connected" ? { last_connected_at: new Date().toISOString() } : {}) })
      .eq("id", conn.id);
    return json(200, { ok: true });
  }

  // --- Status de entrega/leitura (✓✓) ---
  if (event === "messages.update") {
    // a Evolution pode mandar VÁRIOS updates num só evento — processa todos
    const items = Array.isArray(data) ? data : [data];
    const map: Record<string, string> = {
      SERVER_ACK: "sent",
      DELIVERY_ACK: "delivered",
      READ: "read",
      PLAYED: "read",
      ERROR: "failed",
    };
    // só avança o status (evento fora de ordem não rebaixa "lida" p/ "entregue")
    const lowerThan: Record<string, string[]> = {
      sent: ["queued"],
      delivered: ["queued", "sent"],
      read: ["queued", "sent", "delivered"],
      failed: ["queued", "sent", "delivered"],
    };
    for (const item of items) {
      const id = item?.key?.id ?? item?.keyId;
      const raw = String(item?.status ?? item?.update?.status ?? "").toUpperCase();
      const status = map[raw];
      if (!id || !status) continue;
      await supabase
        .from("wa_messages")
        .update({ status })
        .eq("organization_id", orgId)
        .eq("evolution_message_id", id)
        .in("status", lowerThan[status] ?? []);
    }
    return json(200, { ok: true });
  }

  // --- Mensagens (recebidas e eco de enviadas) ---
  if (event === "messages.upsert") {
    const msgs = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : [data];
    for (const m of msgs) {
      if (!m) continue;
      const key = m.key ?? {};
      const remoteJid: string = key.remoteJid ?? "";
      if (remoteJid.endsWith("@g.us") || remoteJid.endsWith("@broadcast")) continue;
      const phone = jidToE164(remoteJid);
      const providerId = key.id;
      if (!phone || !providerId) continue;

      const fromMe = !!key.fromMe;
      const { text, mediaType, mediaMime, fileName } = extractContent(m.message);
      const tsRaw = m.messageTimestamp;
      const tsNum = typeof tsRaw === "string" ? parseInt(tsRaw, 10) : tsRaw;
      const waTs = tsNum ? new Date(tsNum * 1000).toISOString() : new Date().toISOString();

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
        const { data: created } = await supabase
          .from("wa_conversations")
          .insert({
            organization_id: orgId,
            connection_id: conn.id,
            contact_id: contact?.id ?? null,
            wa_phone: phone,
            wa_name: m.pushName ?? null,
          })
          .select("id")
          .single();
        convId = created?.id ?? null;
      }
      if (!convId) continue;

      // Eco de mensagem já gravada (ex.: enviada pelo CRM no /send)? Pula tudo
      // — evita upload duplicado de mídia e o insert com erro de unicidade.
      const { data: existingMsg } = await supabase
        .from("wa_messages")
        .select("id")
        .eq("organization_id", orgId)
        .eq("evolution_message_id", providerId)
        .maybeSingle();
      if (existingMsg) continue;

      // Mídia: base64 no payload (webhookBase64=true) ou busca na Evolution;
      // sobe pro Storage privado e guarda o CAMINHO (a API assina URL na leitura).
      let mediaPath: string | null = null;
      let mediaMimeFinal = mediaMime ?? null;
      if (mediaType) {
        let bytes: Uint8Array | null = null;
        // a Evolution injeta o base64 em data.message.base64 ou data.base64 (varia por versão)
        const b64raw = m.message?.base64 ?? m.base64;
        const b64 = typeof b64raw === "string" && b64raw.length > 0 ? b64raw : null;
        if (b64) bytes = base64ToBytes(b64);
        if (!bytes) {
          // fallback: pede a mídia pra Evolution (token/base salvos na conexão)
          const evoBase = String(conn.base_url ?? Deno.env.get("EVOLUTION_BASE_URL") ?? "")
            .replace(/\/+$/, "")
            .replace(/\/manager$/, "");
          const evoToken = String(conn.instance_token ?? Deno.env.get("EVOLUTION_API_KEY") ?? "");
          if (evoBase && evoToken) {
            try {
              const r = await fetch(
                `${evoBase}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", apikey: evoToken },
                  body: JSON.stringify({ message: { key: { id: providerId } }, convertToMp4: false }),
                }
              );
              if (r.ok) {
                const j = await r.json();
                if (j?.base64) {
                  bytes = base64ToBytes(j.base64);
                  if (j.mimetype) mediaMimeFinal = j.mimetype;
                }
              }
            } catch {
              // segue sem mídia; a mensagem entra com placeholder [tipo]
            }
          }
        }
        if (bytes && bytes.length > 0) {
          const ext = extFromMime(mediaMimeFinal ?? undefined, fileName);
          const safeId = String(providerId).replace(/[^a-zA-Z0-9_-]/g, "");
          const path = `${orgId}/${convId}/${safeId}.${ext}`;
          const { error: upErr } = await supabase.storage
            .from("wa-media")
            .upload(path, bytes, { contentType: mediaMimeFinal ?? "application/octet-stream", upsert: true });
          if (!upErr) mediaPath = path;
          else console.error("[wa-webhook] upload:", upErr.message);
        }
      }

      // idempotente: o índice único (org, evolution_message_id) descarta o eco
      // das mensagens que NÓS enviamos (já gravadas no /send).
      const { error: insErr } = await supabase.from("wa_messages").insert({
        organization_id: orgId,
        conversation_id: convId,
        direction: fromMe ? "out" : "in",
        status: fromMe ? "sent" : "received",
        body: text ?? null,
        media_type: mediaType ?? null,
        media_mime: mediaMimeFinal,
        media_url: mediaPath,
        evolution_message_id: providerId,
        from_phone: fromMe ? null : phone,
        to_phone: fromMe ? phone : null,
        wa_timestamp: waTs,
      });
      const dup = insErr && String(insErr.message).toLowerCase().includes("duplicate");
      if (insErr && !dup) {
        console.error("[wa-webhook] insert:", insErr.message);
        continue;
      }
      if (dup) continue; // já tínhamos essa mensagem; não mexe na conversa

      const preview = text ? text.slice(0, 140) : mediaType ? `[${mediaType}]` : "";
      await supabase
        .from("wa_conversations")
        .update({ last_message_at: waTs, last_message_preview: preview })
        .eq("id", convId);
    }
    return json(200, { ok: true });
  }

  return json(200, { ok: true, ignored: event });
});
