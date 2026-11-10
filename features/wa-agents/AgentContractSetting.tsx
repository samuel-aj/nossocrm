'use client';

import { NativeSelect } from '@/components/ui/NativeSelect';
import { useState } from 'react';
import { templateLabel, useZapSignOrgStatus, useZapSignTemplates, useZapSignTemplateVariables, useVariableSources } from '@/features/zapsign/useZapSign';
import { VariableMappingModal } from '@/features/zapsign/VariableMappingModal';
import { useMessageTemplates } from './canvas/templatePreview';
import { Field, HELP_CLASS, INPUT_CLASS } from './ui';

export function AgentContractSetting({ value, mapping, onChange, signedMessage, connectionIds, onSignedMessage }: { value?: string | null; mapping: Record<string, string>;
  signedMessage?: string | null; connectionIds: string[]; onSignedMessage: (id: string | null) => void;
  onChange: (value: string | null, mapping: Record<string, string>) => void }) {
  const status = useZapSignOrgStatus();
  const templates = useZapSignTemplates(status.data?.connected === true);
  const items = templates.data?.templates ?? [];
  const selected = items.find(t => t.token === value);
  const packages = items.filter(t => t.attachments?.length);
  const singles = items.filter(t => !t.attachments?.length);
  const [showSingles, setShowSingles] = useState(false);
  const includeSingles = !packages.length || showSingles || (!!selected && !selected.attachments?.length);
  const [open, setOpen] = useState(false);
  const sources = useVariableSources();
  const vars = useZapSignTemplateVariables(status.data?.connected && selected ? selected.token : null);
  return <div className="py-3">
    <Field label="Modelo de contrato da ZapSign" htmlFor="agent-contract-template">
      <NativeSelect id="agent-contract-template" className={INPUT_CLASS} value={value ?? ''}
        disabled={!value && (!status.data?.connected || !items.length)}
        onChange={(e) => onChange(e.target.value || null, {})}>
        <option value="">Desativado</option>
        {value && !items.some(t => t.token === value) && <option value={value} disabled>Modelo configurado (não disponível na lista)</option>}
        {packages.length > 0 && <optgroup label="Modelos com vários documentos">{packages.map(t =>
          <option key={t.token} value={t.token} disabled={t.type === 'pdf'}>{templateLabel(t)}</option>)}</optgroup>}
        {includeSingles && <optgroup label="Modelos de um documento">{singles.map(t =>
          <option key={t.token} value={t.token} disabled={t.type === 'pdf'}>{templateLabel(t)}</option>)}</optgroup>}
      </NativeSelect>
    </Field>
    {!!packages.length && !!singles.length && <label className={HELP_CLASS}>
      <input type="checkbox" checked={includeSingles} disabled={!!selected && !selected.attachments?.length}
        onChange={e=>setShowSingles(e.target.checked)} /> Mostrar também modelos de um documento
    </label>}
    {!!selected?.attachments?.length && <p className={HELP_CLASS}>Um link para assinar o modelo e seus anexos: {selected.attachments.join('; ')}.</p>}
    {vars.data?.note && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{vars.data.note}</p>}
    {value && templates.isSuccess && !selected && <p className={HELP_CLASS}>Escolha o modelo principal do escritório para habilitar a criação.</p>}
    <p className={HELP_CLASS}>{status.isError || templates.isError ? 'Não foi possível consultar os modelos da ZapSign.' :
      status.isLoading || templates.isLoading && status.data?.connected ? 'Consultando os modelos do escritório…' :
      !status.data?.connected ? 'O Administrador Mestre pode conectar a ZapSign em Configurações → Integrações.' :
      !items.length ? 'A conta conectada não tem modelos ativos.' :
      'Após o aceite, a IA cria o contrato, envia o link nesta conversa e acompanha o cliente quando a ZapSign confirma a assinatura dele.'}</p>
    {value && items.some(t => t.token === value) && <>
      <SignedMessageSetting value={signedMessage} connections={connectionIds} onChange={onSignedMessage} />
      <button type="button" onClick={() => setOpen(true)} className="mt-2 text-sm font-semibold text-primary-600">Configurar campos do modelo</button>
      <VariableMappingModal open={open} onClose={() => setOpen(false)} templateName={items.find(t => t.token === value)?.name ?? ''}
        variables={vars.data?.variables ?? []} mapping={{ ...vars.data?.suggestions, ...mapping }} sources={sources}
        onChange={next => onChange(value, next)} loading={vars.isLoading} error={vars.error?.message} note={vars.data?.note}
        idPrefix="agent-zapsign-vars" forAgent />
    </>}
  </div>;
}

function SignedMessageSetting({value,connections,onChange}: {value?:string | null; connections:string[]; onChange:(id:string | null)=>void}) {
  const templates = useMessageTemplates();
  const eligible = (templates.data?.data ?? []).filter(t => t.type === 'whatsapp_api' && t.meta_status === 'APPROVED' &&
    t.connection_id && connections.includes(t.connection_id) && !t.header_type && !t.buttons?.length && !t.body.includes('{{'));
  return <div className="mt-3"><Field label="Confirmação de assinatura fora da janela do WhatsApp" htmlFor="agent-signed-message">
    <NativeSelect id="agent-signed-message" className={INPUT_CLASS} value={value ?? ''} onChange={e=>onChange(e.target.value || null)}>
      <option value="">Aguardar o cliente voltar a escrever</option>
      {value && !eligible.some(t=>t.id===value) && <option value={value} disabled>Modelo configurado indisponível</option>}
      {eligible.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
    </NativeSelect></Field><p className={HELP_CLASS}>Para confirmar pela API oficial após 24 horas, escolha uma mensagem de assinatura aprovada para o número, com texto fixo.</p></div>;
}
