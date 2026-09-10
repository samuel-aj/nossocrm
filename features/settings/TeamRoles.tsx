'use client';
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { Modal } from '@/components/ui/Modal';
import { type TeamRole, type BoardAccess } from '@/lib/permissions/teamRoles';
import { Crown, ShieldCheck, Plus, Pencil, Trash2 } from 'lucide-react';

type Member = { id: string; email: string; role: string };
export interface TeamConfig {
  canManage: boolean; isSuperAdmin: boolean; masterUserId: string | null;
  roles: TeamRole[]; availableBoards: { id: string; name: string }[];
  assignments: { user_id: string; role_id: string | null; legacy: boolean }[];
}
const field = 'w-full rounded-lg border border-slate-200 dark:border-white/15 bg-white dark:bg-slate-900 px-3 py-2 text-sm';
const primary = 'rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50';
export function useTeamConfig() {
  const { organizationId, user, profile } = useAuth();
  return useQuery<TeamConfig>({
    queryKey: ['team-config', organizationId, user?.id],
    enabled: !!organizationId && (profile?.role === 'admin' || profile?.role === 'super_admin'),
    queryFn: async () => {
      const res = await fetch('/api/org/team', { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Falha ao carregar permissões');
      return body;
    },
    staleTime: 0, refetchOnWindowFocus: true,
  });
}
function useTeamMutation(onSaved: () => void) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (action: string, data: unknown) => {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/org/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Não foi possível salvar');
      await client.invalidateQueries({ queryKey: ['team-config'] });
      await client.invalidateQueries({ queryKey: ['permissions'] });
      onSaved();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao salvar'); return false; }
    finally { setBusy(false); }
  };
  return { save, busy, error };
}
export function MemberAccess({ member, config, onSaved }: { member: Member; config: TeamConfig; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const assignment = config.assignments.find(a => a.user_id === member.id);
  const label = config.masterUserId === member.id ? 'Administrador Mestre' : member.role === 'admin' ? 'Administrador · acesso completo' :
    assignment?.legacy ? 'Acesso anterior preservado' : config.roles.find(r => r.id === assignment?.role_id)?.name || 'Sem acesso a funis';
  const [choice, setChoice] = useState('');
  const { save, busy, error } = useTeamMutation(onSaved);
  const isMaster = config.masterUserId === member.id;
  return <div className="order-last basis-full mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
    <ShieldCheck size={14} /><span>{label}</span>
    {config.canManage && !isMaster && <button className="font-semibold text-primary-600" onClick={() => { setChoice(member.role === 'admin' ? 'admin' : assignment?.role_id || 'none'); setOpen(true); }}>Alterar função</button>}
    <Modal isOpen={open} onClose={() => !busy && setOpen(false)} title="Função do membro" size="lg">
      <p className="mb-4 text-sm text-slate-500">{member.email}</p>
      <label className="block text-sm font-medium">Função
        <select className={field + ' mt-2'} value={choice} onChange={e => setChoice(e.target.value)}>
          <option value="none">Sem acesso a funis</option><option value="admin">Administrador — acesso operacional completo</option>
          {config.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <p className="mt-3 text-sm text-slate-500">Somente o Mestre gerencia os membros e suas permissões. Ao salvar, esta escolha substitui o acesso anterior.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-3"><button disabled={busy} onClick={() => setOpen(false)}>Cancelar</button>
        <button className={primary} disabled={busy} onClick={async () => { if (await save('assign', { userId: member.id, kind: choice === 'admin' ? 'admin' : 'vendedor', roleId: ['admin', 'none'].includes(choice) ? null : choice })) setOpen(false); }}>{busy ? 'Salvando…' : 'Salvar função'}</button>
      </div>
    </Modal>
  </div>;
}
export function TeamRolesPanel({ config, members, onSaved }: { config: TeamConfig; members: Member[]; onSaved: () => void }) {
  const [editor, setEditor] = useState<Partial<TeamRole> | null>(null);
  const [masterOpen, setMasterOpen] = useState(false);
  const [master, setMaster] = useState('');
  const [deleteRole, setDeleteRole] = useState<TeamRole | null>(null);
  const { save, busy, error } = useTeamMutation(onSaved);
  const currentMaster = members.find(m => m.id === config.masterUserId);
  function setRule(boardId: string, patch: Partial<BoardAccess> | null) {
    setEditor(prev => {
      if (!prev) return prev;
      const boards = (prev.boards || []).filter(b => b.boardId !== boardId);
      const old = prev.boards?.find(b => b.boardId === boardId);
      if (patch) boards.push({ boardId, scope: 'own', create: false, edit: false, move: false, delete: false, ...old, ...patch });
      return { ...prev, boards };
    });
  }
  return <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/[0.03]">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="flex items-center gap-2 font-semibold"><Crown size={18} className="text-amber-500" />Administrador Mestre</h2>
        <p className="mt-1 text-sm text-slate-500">{currentMaster?.email || 'Ainda não definido pelo super admin'}</p></div>
      {config.isSuperAdmin && <button className="text-sm font-semibold text-primary-600" onClick={() => { setMaster(config.masterUserId || ''); setMasterOpen(true); }}>{currentMaster ? 'Transferir função' : 'Definir Mestre'}</button>}
    </div>
    {config.canManage ? <>
      <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-5 dark:border-white/10">
        <h2 className="font-semibold">Funções personalizadas</h2><button className="flex items-center gap-1 text-sm font-semibold text-primary-600" onClick={() => setEditor({ name: '', description: '', boards: [] })}><Plus size={16} />Nova função</button>
      </div>
      <p className="mt-2 text-sm text-slate-500">Defina os funis, os leads visíveis e as ações permitidas. Novos funis precisam ser liberados aqui.</p>
      <div className="mt-3 space-y-2">{config.roles.map(r => <div key={r.id} className="flex items-center gap-3 rounded-lg bg-slate-50 p-3 dark:bg-white/5">
        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{r.name}</p><p className="text-xs text-slate-500">{r.boards.length} {r.boards.length === 1 ? 'funil' : 'funis'} · {config.assignments.filter(a => a.role_id === r.id).length} membros</p></div>
        <button aria-label={'Editar ' + r.name} onClick={() => setEditor({ ...r, boards: r.boards.map(b => ({ ...b })) })}><Pencil size={16} /></button>
        <button aria-label={'Excluir ' + r.name} className="text-red-500" onClick={() => setDeleteRole(r)}><Trash2 size={16} /></button>
      </div>)}</div>
      {!config.roles.length && <p className="mt-3 text-sm text-slate-400">Nenhuma função criada.</p>}
    </> : <p className="mt-4 text-sm text-slate-500">Você tem acesso operacional completo. A gestão de membros e funções é exclusiva do Mestre.</p>}
    <Modal isOpen={!!editor} onClose={() => !busy && setEditor(null)} title={editor?.id ? 'Editar função' : 'Nova função'} className="!max-w-3xl">
      <form onSubmit={async e => { e.preventDefault(); if (!editor) return; const { id, name, description, boards } = editor; if (await save('saveRole', { ...(id ? { id } : {}), name, description, boards })) setEditor(null); }}>
        <label className="block text-sm font-medium">Nome da função<input required maxLength={80} className={field + ' mt-1'} value={editor?.name || ''} onChange={e => setEditor(p => ({ ...p, name: e.target.value }))} placeholder="Ex.: Atendimento BPC" /></label>
        <label className="mt-4 block text-sm font-medium">Descrição <span className="font-normal text-slate-400">(opcional)</span><input maxLength={300} className={field + ' mt-1'} value={editor?.description || ''} onChange={e => setEditor(p => ({ ...p, description: e.target.value }))} /></label>
        <h3 className="mt-6 font-semibold">Acesso por funil</h3><p className="mt-1 text-sm text-slate-500">Em “Somente próprios”, leads sem responsável não aparecem. As ações abaixo são independentes.</p>
        <div className="mt-4 space-y-3">{config.availableBoards.map(b => {
          const rule = editor?.boards?.find(r => r.boardId === b.id);
          return <fieldset key={b.id} className="rounded-xl border border-slate-200 p-4 dark:border-white/10">
            <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={!!rule} onChange={e => setRule(b.id, e.target.checked ? {} : null)} />{b.name}</label>
            {rule && <div className="mt-3 space-y-3">
              <label className="block text-sm">Leads visíveis<select aria-label={'Leads visíveis em ' + b.name} className={field + ' mt-1'} value={rule.scope} onChange={e => setRule(b.id, { scope: e.target.value as 'own' | 'all' })}><option value="own">Somente próprios</option><option value="all">Todos os leads deste funil</option></select></label>
              <div className="flex flex-wrap gap-x-5 gap-y-2">{([['create','Criar'],['edit','Editar'],['move','Mover entre etapas'],['delete','Excluir']] as const).map(([key,label]) =>
                <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rule[key]} onChange={e => setRule(b.id, { [key]: e.target.checked })} />{label}</label>)}</div>
            </div>}
          </fieldset>;
        })}</div>
        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={() => setEditor(null)}>Cancelar</button><button className={primary} disabled={busy}>{busy ? 'Salvando…' : 'Salvar função'}</button></div>
      </form>
    </Modal>
    <Modal isOpen={masterOpen} onClose={() => !busy && setMasterOpen(false)} title="Definir Administrador Mestre" size="lg">
      <p className="mb-4 text-sm text-slate-500">O Mestre poderá gerenciar membros e funções. O Mestre anterior continuará como administrador.</p>
      <label className="block text-sm">Membro<select className={field + ' mt-1'} value={master} onChange={e => setMaster(e.target.value)}><option value="">Selecione um membro</option>{members.map(m => <option key={m.id} value={m.id}>{m.email}</option>)}</select></label>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-3"><button disabled={busy} onClick={() => setMasterOpen(false)}>Cancelar</button><button className={primary} disabled={busy || !master || master === config.masterUserId} onClick={async () => { if (await save('master', { userId: master })) setMasterOpen(false); }}>Confirmar Mestre</button></div>
    </Modal>
    <Modal isOpen={!!deleteRole} onClose={() => !busy && setDeleteRole(null)} title="Excluir função">
      <p>Excluir “{deleteRole?.name}”?</p>{error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-3"><button disabled={busy} onClick={() => setDeleteRole(null)}>Cancelar</button><button className={primary} disabled={busy} onClick={async () => { if (await save('deleteRole', { id: deleteRole?.id })) setDeleteRole(null); }}>Excluir função</button></div>
    </Modal>
  </section>;
}
