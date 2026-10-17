import React, { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Deal, BoardStage } from '@/types';
import { StageRequirementsProvider } from './StageRequirementsProvider';
import { useStageRequirements } from './StageRequirementsContext';

const state = vi.hoisted(() => ({ org: 'org', role: 'admin', edit: true }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ organizationId: state.org, user: { id: 'user' }, profile: { role: state.role } }) }));
vi.mock('@/context/CRMContext', () => ({ useCRM: () => ({ products: [{ id: 'p', name: 'Serviço', price: 200, active: true }], customFieldDefinitions: [{ id: 'date', key: 'signed', type: 'date', label: 'Data da assinatura' }] }) }));
vi.mock('@/lib/query/hooks/useOrgMembers', () => ({ useOrgMembers: () => ({ data: [{ id: 'user', name: 'Ana', member: true }] }) }));
vi.mock('@/lib/permissions/useMyActionPermissions', () => ({ useMyActionPermissions: () => ({ deals: { edit: state.edit } }) }));
vi.mock('@/features/deals/components/LeadSourceSelect', () => ({ LeadSourceSelect: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <label>Origem<input value={value ?? ''} onChange={e => onChange(e.target.value)} /></label> }));
// Keep real Modal; happy-dom cannot calculate tabbable visibility for focus-trap.
vi.mock('@/lib/a11y', () => ({ FocusTrap: ({ children }: { children: React.ReactNode }) => <>{children}</>, useFocusReturn: () => {} }));
const deal = { id: 'd', title: 'Mariana', boardId: 'b', items: [], customFields: {}, ownerId: 'user', leadSource: 'Meta Ads' } as unknown as Deal;
const stage = { id: 'signed', label: 'Contrato assinado', requiredFields: ['products', 'leadSource', 'custom:date'] } as BoardStage;
let request: ReturnType<typeof useStageRequirements>;
function Probe() { const current = useStageRequirements(); React.useEffect(() => { request = current; }, [current]); return null; }
const ui = <StrictMode><StageRequirementsProvider><Probe /></StageRequirementsProvider></StrictMode>;
beforeEach(() => { state.org = 'org'; state.role = 'admin'; state.edit = true; });

