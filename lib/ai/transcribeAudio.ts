import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateText, experimental_transcribe as transcribe } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getModel } from '@/lib/ai/config';
import { AIProvider as AIProviderConst } from '@/types/constants';

// Áudio de voz é pequeno; o limite protege o request inline pro Gemini (20MB c/ base64).
export const MAX_AUDIO_BYTES = 14 * 1024 * 1024;

export type TranscribeFailure = { ok: false; status: number; error: string };
export type TranscribeResult = { ok: true; text: string } | TranscribeFailure;

/** IA do escritório já conferida: ligada, com chave e com um provedor que transcreve. */
export interface TranscriptionAi {
  provider: string;
  apiKey: string;
  model: string | null;
}

/**
 * Lê a config da Central de I.A. do escritório e confere se ela pode transcrever.
 * Fica separada de `transcribeWithAi` para quem precisa conferir a IA antes de baixar
 * o áudio (a rota do WhatsApp faz assim desde antes da extração).
 */
export async function loadTranscriptionAi(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ ok: true; ai: TranscriptionAi } | TranscribeFailure> {
  const { data: ai } = await admin
    .from('organization_settings')
    .select('ai_enabled, ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('organization_id', organizationId)
    .single();

  const aiEnabled = typeof ai?.ai_enabled === 'boolean' ? ai.ai_enabled : true;
  if (!aiEnabled) {
    return { ok: false, status: 403, error: 'IA desativada pela organização. Um admin pode ativar em Configurações → Central de I.A.' };
  }
  const provider = (ai?.ai_provider ?? AIProviderConst.GOOGLE) as string;
  const apiKey: string | null =
    provider === AIProviderConst.GOOGLE
      ? (ai?.ai_google_key ?? null)
      : provider === AIProviderConst.OPENAI
        ? (ai?.ai_openai_key ?? null)
        : (ai?.ai_anthropic_key ?? null);
  if (!apiKey) {
    return { ok: false, status: 400, error: 'API key de IA não configurada. Configure em Configurações → Central de I.A.' };
  }
  if (provider === AIProviderConst.ANTHROPIC) {
    return {
      ok: false,
      status: 400,
      error: 'Transcrição de áudio não é suportada pela Anthropic. Use Google Gemini ou OpenAI em Configurações → Central de I.A.',
    };
  }
  return { ok: true, ai: { provider, apiKey, model: ai?.ai_model ?? null } };
}

/** Confere o tamanho do áudio e transcreve com a IA já conferida (Gemini ouve direto; OpenAI usa whisper-1). */
export async function transcribeWithAi(ai: TranscriptionAi, bytes: ArrayBuffer, rawMime: string): Promise<TranscribeResult> {
  if (bytes.byteLength === 0) return { ok: false, status: 400, error: 'O áudio está vazio' };
  if (bytes.byteLength > MAX_AUDIO_BYTES) {
    return { ok: false, status: 400, error: 'Áudio grande demais pra transcrever (limite 14MB)' };
  }
  let mime = (rawMime || '').split(';')[0].trim();
  if (!mime || !mime.startsWith('audio/')) mime = 'audio/ogg';

  let text = '';
  try {
    if (ai.provider === AIProviderConst.OPENAI) {
      const openai = createOpenAI({ apiKey: ai.apiKey });
      const result = await transcribe({
        model: openai.transcription('whisper-1'),
        audio: new Uint8Array(bytes),
      });
      text = (result.text || '').trim();
    } else {
      // Gemini ouve o áudio direto — mesmo default resolvido do ai/chat
      // (o fallback interno do getModel é o 1.5-flash, já APOSENTADO)
      const model = getModel(AIProviderConst.GOOGLE, ai.apiKey, ai.model || 'gemini-2.5-flash');
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
    console.error('[transcribeAudio] falha na IA:', e);
    return { ok: false, status: 502, error: `A IA não conseguiu transcrever: ${(e as Error).message}` };
  }

  if (!text) return { ok: false, status: 502, error: 'A IA não retornou transcrição pra este áudio' };
  return { ok: true, text };
}

/** Transcreve com a IA da Central de I.A. do escritório (Gemini ouve direto; OpenAI usa whisper-1). */
export async function transcribeAudio(input: {
  admin: SupabaseClient;
  organizationId: string;
  bytes: ArrayBuffer;
  mime: string;
}): Promise<TranscribeResult> {
  const loaded = await loadTranscriptionAi(input.admin, input.organizationId);
  if (!loaded.ok) return loaded;
  return transcribeWithAi(loaded.ai, input.bytes, input.mime);
}
