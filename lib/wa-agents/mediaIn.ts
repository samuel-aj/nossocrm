/**
 * Mídia que o LEAD manda: áudio, imagem, figurinha e documento viram TEXTO
 * antes de o agente responder, usando a IA do próprio agente (chave e modelo
 * dele). O texto é gravado em `wa_messages.transcription`, que é de onde
 * `messageText()` lê — o motor não muda, e o chat passa a mostrar o mesmo.
 *
 * Cada arquivo é processado UMA vez (a transcrição fica no banco). Nada aqui
 * lança: falha vira um evento na execução e a mensagem segue como "[áudio]".
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { generateText, experimental_transcribe as transcribe } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { getModel } from '@/lib/ai/config';
import { extractDocumentText } from './knowledge';
import { errorMessage } from './errors';
import { getOrganizationApiKey } from './model';
import type { WaMessageLite } from './context';
import type { AgentRow } from './types';

/** Linha de mensagem com o que precisamos para baixar e descrever a mídia. */
export type MediaMessageRow = WaMessageLite & { media_url?: string | null; media_mime?: string | null };

/** Colunas a mais que o motor precisa selecionar para esta etapa. */
export const MEDIA_MESSAGE_COLUMNS = 'media_url, media_mime';

/** Tetos por arquivo (o WhatsApp já limita, isto é a rede de proteção). */
const MAX_AUDIO_BYTES = 14 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DOC_BYTES = 10 * 1024 * 1024;
/** Texto de documento que entra no histórico (o resto é cortado). */
const MAX_DOC_CHARS = 4000;
/** Mídias processadas por resposta: segura o custo e o tempo da trava. */
export const MAX_MEDIA_PER_RUN = 3;

const IMAGE_PROMPT =
  'Descreva esta imagem para outro atendente que não pode vê-la. Diga o que aparece e, se houver texto ' +
  '(print de contrato, boleto, documento, comprovante), transcreva os dados importantes: valores, datas, ' +
  'nomes, números. Seja objetivo, em português do Brasil, sem preâmbulo.';

const STICKER_PROMPT =
  'Descreva esta figurinha em uma frase curta, em português do Brasil, dizendo o que ela mostra e que ' +
  'emoção ou intenção passa. Sem preâmbulo.';

const AUDIO_PROMPT =
  'Transcreva este áudio em português do Brasil. Responda SOMENTE com o texto falado, sem comentários, ' +
  'prefixos ou formatação.';

export type MediaUnderstanding = { audio: boolean; image: boolean; document: boolean };

/** Baixa o arquivo da mensagem (caminho no bucket privado wa-media ou URL). */
async function downloadMedia(
  admin: SupabaseClient,
  path: string
): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  if (/^https?:\/\//i.test(path)) {
    const res = await fetch(path, { cache: 'no-store' });
    if (!res.ok) return null;
    return { bytes: await res.arrayBuffer(), mime: (res.headers.get('content-type') ?? '').split(';')[0].trim() };
  }
  const { data, error } = await admin.storage.from('wa-media').download(path);
  if (error || !data) return null;
  return { bytes: await data.arrayBuffer(), mime: (data.type ?? '').split(';')[0].trim() };
}

/** Nome do arquivo a partir do caminho no bucket ('' quando não dá). */
function fileName(path: string): string {
  const base = (path || '').split('/').pop() ?? '';
  return base.replace(/^[0-9a-f-]{36}[_-]?/i, '').trim();
}

/**
 * Áudio -> texto. OpenAI usa whisper-1; Google ouve o arquivo direto. Anthropic
 * não transcreve áudio: devolve null (a mensagem segue como "[áudio]").
 */
async function transcribeAudio(
  provider: AgentRow['provider'],
  apiKey: string,
  modelId: string,
  bytes: ArrayBuffer,
  mime: string
): Promise<string | null> {
  if (provider === 'anthropic') return null;
  if (provider === 'openai') {
    const openai = createOpenAI({ apiKey });
    const result = await transcribe({ model: openai.transcription('whisper-1'), audio: new Uint8Array(bytes) });
    return (result.text || '').trim() || null;
  }
  const result = await generateText({
    model: getModel('google', apiKey, modelId || 'gemini-2.5-flash'),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'file', data: bytes, mediaType: mime || 'audio/ogg' },
          { type: 'text', text: AUDIO_PROMPT },
        ],
      },
    ],
  });
  return (result.text || '').trim() || null;
}

/** Imagem/figurinha -> descrição, com o modelo do próprio agente (os três provedores enxergam imagem). */
async function describeImage(
  provider: AgentRow['provider'],
  apiKey: string,
  modelId: string,
  bytes: ArrayBuffer,
  mime: string,
  sticker: boolean,
  caption: string
): Promise<string | null> {
  const pergunta = sticker ? STICKER_PROMPT : IMAGE_PROMPT;
  const texto = caption.trim() ? `${pergunta}\n\nO lead mandou junto: "${caption.trim()}"` : pergunta;
  const result = await generateText({
    model: getModel(provider, apiKey, modelId),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: new Uint8Array(bytes), mediaType: mime || 'image/jpeg' },
          { type: 'text', text: texto },
        ],
      },
    ],
  });
  return (result.text || '').trim() || null;
}

