'use client';
import React from 'react';
import { LockKeyhole, ShieldCheck, KanbanSquare } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import type { TeamRole, BoardAccess } from '@/lib/permissions/teamRoles';
import { RoleCheckbox, RoleSelect } from './TeamRoleControls';

const input = 'mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 disabled:opacity-50 dark:border-white/15 dark:bg-slate-900 dark:text-slate-100';
export function TeamRoleEditor({ draft, onChange, boards, busy, error, onClose, onSave }: {
  draft: Partial<TeamRole> | null; onChange: React.Dispatch<React.SetStateAction<Partial<TeamRole> | null>>;
  boards: { id: string; name: string }[]; busy: boolean; error: string; onClose: () => void; onSave: () => Promise<void>;
}) {
  const selected = draft?.boards?.length || 0;
  const setRule = (boardId: string, patch: Partial<BoardAccess> | null) => onChange(previous => {
    if (!previous) return previous;
    const next = (previous.boards || []).filter(b => b.boardId !== boardId);
    const old = previous.boards?.find(b => b.boardId === boardId);
    if (patch) next.push({ boardId, scope: 'own', create: false, edit: false, move: false, delete: false, ...old, ...patch });
    return { ...previous, boards: next };
  });
  return <Modal isOpen={!!draft} onClose={() => !busy && onClose()} title={draft?.id ? 'Editar função' : 'Nova função'}
    className="!max-w-[1440px] !max-h-[calc(100dvh-2rem)]" bodyClassName="!p-0 !overflow-hidden flex min-h-0 flex-col">
    <form className="flex min-h-0 flex-col" onSubmit={async e => { e.preventDefault(); await onSave(); }}>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-7 sm:py-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Nome da função
            <input required disabled={busy} maxLength={80} className={input} value={draft?.name || ''} onChange={e => onChange(p => ({ ...p, name: e.target.value }))} placeholder="Ex.: Atendimento BPC" />
          </label>
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Descrição <span className="font-normal text-slate-400">(opcional)</span>
            <input disabled={busy} maxLength={300} className={input} value={draft?.description || ''} onChange={e => onChange(p => ({ ...p, description: e.target.value }))} placeholder="Descreva quem utiliza esta função" />
          </label>
        </div>
        <div className="mb-5 mt-8 flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-semibold text-slate-900 dark:text-white">Acesso por funil</h3><p className="mt-1 text-sm text-slate-500">Escolha os funis e o que os membros desta função poderão fazer.</p></div>
          <span className="inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"><ShieldCheck size={14} />{selected} de {boards.length} funis liberados</span>
        </div>
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {boards.map(board => {
            const rule = draft?.boards?.find(r => r.boardId === board.id);
            return <fieldset key={board.id} aria-label={'Permissões do funil ' + board.name} className={'min-w-0 overflow-hidden rounded-2xl border transition-colors ' + (rule ? 'border-primary-200 bg-white dark:border-primary-500/30 dark:bg-white/[0.02]' : 'border-slate-200 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.02]')}>
              <div className={'flex items-center justify-between gap-3 p-4 sm:px-5 ' + (rule ? 'border-b border-primary-100 bg-primary-50/50 dark:border-primary-500/15 dark:bg-primary-500/5' : '')}>
                <RoleCheckbox label={board.name} checked={!!rule} disabled={busy} onChange={checked => setRule(board.id, checked ? {} : null)}>
                  <span className="min-w-0 text-sm font-semibold text-slate-800 dark:text-slate-100">{board.name}</span>
                </RoleCheckbox>
                {rule ? <span className="shrink-0 text-xs font-medium text-primary-600 dark:text-primary-300">Liberado</span> : <LockKeyhole size={16} className="shrink-0 text-slate-400" aria-label="Sem acesso" />}
              </div>
              {rule && <div className="space-y-5 p-4 sm:p-5">
                <div><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Leads visíveis</p>
                  <RoleSelect label={'Leads visíveis em ' + board.name} value={rule.scope} disabled={busy} onChange={scope => setRule(board.id, { scope: scope as 'own' | 'all' })}
                    options={[{ value: 'own', label: 'Somente próprios' }, { value: 'all', label: 'Todos os leads deste funil' }]} />
                  <p className="mt-2 text-xs text-slate-500">{rule.scope === 'own' ? 'Somente leads atribuídos ao membro. Sem responsável não aparece.' : 'Inclui leads de outros membros e sem responsável.'}</p>
                </div>
                <div><p className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Ações permitidas</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([['create','Criar'],['edit','Editar'],['move','Mover entre etapas'],['delete','Excluir']] as const).map(([key,label]) =>
                      <div key={key} className={'rounded-xl border px-3 py-3 transition-colors ' + (rule[key] ? 'border-primary-200 bg-primary-50/60 dark:border-primary-500/25 dark:bg-primary-500/10' : 'border-slate-200 dark:border-white/10')}>
                        <RoleCheckbox label={label} checked={rule[key]} disabled={busy} onChange={checked => setRule(board.id, { [key]: checked })}>
                          <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
                        </RoleCheckbox>
                      </div>)}
                  </div>
                </div>
              </div>}
            </fieldset>;
          })}
        </div>
        {!boards.length && <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-5 text-sm text-slate-500 dark:bg-white/5"><KanbanSquare size={20} />Nenhum funil disponível nesta organização.</div>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:px-7 dark:border-white/10 dark:bg-dark-card">
        <div className="min-w-0 flex-1">{error ? <p role="alert" className="text-sm text-red-600">{error}</p> : <p className="text-xs text-slate-500">Funis não selecionados ficam sem acesso.</p>}</div>
        <div className="flex items-center gap-3"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-semibold text-slate-600 outline-none transition hover:bg-slate-50 focus-visible:ring-4 focus-visible:ring-primary-500/15 disabled:opacity-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">Cancelar</button>
          <button disabled={busy} className="min-h-11 rounded-xl bg-primary-600 px-6 text-sm font-semibold text-white shadow-sm outline-none transition hover:bg-primary-700 focus-visible:ring-4 focus-visible:ring-primary-500/25 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar função'}</button>
        </div>
      </footer>
    </form>
  </Modal>;
}
