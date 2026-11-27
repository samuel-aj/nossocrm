'use client';

import { useCallback, useRef, useState } from 'react';
import { Mic, Paperclip, Send, Square, X, Loader2 } from 'lucide-react';
import { useCreateFeedback } from '@/lib/query/hooks';
import { useToast } from '@/context/ToastContext';
import { uploadFeedbackFile, transcribeFeedbackAudio, type UploadedAttachment } from '@/lib/feedback/client';
import { ALLOWED_MIME, FEEDBACK_KINDS, FEEDBACK_KIND_LABEL, FEEDBACK_LIMITS, type AttachmentKind, type FeedbackKind } from '@/lib/feedback/constants';
import { useAudioRecorder } from '../hooks/useAudioRecorder';

interface Item { key: string; name: string; kind: AttachmentKind; status: 'enviando' | 'pronto' | 'erro'; data?: UploadedAttachment }

const kindOf = (mime: string): AttachmentKind | null =>
  ALLOWED_MIME.image.includes(mime) ? 'image' : ALLOWED_MIME.audio.includes(mime) ? 'audio' : ALLOWED_MIME.file.includes(mime) ? 'file' : null;

const MAX_PER_KIND: Record<AttachmentKind, number> = {
  image: FEEDBACK_LIMITS.images, file: FEEDBACK_LIMITS.files, audio: FEEDBACK_LIMITS.audios,
};
const LIMIT_MESSAGE: Record<AttachmentKind, string> = {
  image: `Até ${FEEDBACK_LIMITS.images} imagens por envio.`,
  file: `Até ${FEEDBACK_LIMITS.files} arquivos por envio.`,
  audio: 'Só um áudio por envio.',
};

