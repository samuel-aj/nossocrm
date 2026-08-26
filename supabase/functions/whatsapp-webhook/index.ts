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

/** Extrai o telefone de um vCard (waid= ou linha TEL). */
function vcardPhone(vcard?: string): string {
  if (!vcard) return "";
  const wa = vcard.match(/waid=(\d+)/);
  if (wa) return `+${wa[1]}`;
  const tel = vcard.match(/TEL[^:]*:([+\d][\d\s().-]{5,})/i);
  return tel ? tel[1].trim() : "";
}

// deno-lint-ignore no-explicit-any
function extractContent(rawMessage: any): {
  text?: string;
  mediaType?: string;
  mediaMime?: string;
  fileName?: string;
  skip?: boolean;
} {
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

  // Cartão de contato compartilhado (vCard) — cartão com avatar na UI
  // (body = "nome\ntelefone"; o webhook busca a foto de perfil depois)
  if (message.contactMessage) {
    const c = message.contactMessage;
    const phone = vcardPhone(c.vcard);
    return { text: `${c.displayName || "Contato"}${phone ? `\n${phone}` : ""}`, mediaType: "contact" };
  }
  if (message.contactsArrayMessage?.contacts?.length) {
    // deno-lint-ignore no-explicit-any
    const rows = message.contactsArrayMessage.contacts.map((c: any) => {
      const phone = vcardPhone(c.vcard);
      return `${c.displayName || "sem nome"}${phone ? ` — ${phone}` : ""}`;
    });
    return { text: `👤 Contatos compartilhados:\n${rows.join("\n")}` };
  }

  // Localização — texto com link do Maps
  const loc = message.locationMessage ?? message.liveLocationMessage;
  if (loc && loc.degreesLatitude !== undefined) {
    const label = loc.name || loc.address || "Localização";
    return { text: `📍 ${label}\nhttps://maps.google.com/?q=${loc.degreesLatitude},${loc.degreesLongitude}` };
  }

  // Enquete criada — pergunta + opções como texto
  const poll = message.pollCreationMessageV3 ?? message.pollCreationMessageV2 ?? message.pollCreationMessage;
  if (poll?.name) {
    // deno-lint-ignore no-explicit-any
    const opts = (poll.options ?? []).map((o: any) => `• ${o.optionName}`).join("\n");
    return { text: `📊 Enquete: ${poll.name}${opts ? `\n${opts}` : ""}` };
  }

  // Eventos de protocolo/reação/voto: não são "mensagens" — não gera bolha
  if (message.reactionMessage || message.protocolMessage || message.pollUpdateMessage || message.senderKeyDistributionMessage) {
    return { skip: true };
  }
  // Só metadados de contexto (sem conteúdo real): também ignora
  const keys = Object.keys(message);
  if (keys.length > 0 && keys.every(k => k === "messageContextInfo")) {
    return { skip: true };
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

  // Corpo lido como TEXTO (e não req.json()) só pra guardar o JSON original:
  // o espelho abaixo repassa exatamente o texto que a Evolution mandou.
  // deno-lint-ignore no-explicit-any
  let payload: any;
  let rawBody = "";
  try {
    rawBody = await req.text();
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "JSON inválido" });
  }

  const event = String(payload?.event ?? "").toLowerCase().replace(/_/g, ".");
  const instanceName = payload?.instance ?? payload?.instanceName;
  if (!instanceName) return json(200, { ok: true, ignored: "sem instance" });

  const { data: conn } = await supabase
    .from("wa_connections")
    .select("id, organization_id, webhook_secret, instance_token, base_url, phone_number, forward_webhook_url")
    .eq("instance_name", instanceName)
    .maybeSingle();
  if (!conn) return json(200, { ok: true, ignored: "instancia nao vinculada" });

  // Secret OBRIGATÓRIO: sem o segmento na URL (ou com valor errado), rejeita.
  // Este secret é o único gate real da função (roda com service role).
  const pathSecret = getSecretFromPath(req);
  if (!pathSecret || String(conn.webhook_secret) !== String(pathSecret)) {
    return json(401, { error: "secret inválido" });
  }

  // ESPELHO: outro sistema (n8n, outro CRM, automação) que também precisa dos
  // eventos deste número. A Evolution entrega pra UM webhook por instância,
  // então o CRM fica com o webhook e repassa o corpo BRUTO (JSON original)
  // pra URL salva na conexão. Fire-and-forget: não espera a resposta, não
  // altera a resposta à Evolution nem a gravação abaixo; falha só vai pro log.
  // Corpos sem `event` (ping/health) não são espelhados.
  const espelhoUrl = String(conn.forward_webhook_url ?? "").trim();
  const espelhoEvento =
    typeof payload?.event === "string" ? payload.event.replace(/[^\x20-\x7e]/g, "").trim() : "";
  if (espelhoUrl && espelhoEvento) {
    const espelho = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          "user-agent": "NossoCRM-Webhook-Mirror/1.0",
          "X-Webhook-Secret": String(conn.webhook_secret ?? ""),
          "X-Connection-Id": String(conn.id),
          "X-Evolution-Event": espelhoEvento,
        };
        const r = await fetch(espelhoUrl, { method: "POST", headers, body: rawBody, signal: ctrl.signal });
        console.log(`[wa-espelho] conn=${conn.id} evento=${espelhoEvento} => ${r.status}`);
      } catch (e) {
        console.error(`[wa-espelho] conn=${conn.id} falhou:`, e);
      } finally {
        clearTimeout(timer);
      }
    })();
    try {
      // @ts-ignore: EdgeRuntime existe no runtime das Edge Functions da Supabase
      EdgeRuntime.waitUntil(espelho);
    } catch {
      void espelho;
    }
  }

  const orgId = conn.organization_id as string;
  const data = payload?.data;

  // --- Estado da conexão ---
  if (event === "connection.update") {
    const state = mapState(data?.state);

    if (state !== "connected") {
      // Desconectou: as conversas NÃO são apagadas — as rotas do app param de
      // exibi-las enquanto status != connected (reconectar o MESMO número
      // traz tudo de volta).
      await supabase.from("wa_connections").update({ status: state }).eq("id", conn.id);
      return json(200, { ok: true });
    }

    // Conectou: descobre o NÚMERO do WhatsApp (wuid do evento; fallback:
    // consulta a Evolution). É a chave da posse das conversas no CRM.
    let ownerPhone = jidToE164(data?.wuid ?? data?.ownerJid);
    if (!ownerPhone) {
      const evoBaseUrl = String(conn.base_url ?? Deno.env.get("EVOLUTION_BASE_URL") ?? "")
        .replace(/\/+$/, "")
        .replace(/\/manager$/, "");
      const evoApiToken = String(conn.instance_token ?? Deno.env.get("EVOLUTION_API_KEY") ?? "");
      if (evoBaseUrl && evoApiToken) {
        try {
          const r = await fetch(
            `${evoBaseUrl}/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`,
            { headers: { apikey: evoApiToken } }
          );
          if (r.ok) {
            const arr = await r.json();
            // deno-lint-ignore no-explicit-any
            const inst: any = Array.isArray(arr) ? arr[0] : arr;
            ownerPhone = jidToE164(inst?.ownerJid ?? inst?.instance?.owner ?? inst?.owner);
          }
        } catch {
          // segue sem número — não arrisca apagar nada sem certeza
        }
      }
    }

    // Conectou um NÚMERO DIFERENTE do anterior => conversas do número antigo
    // saem do CRM de vez (não podem aparecer sob o número novo). A comparação
    // usa as variantes do nono dígito BR pra não confundir grafias do MESMO
    // número com troca de número.
    const prevPhone = String(conn.phone_number ?? "");
    const samePhone =
      !prevPhone || !ownerPhone ||
      brPhoneVariants(prevPhone).includes(ownerPhone) ||
      brPhoneVariants(ownerPhone).includes(prevPhone);
    if (!samePhone) {
      // MULTI-NÚMERO: apaga SÓ as conversas DESTA conexão (+ as legadas sem
      // connection_id, que nasceram na era de 1 conexão por org). As conversas
      // dos OUTROS números (ex.: API oficial) ficam intactas.
      await supabase
        .from("wa_conversations")
        .delete()
        .eq("organization_id", orgId)
        .or(`connection_id.eq.${conn.id},connection_id.is.null`);
    }

    await supabase
      .from("wa_connections")
      .update({
        status: state,
        last_connected_at: new Date().toISOString(),
        ...(ownerPhone ? { phone_number: ownerPhone } : {}),
        ...(data?.profileName ? { profile_name: String(data.profileName) } : {}),
      })
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
      // JID de privacidade (@lid): o telefone real vem em remoteJidAlt
      const rawJid: string = key.remoteJid ?? "";
      const altJid: string = key.remoteJidAlt ?? m.remoteJidAlt ?? "";
      const remoteJid: string = rawJid.endsWith("@lid") && altJid ? altJid : rawJid;
      if (remoteJid.endsWith("@g.us") || remoteJid.endsWith("@broadcast") || remoteJid.endsWith("@lid")) continue;
      const phone = jidToE164(remoteJid);
      const providerId = key.id;
      if (!phone || !providerId) continue;

      const fromMe = !!key.fromMe;
      const { text, mediaType, mediaMime, fileName, skip } = extractContent(m.message);
      if (skip) continue;
      const tsRaw = m.messageTimestamp;
      const tsNum = typeof tsRaw === "string" ? parseInt(tsRaw, 10) : tsRaw;
      const waTs = tsNum ? new Date(tsNum * 1000).toISOString() : new Date().toISOString();

      // Conversa POR NÚMERO CONECTADO (cada número é um "WhatsApp" próprio):
      // 1) conversa desta conexão; 2) reivindica uma órfã (connection_id NULL,
      // era pré multi-número ou conexão excluída); 3) cria; 4) se o insert
      // conflitar, relê — primeiro por conexão e, enquanto a trava antiga
      // (org+telefone) existir no banco, cai na conversa única da org
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
            wa_name: m.pushName ?? null,
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
          if (!convId) console.error("[wa-webhook] conversa nao criada:", convErr.message);
        }
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
      const evoBaseUrl = String(conn.base_url ?? Deno.env.get("EVOLUTION_BASE_URL") ?? "")
        .replace(/\/+$/, "")
        .replace(/\/manager$/, "");
      const evoApiToken = String(conn.instance_token ?? Deno.env.get("EVOLUTION_API_KEY") ?? "");
      if (mediaType === "contact") {
        // Cartão de contato: busca a foto de perfil do número compartilhado
        // (best-effort; sem foto o chat mostra avatar com a inicial)
        const sharedDigits = ((text ?? "").split("\n")[1] ?? "").replace(/\D/g, "");
        if (sharedDigits && evoBaseUrl && evoApiToken) {
          try {
            const pr = await fetch(
              `${evoBaseUrl}/chat/fetchProfilePictureUrl/${encodeURIComponent(instanceName)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json", apikey: evoApiToken },
                body: JSON.stringify({ number: sharedDigits }),
              }
            );
            if (pr.ok) {
              const pj = await pr.json();
              if (pj?.profilePictureUrl) {
                const img = await fetch(pj.profilePictureUrl);
                if (img.ok) {
                  const buf = new Uint8Array(await img.arrayBuffer());
                  const safeId = String(providerId).replace(/[^a-zA-Z0-9_-]/g, "");
                  const path = `${orgId}/${convId}/${safeId}_avatar.jpg`;
                  const { error: upErr } = await supabase.storage
                    .from("wa-media")
                    .upload(path, buf, { contentType: "image/jpeg", upsert: true });
                  if (!upErr) {
                    mediaPath = path;
                    mediaMimeFinal = "image/jpeg";
                  }
                }
              }
            }
          } catch {
            // sem foto: o cartão mostra a inicial
          }
        }
      } else if (mediaType) {
        let bytes: Uint8Array | null = null;
        // a Evolution injeta o base64 em data.message.base64 ou data.base64 (varia por versão)
        const b64raw = m.message?.base64 ?? m.base64;
        const b64 = typeof b64raw === "string" && b64raw.length > 0 ? b64raw : null;
        if (b64) bytes = base64ToBytes(b64);
        if (!bytes) {
          // fallback: pede a mídia pra Evolution (token/base salvos na conexão)
          if (evoBaseUrl && evoApiToken) {
            try {
              const r = await fetch(
                `${evoBaseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json", apikey: evoApiToken },
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
        // webhook de saída: echo = enviada por fora (celular)
        source: fromMe ? "echo" : "inbound",
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

      // Bolinha de não lidas (estilo WhatsApp): só mensagem RECEBIDA conta;
      // zera quando a conversa é aberta no CRM (GET /api/whatsapp/messages).
      if (!fromMe) {
        await supabase.rpc("wa_increment_unread", { p_conversation_id: convId });
      }
    }
    return json(200, { ok: true });
  }

  return json(200, { ok: true, ignored: event });
});
