'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ListChecks } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { useCRM } from '@/context/CRMContext';
import { useAuth } from '@/context/AuthContext';
import { useOrgMembers } from '@/lib/query/hooks/useOrgMembers';
import { useMyActionPermissions } from '@/lib/permissions/useMyActionPermissions';
import { LeadSourceSelect } from '@/features/deals/components/LeadSourceSelect';
import { customStageValueFilled, getMissingStageFields, isKnownLeadSource, type RequiredStageField, type StageRequirementValues } from '@/lib/deals/stageRequirements';
import { StageRequirementsContext, type StageCompletionRequest } from './StageRequirementsContext';
import type { Deal } from '@/types';

type Pending = StageCompletionRequest & { fields: RequiredStageField[]; resolve: (deal: Deal | null) => void; scope: string; committing?: boolean };
const inputClass = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-white/15 dark:bg-slate-900';

export function StageRequirementsProvider({ children }: { children: React.ReactNode }) {
  const { customFieldDefinitions } = useCRM();
  const { organizationId, user } = useAuth();
  const scope = `${organizationId}:${user?.id}`;
  const scopeRef = useRef(scope);
  useLayoutEffect(() => { scopeRef.current = scope; }, [scope]);
  const pendingRef = useRef<Pending | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => () => { const p = pendingRef.current; if (p && !p.committing) p.resolve(null); }, []);
  const request = useCallback(async (req: StageCompletionRequest) => {
    if (pendingRef.current) throw new Error('Conclua ou cancele a movimentação aberta antes de continuar.');
    const fields = getMissingStageFields(req.deal, req.stage, customFieldDefinitions);
    if (!fields.length) return req.persist({});
    return new Promise<Deal | null>(resolve => {
      const p = { ...req, fields, resolve, scope: scopeRef.current };
      pendingRef.current = p; setPending(p);
    });
  }, [customFieldDefinitions]);
  const finish = useCallback((result: Deal | null) => {
    const p = pendingRef.current; pendingRef.current = null;
    setPending(null); p?.resolve(result);
  }, []);
  // Stop an unanswered dialog when its organization/session is replaced.
  // A request already being committed is resolved by its own transaction.
  return <StageRequirementsContext.Provider value={request}>
    {children}
    {pending && <CompletionDialog key={pending.deal.id + pending.scope} pending={pending} currentScope={scope} scopeRef={scopeRef} finish={finish} />}
  </StageRequirementsContext.Provider>;
}

