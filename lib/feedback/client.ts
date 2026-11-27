import { supabase } from '@/lib/supabase/client';
import { FEEDBACK_BUCKET, type AttachmentKind } from './constants';

export interface UploadedAttachment { path: string; kind: AttachmentKind; mime: string; size: number }

/** Pede a URL assinada e sobe o arquivo direto para o bucket privado. */
export async function uploadFeedbackFile(file: Blob, fileName: string, kind: AttachmentKind): Promise<UploadedAttachment> {
  const mime = (file.type || 'application/octet-stream').split(';')[0].trim();
  const res = await fetch('/api/feedback/uploads', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, mime, size: file.size, kind }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Não foi possível enviar o arquivo.');
  const { path, token } = body as { path: string; token: string };
  const { error } = await supabase.storage.from(FEEDBACK_BUCKET).uploadToSignedUrl(path, token, file, { contentType: mime });
  if (error) throw new Error('Não foi possível enviar o arquivo.');
  return { path, kind, mime, size: file.size };
}

export async function transcribeFeedbackAudio(path: string): Promise<string> {
  const res = await fetch('/api/feedback/transcribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || 'Não foi possível transcrever o áudio.');
  return (body as { transcript: string }).transcript;
}
