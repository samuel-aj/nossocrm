import React, { useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
export function DeleteMessageModal({ onConfirm, onClose, simulated = false }: {
  onConfirm: () => Promise<unknown>; onClose: () => void; simulated?: boolean;
}) {
  const gate = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Modal isOpen title="Excluir mensagem?" size="md" onClose={() => { if (!gate.current) onClose(); }}>
    <p className="text-sm text-slate-600 dark:text-slate-300">{simulated ? 'A mensagem será excluída apenas nesta demonstração.' : 'A exclusão será solicitada para todos no WhatsApp. Esta ação não pode ser desfeita.'}</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
    <div className="mt-5 flex justify-end gap-2">
      <button type="button" disabled={busy} onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-600 dark:text-slate-300">Cancelar</button>
      <button type="button" disabled={busy} className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50" onClick={async () => {
        if (gate.current) return;
        gate.current = true; setBusy(true); setError('');
        try { await onConfirm(); onClose(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível excluir.'); }
        finally { gate.current = false; setBusy(false); }
      }}>{busy ? 'Excluindo…' : 'Excluir para todos'}</button>
    </div>
  </Modal>;
}
