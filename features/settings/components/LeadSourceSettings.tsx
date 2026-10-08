'use client';

import React, { useState } from 'react';
import { MapPin, Plus, RotateCcw, X } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useOrgPreferences } from '@/lib/query/hooks/useOrgPreferences';
import { normalizeLeadSource } from '@/lib/deals/leadSource';
import { SETTINGS_BTN_PRIMARY, SETTINGS_INPUT_CLASS, SettingsCard } from './SettingsUi';

export function LeadSourceSettings() {
  const { profile, organizationId } = useAuth();
  // Reset unsaved categories when the active organization changes.
  return <LeadSourceSettingsForm key={organizationId} canEdit={profile?.role === 'admin' || profile?.role === 'super_admin'} />;
}

function LeadSourceSettingsForm({ canEdit }: { canEdit: boolean }) {
  const { leadSourceOptions, isLoading, isError, setLeadSourceOptions } = useOrgPreferences();
  const { addToast } = useToast();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [newSource, setNewSource] = useState('');
  const options = draft ?? leadSourceOptions;
  const busy = setLeadSourceOptions.isPending;
  const add = () => {
    const value = normalizeLeadSource(newSource);
    if (!canEdit || busy || !value || options.length >= 50) return;
    const key = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (key === 'nao informado' || options.some(option => option.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === key)) {
      addToast('Essa origem já está disponível.', 'info');
      return;
    }
    setDraft([...options, value]);
    setNewSource('');
  };
  const save = async (next: string[] | null) => {
    if (!canEdit || busy) return;
    try {
      await setLeadSourceOptions.mutateAsync(next);
      setDraft(null);
      addToast(next === null ? 'Origens padrão restauradas.' : 'Origens do lead salvas.', 'success');
    } catch (error) {
      addToast((error as Error).message || 'Não foi possível salvar as origens.', 'error');
    }
  };
  return (
    <SettingsCard id="lead-source-options" title="Origens do lead" icon={MapPin}
      description="Categorias para identificar como cada negócio chegou. Remover uma opção não altera a origem dos leads existentes.">
      {isLoading ? <p className="text-sm text-slate-500">Carregando origens...</p> : isError ? (
        <p role="alert" className="text-sm text-red-600">Não foi possível carregar as origens. Recarregue a página para tentar novamente.</p>
      ) : <>
        <div className="flex flex-wrap gap-2 mb-3">
          {options.map(option => <span key={option} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-white/10 px-3 py-1 text-sm">
            {option}
            {canEdit && <button type="button" disabled={busy} onClick={() => setDraft(options.filter(value => value !== option))}
              aria-label={`Remover ${option}`} className="rounded text-slate-400 hover:text-red-500 disabled:opacity-50 focus-visible-ring"><X size={14} /></button>}
          </span>)}
          {!options.length && <span className="text-sm text-slate-500">Somente Não informado estará disponível para novos leads.</span>}
        </div>
        <p className="text-xs text-slate-500 mb-3">Não informado fica sempre disponível. As UTMs continuam nos detalhes da campanha de cada lead.</p>
        {canEdit ? <>
          <div className="flex gap-2 mb-4">
            <input aria-label="Nova origem" value={newSource} maxLength={120} disabled={busy}
              onChange={event => setNewSource(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
              placeholder="Nova origem..." className={SETTINGS_INPUT_CLASS} />
            <button type="button" onClick={add} disabled={busy || !newSource.trim() || options.length >= 50} className={SETTINGS_BTN_PRIMARY}><Plus size={14} /> Adicionar</button>
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <button type="button" onClick={() => void save(draft)} disabled={busy || draft === null} className={SETTINGS_BTN_PRIMARY}>{busy ? 'Salvando...' : 'Salvar origens'}</button>
            <button type="button" onClick={() => void save(null)} disabled={busy} className="inline-flex gap-1 items-center text-sm text-slate-500 disabled:opacity-50"><RotateCcw size={14} /> Restaurar padrão</button>
          </div>
        </> : <p className="text-sm text-slate-500">Somente administradores podem alterar as categorias.</p>}
      </>}
    </SettingsCard>
  );
}
