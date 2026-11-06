/**
 * Transcrição das ligações feitas pelo CRM (API4com): baixa a gravação
 * (`record_url`, que redireciona para o MP3; HEAD responde 404, então é GET) e
 * transcreve com a IA da organização. O texto fica em
 * `api4com_calls.metadata.transcript`, uma vez por ligação, e é lido pela IA
 * que preenche o contrato.
 *
 * Duas portas: logo depois do fim da ligação (webhook) e, se ainda não houver
 * texto, na hora em que alguém pede o preenchimento. Nada aqui lança.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadOrgTranscriber, type Transcriber } from '@/lib/ai/orgModel';
import { findCallForPayload, type WebhookPayload } from './calls';

/** Ligações curtas demais não têm o que transcrever. */
export const MIN_TRANSCRIBE_SECONDS = 8;
/** O Whisper aceita até 25 MB; a gravação da API4com tem ~5 KB/s (cerca de 1 h). */
const MAX_RECORDING_BYTES = 24 * 1024 * 1024;
/** Texto guardado por ligação (o resto é cortado). */
const MAX_TRANSCRIPT_CHARS = 30_000;

export type CallTranscript = { text: string; at: string };

export type CallForTranscript = {
  id: string;
  record_url: string | null;
  duration: number | null;
  metadata: Record<string, unknown> | null;
};

export type TranscriptDeps = { fetch?: typeof fetch; now?: () => Date };

export function savedTranscript(metadata: Record<string, unknown> | null | undefined): CallTranscript | null {
  const t = (metadata as { transcript?: unknown } | null)?.transcript as { text?: unknown; at?: unknown } | undefined;
  return t && typeof t.text === 'string' && t.text.trim() ? { text: t.text, at: typeof t.at === 'string' ? t.at : '' } : null;
}

/** Baixa a gravação (só https da API4com). null quando não deu. */
export async function downloadRecording(url: string, deps: TranscriptDeps = {}): Promise<{ bytes: Uint8Array; mime: string } | { error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'endereço da gravação inválido' };
  }
  if (parsed.protocol !== 'https:' || !/(^|\.)api4com\.com$/i.test(parsed.hostname)) return { error: 'gravação fora da API4com' };
  const doFetch = deps.fetch ?? fetch;
  const res = await doFetch(url, { redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return { error: res.status === 404 ? 'a gravação ainda não está disponível' : `a gravação respondeu ${res.status}` };
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_RECORDING_BYTES) return { error: 'gravação grande demais para transcrever' };
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.byteLength) return { error: 'gravação vazia' };
  if (bytes.byteLength > MAX_RECORDING_BYTES) return { error: 'gravação grande demais para transcrever' };
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
  return { bytes, mime: mime.startsWith('audio/') ? mime : 'audio/mpeg' };
}

/**
 * Texto da ligação: o já guardado ou, se houver gravação, transcreve agora e
 * guarda. Devolve também o motivo quando não há texto.
 */
export async function ensureCallTranscript(
  admin: SupabaseClient,
  orgId: string,
  call: CallForTranscript,
  transcriber: Transcriber | null,
  deps: TranscriptDeps = {}
): Promise<{ text: string | null; note: string | null }> {
  const saved = savedTranscript(call.metadata);
  if (saved) return { text: saved.text, note: null };
  if (!call.record_url) return { text: null, note: 'ligação sem gravação' };
  if ((call.duration ?? 0) < MIN_TRANSCRIBE_SECONDS) return { text: null, note: 'ligação curta demais' };
  if (!transcriber) return { text: null, note: 'a organização não tem chave de IA que transcreva áudio (OpenAI ou Google)' };
  try {
    const file = await downloadRecording(call.record_url, deps);
    if ('error' in file) return { text: null, note: file.error };
    const raw = await transcriber(file.bytes, file.mime);
    const text = (raw ?? '').trim().slice(0, MAX_TRANSCRIPT_CHARS);
    if (!text) return { text: null, note: 'a transcrição veio vazia' };
    const at = (deps.now?.() ?? new Date()).toISOString();
    // Relê o metadata para não apagar o que o webhook gravou nesse meio-tempo
    const { data: fresh } = await admin.from('api4com_calls').select('metadata').eq('id', call.id).eq('organization_id', orgId).maybeSingle();
    const metadata = { ...((fresh as { metadata?: Record<string, unknown> | null } | null)?.metadata ?? call.metadata ?? {}), transcript: { text, at } };
    await admin.from('api4com_calls').update({ metadata, updated_at: at }).eq('id', call.id).eq('organization_id', orgId);
    return { text, note: null };
  } catch (err) {
    return { text: null, note: err instanceof Error ? err.message : 'falha ao transcrever' };
  }
}

export type DealCallText = { id: string; at: string; called: string; duration: number; text: string | null; note: string | null };

/** As ligações mais recentes do lead que tiveram conversa, com o texto de cada uma. */
export async function loadDealCallTranscripts(
  admin: SupabaseClient,
  orgId: string,
  dealId: string,
  transcriber: Transcriber | null,
  opts: { limit?: number } & TranscriptDeps = {}
): Promise<DealCallText[]> {
  const { data } = await admin
    .from('api4com_calls')
    .select('id, called, started_at, duration, record_url, metadata')
    .eq('organization_id', orgId)
    .eq('deal_id', dealId)
    .gt('duration', 0)
    .order('started_at', { ascending: false })
    .limit(opts.limit ?? 4);
  const rows = (data ?? []) as Array<CallForTranscript & { called: string; started_at: string }>;
  const out: DealCallText[] = [];
  for (const row of rows) {
    const r = await ensureCallTranscript(admin, orgId, row, transcriber, opts);
    out.push({ id: row.id, at: row.started_at, called: row.called, duration: row.duration ?? 0, text: r.text, note: r.note });
  }
  return out;
}

/**
 * Logo depois do fim da ligação (webhook): transcreve se a organização tem
 * como. A gravação às vezes demora alguns segundos para ficar pronta, então
 * tenta de novo uma vez. Sem sucesso, o preenchimento tenta de novo depois.
 */
export async function transcribeAfterHangup(admin: SupabaseClient, orgId: string, payload: WebhookPayload, deps: TranscriptDeps & { wait?: (ms: number) => Promise<void> } = {}): Promise<void> {
  try {
    const row = await findCallForPayload(admin, orgId, payload);
    if (!row || !row.deal_id) return;
    const transcriber = await loadOrgTranscriber(admin, orgId);
    if (!transcriber) return;
    const call: CallForTranscript = { id: row.id, record_url: row.record_url ?? payload.recordUrl ?? null, duration: row.duration ?? null, metadata: (row.metadata as Record<string, unknown> | null) ?? null };
    const first = await ensureCallTranscript(admin, orgId, call, transcriber, deps);
    if (first.text || first.note !== 'a gravação ainda não está disponível') return;
    await (deps.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(15_000);
    await ensureCallTranscript(admin, orgId, call, transcriber, deps);
  } catch (err) {
    console.error('[api4com/transcript] falha ao transcrever depois da ligação', err);
  }
}
