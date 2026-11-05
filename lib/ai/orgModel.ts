/**
 * IA da organização para tarefas do CRM fora do chat (preencher contrato,
 * transcrever ligação): qual modelo usar e quem transcreve áudio.
 *
 * Ordem da chave: a do provedor escolhido em Central de I.A.; sem ela, a de
 * outro provedor que a organização cadastrou; sem nenhuma, a de um agente de
 * IA da organização. Nunca sai para o navegador.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { experimental_transcribe as transcribe, generateText, type LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getModel, type AIProvider } from '@/lib/ai/config';

export type OrgAi = { provider: AIProvider; modelId: string; model: LanguageModel };

/** Áudio -> texto (null quando não saiu nada). */
export type Transcriber = (bytes: Uint8Array, mime: string) => Promise<string | null>;

const DEFAULT_MODEL: Record<AIProvider, string> = {
  openai: 'gpt-4.1',
  google: 'gemini-2.5-flash',
  anthropic: 'claude-sonnet-4-5',
};
const KEY_COLUMN: Record<AIProvider, 'ai_openai_key' | 'ai_google_key' | 'ai_anthropic_key'> = {
  openai: 'ai_openai_key',
  google: 'ai_google_key',
  anthropic: 'ai_anthropic_key',
};
const PROVIDERS: AIProvider[] = ['openai', 'google', 'anthropic'];

type Keys = { configured: AIProvider | null; model: string; byProvider: Partial<Record<AIProvider, string>>; audio: string };

async function loadKeys(admin: SupabaseClient, orgId: string): Promise<Keys> {
  const [{ data: settings }, { data: agents }] = await Promise.all([
    admin.from('organization_settings').select('ai_provider, ai_model, ai_openai_key, ai_google_key, ai_anthropic_key').eq('organization_id', orgId).maybeSingle(),
    admin.from('wa_ai_agents').select('provider, api_key, audio_api_key').eq('organization_id', orgId).limit(20),
  ]);
  const s = (settings ?? {}) as Record<string, string | null>;
  const byProvider: Partial<Record<AIProvider, string>> = {};
  for (const p of PROVIDERS) {
    const k = (s[KEY_COLUMN[p]] ?? '').trim();
    if (k) byProvider[p] = k;
  }
  let audio = '';
  for (const a of (agents ?? []) as Array<{ provider?: string | null; api_key?: string | null; audio_api_key?: string | null }>) {
    const p = a.provider as AIProvider;
    const k = (a.api_key ?? '').trim();
    if (PROVIDERS.includes(p) && k && !byProvider[p]) byProvider[p] = k;
    if (!audio && (a.audio_api_key ?? '').trim()) audio = (a.audio_api_key ?? '').trim();
  }
  const configured = PROVIDERS.includes(s.ai_provider as AIProvider) ? (s.ai_provider as AIProvider) : null;
  return { configured, model: (s.ai_model ?? '').trim(), byProvider, audio };
}

/** Modelo de texto da organização; null quando ela não cadastrou nenhuma chave. */
export async function loadOrgAi(admin: SupabaseClient, orgId: string): Promise<OrgAi | null> {
  const keys = await loadKeys(admin, orgId);
  const provider = keys.configured && keys.byProvider[keys.configured] ? keys.configured : PROVIDERS.find((p) => keys.byProvider[p]);
  if (!provider) return null;
  // O modelo da Central de I.A. só vale para o provedor de lá
  const modelId = provider === keys.configured && keys.model ? keys.model : DEFAULT_MODEL[provider];
  return { provider, modelId, model: getModel(provider, keys.byProvider[provider] as string, modelId) };
}

/**
 * Quem transcreve áudio na organização: o whisper-1 da OpenAI (chave de áudio
 * de um agente ou a chave da OpenAI) ou o Gemini do Google. A Anthropic não
 * ouve áudio. null quando não há como.
 */
export async function loadOrgTranscriber(admin: SupabaseClient, orgId: string): Promise<Transcriber | null> {
  const keys = await loadKeys(admin, orgId);
  const whisperKey = keys.audio || keys.byProvider.openai || '';
  if (whisperKey) {
    const openai = createOpenAI({ apiKey: whisperKey });
    return async (bytes) => {
      const result = await transcribe({ model: openai.transcription('whisper-1'), audio: bytes, maxRetries: 1 });
      return (result.text || '').trim() || null;
    };
  }
  const googleKey = keys.byProvider.google;
  if (googleKey) {
    const model = getModel('google', googleKey, 'gemini-2.5-flash');
    return async (bytes, mime) => {
      const result = await generateText({
        model,
        maxRetries: 1,
        maxOutputTokens: 8000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'file', data: bytes, mediaType: mime || 'audio/mpeg' },
              { type: 'text', text: 'Transcreva este áudio em português do Brasil. Responda SOMENTE com o texto falado, sem comentários. Se houver duas pessoas, comece cada fala numa linha nova.' },
            ],
          },
        ],
      });
      return (result.text || '').trim() || null;
    };
  }
  return null;
}
