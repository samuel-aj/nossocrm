/**
 * POST /api/whatsapp/transcribe { messageId }
 * Transcreve o áudio de uma mensagem do WhatsApp com a IA da organização
 * (mesma config da Central de I.A.: Gemini ouve o áudio direto; OpenAI usa
 * o whisper-1). O resultado fica CACHEADO em wa_messages.transcription —
 * cada áudio é transcrito (e pago) uma vez só.
 */
import { generateText, experimental_transcribe as transcribe } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { requireOrgUser, json } from '@/lib/whatsapp/api';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';
import { getModel } from '@/lib/ai/config';
import { AIProvider as AIProviderConst } from '@/types/constants';

// SEM maxDuration de propósito: o default da Vercel (300s) é o maior valor —
// áudios longos precisam dele; os 60s das rotas de ai/* CAPAM o tempo.

// áudio de voz é pequeno; o limite protege o request inline pro Gemini (20MB c/ base64)
const MAX_AUDIO_BYTES = 14 * 1024 * 1024;

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

  const body = (await req.json().catch(() => ({}))) as { messageId?: string };
  const messageId = (body.messageId || '').trim();
  if (!messageId) return json({ error: 'messageId é obrigatório' }, 400);

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

  // Config de IA da organização (mesma da Central de I.A.)
  const { data: ai } = await auth.admin
    .from('organization_settings')
    .select('ai_enabled, ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('organization_id', auth.user.organizationId)
    .single();

  const aiEnabled = typeof ai?.ai_enabled === 'boolean' ? ai.ai_enabled : true;
  if (!aiEnabled) {
    return json({ error: 'IA desativada pela organização. Um admin pode ativar em Configurações → Central de I.A.' }, 403);
  }
  const provider = (ai?.ai_provider ?? AIProviderConst.GOOGLE) as string;
  const apiKey: string | null =
    provider === AIProviderConst.GOOGLE
      ? (ai?.ai_google_key ?? null)
      : provider === AIProviderConst.OPENAI
        ? (ai?.ai_openai_key ?? null)
        : (ai?.ai_anthropic_key ?? null);
  if (!apiKey) {
    return json(
      { error: 'API key de IA não configurada. Configure em Configurações → Central de I.A.' },
      400
    );
  }
  if (provider === AIProviderConst.ANTHROPIC) {
    return json(
      { error: 'Transcrição de áudio não é suportada pela Anthropic. Use Google Gemini ou OpenAI em Configurações → Central de I.A.' },
      400
    );
  }

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
  if (bytes.byteLength === 0) return json({ error: 'O áudio está vazio' }, 400);
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    return json({ error: 'Áudio grande demais pra transcrever (limite 14MB)' }, 400);
  }
  if (!mime || !mime.startsWith('audio/')) mime = 'audio/ogg';

  let text = '';
  try {
    if (provider === AIProviderConst.OPENAI) {
      const openai = createOpenAI({ apiKey });
      const result = await transcribe({
        model: openai.transcription('whisper-1'),
        audio: new Uint8Array(bytes),
      });
      text = (result.text || '').trim();
    } else {
      // Gemini ouve o áudio direto — mesmo default resolvido do ai/chat
      // (o fallback interno do getModel é o 1.5-flash, já APOSENTADO)
      const model = getModel(AIProviderConst.GOOGLE, apiKey, ai?.ai_model || 'gemini-2.5-flash');
      const result = await generateText({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'file', data: bytes, mediaType: mime },
              {
                type: 'text',
                text: 'Transcreva este áudio em português do Brasil. Responda SOMENTE com o texto falado, sem comentários, prefixos ou formatação.',
              },
            ],
          },
        ],
      });
      text = (result.text || '').trim();
    }
  } catch (e) {
    console.error('[whatsapp/transcribe] falha na IA:', e);
    return json({ error: `A IA não conseguiu transcrever: ${(e as Error).message}` }, 502);
  }

  if (!text) return json({ error: 'A IA não retornou transcrição pra este áudio' }, 502);

  const { error: cacheErr } = await auth.admin
    .from('wa_messages')
    .update({ transcription: text })
    .eq('id', msg.id);
  if (cacheErr) console.error('[whatsapp/transcribe] cache não gravado:', cacheErr.message);
  return json({ transcription: text });
}