function CompletionDialog({ pending, currentScope, scopeRef, finish }: {
  pending: Pending; currentScope: string; scopeRef: React.RefObject<string>; finish: (deal: Deal | null) => void;
}) {
  const { products } = useCRM();
  const { profile } = useAuth();
  const { data: members = [], isError: membersError } = useOrgMembers();
  const permissions = useMyActionPermissions(pending.deal.boardId);
  const canAssign = profile?.role === 'admin' || profile?.role === 'super_admin';
  const [values, setValues] = useState<StageRequirementValues>({});
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const requiredOwner = pending.fields.some(f => f.id === 'ownerId');
  const unavailable = pending.fields.some(f => f.unavailable);
  const blocked = !permissions.deals.edit || unavailable || (requiredOwner && (!canAssign || membersError));
  useEffect(() => {
    if (currentScope !== pending.scope && !submitting.current) finish(null);
  }, [currentScope, pending.scope, finish]);
  const cancel = () => { if (!submitting.current) finish(null); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || blocked) return;
    if (scopeRef.current !== pending.scope) { finish(null); return; }
    const invalid = pending.fields.filter(f => {
      if (f.id === 'products') return !values.product?.productId || !Number.isInteger(values.product.quantity) || values.product.quantity < 1 || !Number.isFinite(values.product.price) || values.product.price < 0;
      if (f.id === 'leadSource') return !isKnownLeadSource(values.leadSource);
      if (f.id === 'ownerId') return !members.some(m => m.member && m.id === values.ownerId);
      return !f.definition || !customStageValueFilled(f.definition, values.customFields?.[f.definition.key]);
    });
    if (invalid.length) { setError(`Preencha: ${invalid.map(f => f.label).join(', ')}.`); return; }
    submitting.current = true; pending.committing = true; setBusy(true); setError('');
    try {
      const deal = await pending.persist(values);
      const member = values.ownerId && members.find(m => m.id === values.ownerId);
      finish(member ? { ...deal, owner: { name: member.name, avatar: '' } } : deal);
    }
    catch (e) { setError((e as Error).message || 'Não foi possível salvar. Suas alterações ainda não foram aplicadas.'); }
    finally { submitting.current = false; pending.committing = false; setBusy(false); if (scopeRef.current !== pending.scope) finish(null); }
  };
  return createPortal(<div className="relative z-[10020]">
    <Modal isOpen title="Complete para mudar de etapa" onClose={cancel} size="xl" footer={<div className="flex justify-end gap-2">
      <button type="button" onClick={cancel} disabled={busy} className="px-4 py-2 text-sm disabled:opacity-50">Cancelar</button>
      <button type="submit" form="complete-stage" disabled={busy || blocked} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar e mover'}</button>
    </div>}>
      <form id="complete-stage" onSubmit={save} className="space-y-5">
        <div className="rounded-xl bg-primary-50 p-4 dark:bg-primary-900/20">
          <p className="text-sm font-semibold">{pending.deal.title}</p>
          <p className="mt-2 flex items-center gap-2 text-sm text-primary-700 dark:text-primary-300"><ArrowRight size={16} />{pending.stage.label}</p>
        </div>
        <p className="flex items-center gap-2 text-sm text-slate-500"><ListChecks size={18} />Preencha as pendências desta etapa.</p>
        <fieldset disabled={busy || blocked} className="space-y-4">
          {pending.fields.map(field => {
            if (field.id === 'products') return <div key={field.id} className="space-y-3">
              <label className="block text-sm font-medium">Produto ou serviço
                <select required value={values.product?.productId ?? ''} className={inputClass} onChange={e => {
                  const product = products.find(p => p.id === e.target.value);
                  setValues(v => ({ ...v, product: product ? { productId: product.id, price: product.price, quantity: 1 } : undefined }));
                }}><option value="">Selecione um produto</option>{products.filter(p => p.active !== false).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
              {values.product && <div className="grid grid-cols-2 gap-3">
                <label className="text-sm">Valor unitário (R$)<input type="number" required min="0" step="0.01" value={Number.isFinite(values.product.price) ? values.product.price : ''} className={inputClass} onChange={e => setValues(v => ({ ...v, product: { ...v.product!, price: e.target.value === '' ? NaN : Number(e.target.value) } }))} /></label>
                <label className="text-sm">Quantidade<input type="number" required min="1" step="1" value={values.product.quantity} className={inputClass} onChange={e => setValues(v => ({ ...v, product: { ...v.product!, quantity: Number(e.target.value) } }))} /></label>
              </div>}
            </div>;
            if (field.id === 'leadSource') return <LeadSourceSelect key={field.id} value={values.leadSource} disabled={busy || blocked} onChange={v => setValues(old => ({ ...old, leadSource: v ?? '' }))} />;
            if (field.id === 'ownerId') return <label key={field.id} className="block text-sm font-medium">Responsável<select required className={inputClass} value={values.ownerId ?? ''} onChange={e => setValues(v => ({ ...v, ownerId: e.target.value }))}><option value="">Selecione uma pessoa</option>{members.filter(m => m.member).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>;
            const def = field.definition;
            if (!def) return <p key={field.id} className="text-sm text-amber-700">Este campo não está disponível. Peça ao administrador para revisar as regras da etapa.</p>;
            const value = values.customFields?.[def.key];
            const set = (v: unknown) => setValues(old => ({ ...old, customFields: { ...old.customFields, [def.key]: v } }));
            return <label key={field.id} className="block text-sm font-medium">{def.label}
              {def.type === 'select' || def.type === 'multiselect' ? <select required multiple={def.type === 'multiselect'} className={inputClass}
                value={def.type === 'multiselect' ? (value as string[] ?? []) : (value as string ?? '')}
                onChange={e => set(def.type === 'multiselect' ? Array.from(e.target.selectedOptions, option => option.value) : e.target.value)}>
                {def.type === 'select' && <option value="">Selecione</option>}{def.options?.map(option => <option key={option} value={option}>{option}</option>)}
              </select> : <input required className={inputClass} type={def.type === 'date' ? 'date' : ['number', 'currency'].includes(def.type) ? 'number' : 'text'} step={def.type === 'currency' ? '0.01' : 'any'} value={String(value ?? '')} onChange={e => set(e.target.value)} />}
            </label>;
          })}
        </fieldset>
        {blocked && <p role="alert" className="text-sm text-amber-700">{requiredOwner && !canAssign ? 'Peça a um administrador para atribuir o responsável.' : membersError ? 'Não foi possível carregar os responsáveis. Feche e tente novamente.' : unavailable ? 'A configuração desta etapa precisa ser revisada.' : 'Você precisa de permissão para editar este lead e preencher as pendências.'}</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <p className="text-xs text-slate-500">O lead só muda de etapa depois de salvar. Se cancelar, ele permanece onde está.</p>
      </form>
    </Modal>
  </div>, document.body);
}
