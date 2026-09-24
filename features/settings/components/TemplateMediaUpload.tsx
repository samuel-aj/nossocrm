'use client';
import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase/client';
import { TEMPLATE_MEDIA_BUCKET, TEMPLATE_MEDIA_RULES, validateTemplateMedia, type TemplateHeaderType } from '@/lib/templateMedia';

export function TemplateMediaUpload({ type, connectionId, templateId, onUploaded, onBusy }: {
  type: TemplateHeaderType; connectionId: string; templateId?: string;
  onUploaded: (id: string) => void; onBusy?: (busy: boolean) => void;
}) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState('');
  async function post(body: unknown) {
    const res = await fetch('/api/message-templates/media', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha no upload');
    return data;
  }
  async function upload(file: File) {
    setError(''); setBusy(true); onBusy?.(true);
    try {
      validateTemplateMedia(type, file.type, file.size);
      const prepared = await post({ action: 'prepare', connectionId, headerType: type, fileName: file.name, mimeType: file.type, size: file.size });
      const { error } = await supabase.storage.from(TEMPLATE_MEDIA_BUCKET).uploadToSignedUrl(prepared.path, prepared.token, file, { contentType: file.type });
      if (error) throw new Error('Falha ao enviar o arquivo. Tente novamente.');
      const completed = await post({ action: 'complete', connectionId, mediaId: prepared.mediaId, ...(templateId ? { templateId } : {}) });
      setPreview(completed.previewUrl); setName(file.name);
      if (mounted.current) onUploaded(completed.mediaId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha no upload'); }
    finally { setBusy(false); if (mounted.current) onBusy?.(false); }
  }
  async function openPreview() {
    setError('');
    try {
      const response = await fetch(`/api/message-templates/media?templateId=${encodeURIComponent(templateId || '')}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Prévia indisponível');
      setPreview(data.previewUrl); setName(data.fileName);
    } catch (e) { setError(e instanceof Error ? e.message : 'Prévia indisponível'); }
  }
  return <div className="space-y-2 text-sm">
    {templateId && <button type="button" className="underline text-xs" onClick={() => void openPreview()}>Ver arquivo vinculado</button>}
    <label className="block">{templateId ? 'Arquivo para envio' : 'Arquivo de amostra e envio'}
      <input aria-label="Arquivo do modelo" type="file" accept={TEMPLATE_MEDIA_RULES[type].accept} disabled={busy || !connectionId}
        className="block w-full my-2" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ''; }} />
    </label>
    <p className="text-xs text-slate-500">{TEMPLATE_MEDIA_RULES[type].label}. {templateId ? 'Este arquivo acompanhará os próximos envios.' : 'A Meta receberá este arquivo como amostra ao criar o modelo.'}</p>
    {busy && <p role="status">Enviando e validando arquivo…</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {preview && <div>
      {type === 'image' ? <Image src={preview} alt="Prévia da mídia do modelo" width={320} height={160} unoptimized className="max-h-40 w-auto rounded object-contain" />
        : type === 'video' ? <video src={preview} controls className="max-h-40 rounded" />
        : <a href={preview} target="_blank" rel="noreferrer" className="underline">Abrir PDF: {name}</a>}
      <p className="text-xs">{name} — pronto para usar</p>
    </div>}
  </div>;
}
