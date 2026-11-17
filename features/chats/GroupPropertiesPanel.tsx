'use client';

import React, { useEffect, useState } from 'react';
import { Camera, Users, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GroupProperties } from '@/lib/whatsapp/groups';

type Field = 'subject' | 'description' | 'photo';
const inputClass = 'w-full rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-white/15';
const saveClass = 'rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-45';

export function GroupPropertiesPanel({ conversationId, avatarUrl, onClose }: { conversationId: string; avatarUrl?: string | null; onClose: () => void }) {
  const client = useQueryClient();
  const key = ['waGroupProperties', conversationId];
  const path = '/api/whatsapp/groups/properties?conversationId=' + encodeURIComponent(conversationId);
  const query = useQuery<GroupProperties>({
    queryKey: key, staleTime: 20_000, retry: false,
    queryFn: async ({ signal }) => {
      const res = await fetch(path, { credentials: 'include', signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Não foi possível consultar o grupo.');
      return body;
    },
  });
  const [field, setField] = useState<Field | null>(null);
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [notice, setNotice] = useState('');
  const [fileError, setFileError] = useState('');
  useEffect(() => {
    if (!photo) { setPreview(''); return; }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const mutation = useMutation({
    mutationFn: async (change: { field: Field; value: File | string }) => {
      const form = new FormData();
      form.set('field', change.field);
      form.set('value', change.value);
      const res = await fetch(path, { method: 'PATCH', credentials: 'include', body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Não foi possível salvar. Atualize o grupo para conferir.');
      return body as { pending?: boolean; warning?: string };
    },
    onSuccess: (body, change) => {
      setField(null); setPhoto(null);
      setNotice(body.warning || (body.pending ? 'Alteração solicitada ao WhatsApp.' : 'Alteração salva no WhatsApp.'));
      if (!body.pending && change.field !== 'photo') {
        client.setQueryData<GroupProperties>(key, old => old && ({ ...old, [change.field]: change.value }));
      }
      void client.invalidateQueries({ queryKey: key });
      void client.invalidateQueries({ queryKey: ['waConversations'] });
      void client.invalidateQueries({ queryKey: ['waChat'] });
    },
  });
  const begin = (next: Field) => {
    mutation.reset(); setFileError(''); setNotice(''); setPhoto(null);
    setDraft(next === 'photo' ? '' : query.data?.[next] || '');
    setField(next);
  };
  const properties = query.data;
  const busy = mutation.isPending;
  const picture = preview || properties?.pictureUrl || avatarUrl;
  const labels = { subject: 'Nome do grupo', description: 'Descrição', photo: 'Foto do grupo' };
  return <section className="flex h-full flex-col" aria-label="Propriedades do grupo">
    <header className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-white/10">
      <h2 className="font-bold">Propriedades do grupo</h2>
      <button type="button" aria-label="Fechar propriedades do grupo" className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-white/10" onClick={onClose}><X size={16} /></button>
    </header>
    <div className="min-h-0 space-y-5 overflow-y-auto p-4">
      {query.isLoading && <p role="status" className="text-sm">Consultando grupo…</p>}
      {query.isError && <div role="alert" className="text-sm">{query.error.message} <button className="underline" type="button" onClick={() => void query.refetch()}>Tentar novamente</button></div>}
      {properties && <>
        <div className="flex items-center gap-3">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-100 text-emerald-700">
            {picture ? /* eslint-disable-next-line @next/next/no-img-element */
              <img src={picture} alt="Foto do grupo" className="h-full w-full object-cover" /> : <Users size={24} />}
          </span>
          <button type="button" onClick={() => begin('photo')} disabled={!!field} className="flex items-center gap-2 text-sm font-semibold text-primary-600 disabled:opacity-50"><Camera size={16} /> Alterar foto</button>
        </div>
        {(['subject', 'description'] as const).map(item => <div key={item}>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold">{labels[item]}</span>
            {field !== item && <button aria-label={'Editar ' + labels[item].toLowerCase()} type="button" className="text-xs font-semibold text-primary-600 disabled:opacity-50" disabled={!!field} onClick={() => begin(item)}>Editar</button>}
          </div>
          {field === item ? item === 'subject'
            ? <input autoFocus aria-label={labels[item]} value={draft} onChange={e => setDraft(e.target.value)} maxLength={128} disabled={busy} className={inputClass} />
            : <textarea autoFocus aria-label={labels[item]} value={draft} onChange={e => setDraft(e.target.value)} maxLength={2048} rows={4} disabled={busy} className={inputClass} />
            : <p className="whitespace-pre-wrap break-words text-sm">{properties[item] || 'Sem descrição'}</p>}
        </div>)}
        {field === 'photo' && <label className="block text-sm font-semibold">Escolher foto <span className="font-normal text-slate-500">(JPG ou PNG, até 3 MB)</span>
          <input type="file" accept="image/jpeg,image/png" disabled={busy} className="mt-2 w-full text-xs" onChange={e => {
            const file = e.target.files?.[0] ?? null;
            const invalid = file && (file.size > 3 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(file.type));
            setFileError(invalid ? 'Escolha uma imagem JPG ou PNG de até 3 MB.' : '');
            setPhoto(invalid ? null : file);
          }} /></label>}
        {field && <div className="flex justify-end gap-3">
          <button type="button" disabled={busy} className="text-sm" onClick={() => { setField(null); setPhoto(null); setFileError(''); mutation.reset(); }}>Cancelar</button>
          <button type="button" className={saveClass} disabled={busy || (field === 'photo' ? !photo : draft.trim() === properties[field] || (field === 'subject' && !draft.trim()))}
            onClick={() => mutation.mutate({ field, value: field === 'photo' ? photo! : draft.trim() })}>{busy ? 'Salvando…' : 'Salvar'}</button>
        </div>}
      </>}
      {fileError && <p role="alert" className="text-sm text-red-600">{fileError}</p>}
      {mutation.error && <p role="alert" className="text-sm text-red-600">{mutation.error.message}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
    </div>
  </section>;
}
