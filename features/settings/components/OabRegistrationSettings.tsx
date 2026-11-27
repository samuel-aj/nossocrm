'use client';

import React, { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { NativeSelect } from '@/components/ui/NativeSelect';
import { useToast } from '@/context/ToastContext';
import { OAB_STATES, type StoredOabRegistration } from '@/lib/wa-agents/oabRegistry';
import { SETTINGS_BTN_PRIMARY, SETTINGS_INPUT_CLASS } from './SettingsUi';

const endpoint = '/api/org/oab';

export function OabRegistrationSettings({ organizationId, active = true }: { organizationId: string; active?: boolean }) {
  const cache = useQueryClient();
  const { addToast } = useToast();
  const [professionalName, setName] = useState('');
  const [state, setState] = useState('');
  const [number, setNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const queryKey = ['organizationOabRegistrations', organizationId];
  const headers = { 'Content-Type': 'application/json', 'x-org-id': organizationId };
  const registrations = useQuery<StoredOabRegistration[]>({
    queryKey,
    enabled: active,
    queryFn: async () => {
      const response = await fetch(endpoint, { headers });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Não foi possível carregar as inscrições.');
      return body.registrations;
    },
  });

  async function save(method: 'POST' | 'DELETE', data: object) {
    setSaving(true);
    try {
      const response = await fetch(endpoint, { method, headers, body: JSON.stringify(data) });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error || 'Não foi possível salvar a alteração.');
      }
      if (method === 'POST') {
        setName('');
        setNumber('');
        setState('');
      }
      await cache.invalidateQueries({ queryKey });
      addToast(method === 'POST' ? 'Inscrição confirmada' : 'Confirmação removida', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Não foi possível salvar a alteração.', 'error');
    } finally {
      setSaving(false);
    }
  }

  function confirm(event: FormEvent) {
    event.preventDefault();
    void save('POST', { professionalName, state, number, confirmed: true });
  }

  return <>
    {registrations.error && <p role="alert" className="mt-2 text-sm text-red-600">{registrations.error.message}</p>}
    {registrations.isLoading && <p className="mt-2 text-sm text-slate-500">Carregando inscrições…</p>}
    {registrations.data?.length === 0 && <p className="mt-3 text-sm text-slate-500">Nenhuma inscrição confirmada.</p>}
    {!!registrations.data?.length && <ul className="my-2 divide-y divide-slate-100 dark:divide-white/10">
      {registrations.data.map(registration => <li key={registration.id} className="flex items-center justify-between gap-3 py-2 text-sm">
        <span>{registration.professionalName} · OAB/{registration.state} {registration.number}</span>
        <button type="button" disabled={saving}
          aria-label={`Remover confirmação de ${registration.professionalName}, OAB/${registration.state} ${registration.number}`}
          className="rounded p-2 text-slate-500 hover:text-red-600 focus-visible-ring"
          onClick={() => void save('DELETE', { id: registration.id })}><Trash2 size={16} aria-hidden="true" /></button>
      </li>)}
    </ul>}
    <form onSubmit={confirm} className="mt-4 flex flex-wrap items-end gap-3">
      <label className="min-w-48 flex-1 text-xs font-medium">Nome do profissional
        <input required maxLength={120} value={professionalName} onChange={event => setName(event.target.value)}
          className={SETTINGS_INPUT_CLASS + ' mt-1'} />
      </label>
      <label className="w-24 text-xs font-medium">UF
        <NativeSelect required aria-label="UF da inscrição" value={state} onChange={event => setState(event.target.value)} className={SETTINGS_INPUT_CLASS + ' mt-1'}>
          <option value="">Selecione</option>
          {OAB_STATES.map(uf => <option key={uf} value={uf}>{uf}</option>)}
        </NativeSelect>
      </label>
      <label className="w-32 text-xs font-medium">Nº da OAB
        <input required maxLength={20} value={number} onChange={event => setNumber(event.target.value)}
          className={SETTINGS_INPUT_CLASS + ' mt-1'} />
      </label>
      <button type="submit" className={SETTINGS_BTN_PRIMARY} disabled={saving || !professionalName.trim() || !state || !number.trim()}>
        Confirmar inscrição
      </button>
    </form>
  </>;
}
