import React, { useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import type { WaChatMessage } from './useWhatsAppChat';

export function EditMessageModal({ message, onSave, onClose }: {
  message: WaChatMessage;
  onSave: (input: { messageId: string; text: string }) => Promise<unknown>;
  onClose: () => void;
}) {
  const [text, setText] = useState(message.body || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useRef(false);
  return <Modal isOpen title="Editar mensagem" size="md" onClose={() => { if (!gate.current) onClose(); }}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault();
      if (gate.current || !text.trim()) return;
      gate.current = true; setBusy(true); setError('');
      try { await onSave({ messageId: message.id, text: text.trim() }); onClose(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível editar.'); }
      finally { gate.current = false; setBusy(false); }
    }}>
      <textarea aria-label="Texto da mensagem" value={text} onChange={event => setText(event.target.value)}
        disabled={busy} maxLength={4096} rows={4} autoFocus
        className="w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 focus:ring-2 focus:ring-emerald-500 dark:border-white/15 dark:bg-slate-900 dark:text-white" />
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-600 dark:text-slate-300">Cancelar</button>
        <button type="submit" disabled={busy || !text.trim() || text.trim() === message.body} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </form>
  </Modal>;
}