it('asks only missing fields and cancels without saving anything', async () => {
  render(ui); const persist = vi.fn(); let result!: Promise<Deal | null>;
  act(() => { result = request!({ deal, stage, persist }); });
  expect(screen.getByLabelText('Produto ou serviço')).toBeInTheDocument();
  expect(screen.queryByLabelText('Origem')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Produto ou serviço'), { target: { value: 'p' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(await result).toBeNull(); expect(persist).not.toHaveBeenCalled();
});
it('keeps the form on a server error, then commits all values once on retry', async () => {
  render(ui); const persist = vi.fn().mockRejectedValueOnce(new Error('Conexão interrompida')).mockResolvedValue({ ...deal, status: 'signed' });
  let result!: Promise<Deal | null>; act(() => { result = request!({ deal, stage, persist }); });
  fireEvent.change(screen.getByLabelText('Produto ou serviço'), { target: { value: 'p' } });
  fireEvent.change(screen.getByLabelText('Data da assinatura'), { target: { value: '2026-09-15' } });
  fireEvent.submit(screen.getByLabelText('Produto ou serviço').closest('form')!);
  await screen.findByText('Conexão interrompida');
  expect(screen.getByLabelText('Data da assinatura')).toHaveValue('2026-09-15');
  fireEvent.submit(screen.getByLabelText('Produto ou serviço').closest('form')!);
  await act(async () => { expect((await result)?.status).toBe('signed'); });
  expect(persist).toHaveBeenLastCalledWith({ product: { productId: 'p', price: 200, quantity: 1 }, customFields: { signed: '2026-09-15' } });
});
it('does not allow cancellation or a second commit while saving', async () => {
  render(ui); let done!: (d: Deal) => void; const persist = vi.fn(() => new Promise<Deal>(r => { done = r; }));
  act(() => { void request!({ deal, stage: { ...stage, requiredFields: ['products'] }, persist }); });
  fireEvent.change(screen.getByLabelText('Produto ou serviço'), { target: { value: 'p' } });
  fireEvent.submit(screen.getByLabelText('Produto ou serviço').closest('form')!);
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
  await act(async () => { done(deal); }); expect(persist).toHaveBeenCalledOnce();
});
it('moves without a dialog when every destination requirement is already filled', async () => {
  render(ui); const persist = vi.fn().mockResolvedValue(deal);
  await act(async () => { await request!({ deal, stage: { ...stage, requiredFields: ['leadSource', 'ownerId'] }, persist }); });
  expect(persist).toHaveBeenCalledExactlyOnceWith({}); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('cancels an unanswered request if the organization changes', async () => {
  const { rerender } = render(ui); const persist = vi.fn(); let result!: Promise<Deal | null>;
  act(() => { result = request!({ deal, stage, persist }); });
  state.org = 'other'; rerender(<StrictMode><StageRequirementsProvider><Probe /></StageRequirementsProvider></StrictMode>);
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(await result).toBeNull(); expect(persist).not.toHaveBeenCalled();
});
it('requires edit permission to submit missing values', () => {
  state.edit = false; render(ui);
  act(() => { void request!({ deal, stage, persist: vi.fn() }); });
  expect(screen.getByRole('button', { name: 'Salvar e mover' })).toBeDisabled();
});

it.each(['', '0', '-5'])('blocks an empty or nonpositive deal value (%s) before persisting', async value => {
  render(ui); const persist = vi.fn();
  act(() => { void request!({ deal: { ...deal, value: 0 }, stage: { ...stage, requiredFields: ['value'] }, persist }); });
  const input = screen.getByLabelText('Valor do negócio (R$)');
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form')!);
  expect(await screen.findByRole('alert')).toHaveTextContent('Valor do negócio');
  expect(persist).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('saves a positive amount with cents and moves in the same operation', async () => {
  render(ui); const persist = vi.fn().mockResolvedValue({ ...deal, value: 1500.25, status: 'signed' });
  let result!: Promise<Deal | null>;
  act(() => { result = request!({ deal: { ...deal, value: 0 }, stage: { ...stage, requiredFields: ['value'] }, persist }); });
  const input = screen.getByLabelText('Valor do negócio (R$)');
  fireEvent.change(input, { target: { value: '1500.25' } });
  fireEvent.submit(input.closest('form')!);
  await act(async () => { expect(await result).toMatchObject({ value: 1500.25, status: 'signed' }); });
  expect(persist).toHaveBeenCalledExactlyOnceWith({ value: 1500.25 });
});
it('discards the entered amount when cancelling', async () => {
  render(ui); const persist = vi.fn(); let result!: Promise<Deal | null>;
  act(() => { result = request!({ deal: { ...deal, value: 0 }, stage: { ...stage, requiredFields: ['value'] }, persist }); });
  fireEvent.change(screen.getByLabelText('Valor do negócio (R$)'), { target: { value: '300' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(await result).toBeNull(); expect(persist).not.toHaveBeenCalled();
});
it('uses an existing positive amount without opening the completion dialog', async () => {
  render(ui); const filled = { ...deal, value: 0.01 }; const persist = vi.fn().mockResolvedValue(filled);
  await act(async () => { await request!({ deal: filled, stage: { ...stage, requiredFields: ['value'] }, persist }); });
  expect(persist).toHaveBeenCalledExactlyOnceWith({}); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('submits the deal amount together with the required product', async () => {
  render(ui); const persist = vi.fn().mockResolvedValue({ ...deal, value: 500, status: 'signed' });
  let result!: Promise<Deal | null>;
  act(() => { result = request!({ deal: { ...deal, value: 0 }, stage: { ...stage, requiredFields: ['products', 'value'] }, persist }); });
  fireEvent.change(screen.getByLabelText('Produto ou serviço'), { target: { value: 'p' } });
  const input = screen.getByLabelText('Valor do negócio (R$)');
  fireEvent.change(input, { target: { value: '500' } });
  fireEvent.submit(input.closest('form')!);
  await act(async () => { await result; });
  expect(persist).toHaveBeenCalledExactlyOnceWith({ product: { productId: 'p', price: 200, quantity: 1 }, value: 500 });
});
