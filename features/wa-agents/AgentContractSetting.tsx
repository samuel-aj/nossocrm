'use client';

import { NativeSelect } from '@/components/ui/NativeSelect';
import { useState } from 'react';
import { useZapSignOrgStatus, useZapSignTemplates, useZapSignTemplateVariables, useVariableSources } from '@/features/zapsign/useZapSign';
import { VariableMappingModal } from '@/features/zapsign/VariableMappingModal';
import { Field, HELP_CLASS, INPUT_CLASS } from './ui';

export function AgentContractSetting({ value, mapping, onChange }: { value?: string | null; mapping: Record<string, string>;
  onChange: (value: string | null, mapping: Record<string, string>) => void }) {
  const status = useZapSignOrgStatus();
  const templates = useZapSignTemplates(status.data?.connected === true);
  const items = templates.data?.templates ?? [];
  const [open, setOpen] = useState(false);
  const sources = useVariableSources();
  const vars = useZapSignTemplateVariables(open && status.data?.connected ? value ?? null : null);
  return <div className="py-3">
    <Field label="Modelo de contrato da ZapSign" htmlFor="agent-contract-template">
      <NativeSelect id="agent-contract-template" className={INPUT_CLASS} value={value ?? ''}
        disabled={!value && (!status.data?.connected || !items.length)}
        onChange={(e) => onChange(e.target.value || null, {})}>
        <option value="">Desativado</option>
        {value && !items.some(t => t.token === value) && <option value={value} disabled>Modelo configurado (não disponível na lista)</option>}
        {items.map(t => <option key={t.token} value={t.token}>{t.name}</option>)}
      </NativeSelect>
    </Field>
    <p className={HELP_CLASS}>{status.isError || templates.isError ? 'Não foi possível consultar os modelos da ZapSign.' :
      status.isLoading || templates.isLoading && status.data?.connected ? 'Consultando os modelos do escritório…' :
      !status.data?.connected ? 'O Administrador Mestre pode conectar a ZapSign em Configurações → Integrações.' :
      !items.length ? 'A conta conectada não tem modelos ativos.' :
      'Após o cliente confirmar os dados, a IA cria o documento deste modelo. O link fica na aba Contrato do lead; o convite não é enviado automaticamente.'}</p>
    {value && items.some(t => t.token === value) && <>
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-sm font-semibold text-primary-600">Configurar campos do modelo</button>
      <VariableMappingModal open={open} onClose={() => setOpen(false)} templateName={items.find(t => t.token === value)?.name ?? ''}
        variables={vars.data?.variables ?? []} mapping={{ ...vars.data?.suggestions, ...mapping }} sources={sources}
        onChange={next => onChange(value, next)} loading={vars.isLoading} error={vars.error?.message} note={vars.data?.note}
        idPrefix="agent-zapsign-vars" forAgent />
    </>}
  </div>;
}
