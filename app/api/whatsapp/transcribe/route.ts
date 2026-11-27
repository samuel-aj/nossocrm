import { conversationAllowed } from '@/lib/permissions/conversationAccess';
import { enforceRateLimit, LIMITS } from '@/lib/security/rateLimit';
/**
 * POST /api/whatsapp/transcribe { messageId }
 * Transcreve o áudio de uma mensagem do WhatsApp com a IA da organização
 * (mesma config da Central de I.A.: Gemini ouve o áudio direto; OpenAI usa
 * o whisper-1). O resultado fica CACHEADO em wa_messages.transcription —
 * cada áudio é transcrito (e pago) uma vez só.
 */
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { loadTranscriptionAi, transcribeWithAi } from '@/lib/ai/transcribeAudio';

// SEM maxDuration de propósito: o default da Vercel (300s) é o maior valor —
// áudios longos precisam dele; os 60s das rotas de ai/* CAPAM o tempo.

interface MessageRow {
  id: string;
  media_type: string | null;
  media_url: string | null;
  media_mime: string | null;
  transcription: string | null;
  conversation: { organization_id: string } | null;
}

export async function POST(req: Request) {
  if (!isAllowedOrigin(req)) return json({ error: 'Forbidden' }, 403);
  const auth = await requireOrgUser();
  if (!auth.ok) return auth.response;
  const limited = await enforceRateLimit({ scope: 'ai', id: auth.user.id, limit: LIMITS.aiPerUser(), request: req, actorId: auth.user.id, organizationId: auth.user.organizationId });
  if (limited) return limited;

  const body = (await req.json().catch(() => ({}))) as { messageId?: string };
  const messageId = (body.messageId || '').trim();
  if (!messageId) return json({ error: 'messageId é obrigatório' }, 400);

  const { data: messageAccess } = await auth.admin.from('wa_messages').select('conversation_id').eq('id', messageId).eq('organization_id', auth.user.organizationId).maybeSingle();
  if (!messageAccess || !(await conversationAllowed(auth.admin, auth.user, { id: messageAccess.conversation_id }))) return json({ error: 'Mensagem indisponível' }, 404);
  const { data: msg } = await auth.admin
    .from('wa_messages')
    .select(
      'id, media_type, media_url, media_mime, transcription, conversation:wa_conversations(organization_id)'
    )
    .eq('id', messageId)
    .single<MessageRow>();

  if (!msg || msg.conversation?.organization_id !== auth.user.organizationId) {
    return json({ error: 'Mensagem não encontrada' }, 404);
  }
  if (msg.media_type !== 'audio') return json({ error: 'A mensagem não é um áudio' }, 400);
  if ((msg.transcription || '').trim()) return json({ transcription: msg.transcription });
  if (!msg.media_url) return json({ error: 'O áudio não está mais disponível' }, 400);

  // Config de IA da organização (mesma da Central de I.A.), conferida antes de baixar o áudio
  const loaded = await loadTranscriptionAi(auth.admin, auth.user.organizationId);
  if (!loaded.ok) return json({ error: loaded.error }, loaded.status);

  // Baixa o áudio: media_url normalmente é o CAMINHO no bucket privado wa-media
  let bytes: ArrayBuffer;
  let mime = (msg.media_mime || '').split(';')[0].trim();
  if (msg.media_url.startsWith('http')) {
    const res = await fetch(msg.media_url, { cache: 'no-store' });
    if (!res.ok) return json({ error: 'Falha ao ler o áudio do storage' }, 502);
    mime = mime || (res.headers.get('content-type') || '').split(';')[0].trim();
    bytes = await res.arrayBuffer();
  } else {
    const { data: file, error } = await auth.admin.storage.from('wa-media').download(msg.media_url);
    if (error || !file) return json({ error: 'Falha ao ler o áudio do storage' }, 502);
    mime = mime || (file.type || '').split(';')[0].trim();
    bytes = await file.arrayBuffer();
  }

  // Tamanho, tipo do áudio e chamada à IA ficam na função comum
  const result = await transcribeWithAi(loaded.ai, bytes, mime);
  if (!result.ok) return json({ error: result.error }, result.status);
  const text = result.text;

  const { error: cacheErr } = await auth.admin
    .from('wa_messages')
    .update({ transcription: text })
    .eq('id', msg.id);
  if (cacheErr) console.error('[whatsapp/transcribe] cache não gravado:', cacheErr.message);
  return json({ transcription: text });
}