/** Texto que substitui o marcador da mídia no histórico do agente. */
export function mediaSummaryText(kind: string, content: string, name: string, caption: string): string {
  const legenda = caption.trim() ? ` Legenda do lead: "${caption.trim()}"` : '';
  if (kind === 'audio') return content;
  if (kind === 'image') return `[imagem] ${content}${legenda}`;
  if (kind === 'sticker') return `[figurinha] ${content}`;
  return `[documento${name ? `: ${name}` : ''}] ${content}${legenda}`;
}

/**
 * Transforma em texto as mídias das mensagens informadas (as que ainda não têm
 * transcrição) e devolve as linhas atualizadas. Nunca lança.
 */
export async function understandMedia(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    agent: AgentRow;
    messages: MediaMessageRow[];
    onEvent?: (type: string, data: Record<string, unknown>) => void;
  }
): Promise<MediaMessageRow[]> {
  const { organizationId, agent, messages, onEvent } = input;
  const cfg = agent.media_understanding;
  const querAlgo = cfg.audio || cfg.image || cfg.document;
  if (!querAlgo) return messages;

  const pendentes = messages.filter(
    m => m.media_type && !(m.transcription ?? '').trim() && (m as MediaMessageRow).media_url
  );
  if (pendentes.length === 0) return messages;

  let apiKey = '';
  try {
    apiKey = (agent.api_key ?? '').trim() || (await getOrganizationApiKey(admin, organizationId, agent.provider));
  } catch {
    apiKey = '';
  }
  if (!apiKey) {
    onEvent?.('media_skipped', { motivo: 'sem chave de IA' });
    return messages;
  }

  const prontos = new Map<string, string>();
  for (const msg of pendentes.slice(0, MAX_MEDIA_PER_RUN)) {
    const kind = msg.media_type as string;
    const quer =
      kind === 'audio' ? cfg.audio : kind === 'image' || kind === 'sticker' ? cfg.image : kind === 'document' ? cfg.document : false;
    if (!quer) continue;

    try {
      const baixado = await downloadMedia(admin, msg.media_url as string);
      if (!baixado || baixado.bytes.byteLength === 0) {
        onEvent?.('media_error', { id: msg.id, tipo: kind, erro: 'arquivo não encontrado' });
        continue;
      }
      const mime = (msg.media_mime || baixado.mime || '').split(';')[0].trim();
      const tamanho = baixado.bytes.byteLength;
      const caption = (msg.body ?? '').trim();
      let texto: string | null = null;

      if (kind === 'audio') {
        if (tamanho > MAX_AUDIO_BYTES) throw new Error('áudio grande demais');
        texto = await transcribeAudio(agent.provider, apiKey, agent.model, baixado.bytes, mime);
        if (!texto && agent.provider === 'anthropic') {
          onEvent?.('media_skipped', { id: msg.id, tipo: kind, motivo: 'Anthropic não transcreve áudio' });
          continue;
        }
      } else if (kind === 'image' || kind === 'sticker') {
        if (tamanho > MAX_IMAGE_BYTES) throw new Error('imagem grande demais');
        texto = await describeImage(agent.provider, apiKey, agent.model, baixado.bytes, mime, kind === 'sticker', caption);
      } else if (kind === 'document') {
        if (tamanho > MAX_DOC_BYTES) throw new Error('documento grande demais');
        const bruto = await extractDocumentText(Buffer.from(baixado.bytes), mime, fileName(msg.media_url as string));
        texto = bruto.length > MAX_DOC_CHARS ? `${bruto.slice(0, MAX_DOC_CHARS)}…` : bruto;
      }

      if (!texto) {
        onEvent?.('media_error', { id: msg.id, tipo: kind, erro: 'sem conteúdo entendido' });
        continue;
      }
      const final = mediaSummaryText(kind, texto, fileName(msg.media_url as string), caption);
      prontos.set(msg.id, final);
      // Cacheia: a próxima resposta (e o chat) já leem daqui
      await admin.from('wa_messages').update({ transcription: final }).eq('id', msg.id).eq('organization_id', organizationId);
      onEvent?.('media_understood', { id: msg.id, tipo: kind, caracteres: final.length });
    } catch (e) {
      onEvent?.('media_error', { id: msg.id, tipo: kind, erro: errorMessage(e) });
    }
  }

  if (prontos.size === 0) return messages;
  return messages.map(m => (prontos.has(m.id) ? { ...m, transcription: prontos.get(m.id) as string } : m));
}