export function FeedbackComposer({ screenPath, onSent }: { screenPath: string; onSent?: () => void }) {
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const create = useCreateFeedback();
  const { addToast } = useToast();

  const addFiles = useCallback((files: File[]) => {
    // Conta o que já está na caixa (pronto ou ainda subindo) e o que entra neste lote.
    const used: Record<AttachmentKind, number> = { image: 0, file: 0, audio: 0 };
    for (const i of items) if (i.status !== 'erro') used[i.kind] += 1;
    const limitsHit = new Set<AttachmentKind>();
    const added: Item[] = [];
    for (const file of files) {
      const mime = (file.type || '').split(';')[0];
      const k = kindOf(mime);
      if (!k) { addToast(`${file.name}: tipo de arquivo não aceito.`, 'error'); continue; }
      if (file.size > FEEDBACK_LIMITS.bytes) { addToast(`${file.name}: maior que 10 MB.`, 'error'); continue; }
      if (used[k] >= MAX_PER_KIND[k]) { limitsHit.add(k); continue; }
      used[k] += 1;
      const key = `${file.name}-${crypto.randomUUID()}`;
      added.push({ key, name: file.name, kind: k, status: 'enviando' });
      uploadFeedbackFile(file, file.name, k)
        .then(data => setItems(prev => prev.map(i => i.key === key ? { ...i, status: 'pronto', data } : i)))
        .catch(() => {
          setItems(prev => prev.map(i => i.key === key ? { ...i, status: 'erro' } : i));
          addToast(`Não foi possível enviar ${file.name}.`, 'error');
        });
    }
    if (added.length) setItems(prev => [...prev, ...added]);
    for (const k of limitsHit) addToast(LIMIT_MESSAGE[k], 'error');
  }, [items, addToast]);

  const onAudio = useCallback(async (blob: Blob) => {
    const key = `audio-${crypto.randomUUID()}`;
    const name = 'audio.mp3';
    // Uma gravação nova substitui o áudio que já estava na caixa.
    setItems(prev => [...prev.filter(i => i.kind !== 'audio'), { key, name, kind: 'audio', status: 'enviando' }]);
    let data: UploadedAttachment;
    try {
      data = await uploadFeedbackFile(blob, name, 'audio');
    } catch {
      setItems(prev => prev.map(i => i.key === key ? { ...i, status: 'erro' } : i));
      addToast('Não foi possível enviar o áudio.', 'error');
      return;
    }
    setItems(prev => prev.map(i => i.key === key ? { ...i, status: 'pronto', data } : i));
    // Sem transcrição o áudio continua pronto: a esteira transcreve depois.
    setTranscribing(true);
    try {
      setTranscript(await transcribeFeedbackAudio(data.path));
    } catch {
      addToast('Não deu para transcrever agora. O áudio vai junto mesmo assim.', 'info');
    } finally {
      setTranscribing(false);
    }
  }, [addToast]);
  const recorder = useAudioRecorder(onAudio);

  const ready = items.filter(i => i.status === 'pronto' && i.data).map(i => i.data!);
  const uploading = items.some(i => i.status === 'enviando') || transcribing;
  const hasContent = body.trim().length > 0 || (transcript ?? '').trim().length > 0 || ready.length > 0;

  const submit = async () => {
    if (!hasContent || uploading || create.isPending) return;
    try {
      await create.mutateAsync({ kind, body: body.trim(), transcript: transcript?.trim() || null, screenPath, attachments: ready });
      setBody(''); setKind(null); setItems([]); setTranscript(null);
      addToast('Pedido enviado. Você acompanha em Ajustes.', 'success');
      onSent?.();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Não foi possível enviar.', 'error');
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/5"
      onDragOver={e => e.preventDefault()}
      onDrop={e => { e.preventDefault(); addFiles(Array.from(e.dataTransfer.files)); }}>
      <textarea aria-label="Descreva o ajuste" value={body} rows={4}
        onChange={e => setBody(e.target.value.slice(0, FEEDBACK_LIMITS.bodyChars))}
        onPaste={e => { const files = Array.from(e.clipboardData?.files ?? []); if (files.length) { e.preventDefault(); addFiles(files); } }}
        placeholder="Conte o que aconteceu ou o que você quer melhorar. Pode colar prints aqui."
        className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-white/10 dark:bg-black/20 dark:text-white" />

      {transcript !== null && (
        <label className="block text-xs text-slate-500">Transcrição do áudio (pode corrigir)
          <textarea value={transcript} rows={3} onChange={e => setTranscript(e.target.value.slice(0, FEEDBACK_LIMITS.transcriptChars))}
            className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-white/10 dark:bg-black/20 dark:text-white" />
        </label>
      )}

      {items.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {items.map(i => (
            <li key={i.key} className="flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs dark:bg-white/10">
              {i.status === 'enviando' && <Loader2 className="h-3 w-3 animate-spin" />}
              <span className={i.status === 'erro' ? 'text-red-600' : ''}>{i.name}</span>
              <button type="button" aria-label={`Remover ${i.name}`} onClick={() => setItems(prev => prev.filter(x => x.key !== i.key))}><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FEEDBACK_KINDS.map(k => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}
            className={`rounded-full border px-3 py-1 text-xs ${kind === k ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-200 dark:border-white/10'}`}>
            {FEEDBACK_KIND_LABEL[k]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <input ref={fileInput} type="file" multiple aria-label="Anexar arquivos" className="hidden"
            accept={[...ALLOWED_MIME.image, ...ALLOWED_MIME.file].join(',')}
            onChange={e => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
          <button type="button" aria-label="Escolher arquivos" onClick={() => fileInput.current?.click()} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><Paperclip className="h-4 w-4" /></button>
          {recorder.recording
            ? <button type="button" onClick={recorder.stop} className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-2 text-xs text-white"><Square className="h-3 w-3" />{recorder.seconds}s</button>
            : <button type="button" aria-label="Gravar áudio" onClick={() => recorder.start().catch(() => addToast('Libere o microfone para gravar.', 'error'))} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10"><Mic className="h-4 w-4" /></button>}
          <button type="button" onClick={submit} disabled={!hasContent || uploading || create.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
            <Send className="h-4 w-4" />{create.isPending ? 'Enviando...' : 'Enviar'}
          </button>
        </div>
      </div>
    </div>
  );
}
