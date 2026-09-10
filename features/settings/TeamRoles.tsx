'use client';
import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { TeamRoleEditor } from './TeamRoleEditor';
import { RoleSelect } from './TeamRoleControls';
import { Modal } from '@/components/ui/Modal';
import { type TeamRole } from '@/lib/permissions/teamRoles';
import { Crown, ShieldCheck, Plus, Pencil, Trash2 } from 'lucide-react';

type Member = { id: string; email: string; role: string };
export interface TeamConfig {
  canManage: boolean; isSuperAdmin: boolean; masterUserId: string | null;
  roles: TeamRole[]; availableBoards: { id: string; name: string }[];
  assignments: { user_id: string; role_id: string | null; legacy: boolean }[];
}
const primary = 'min-h-11 rounded-xl bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white outline-none transition hover:bg-primary-700 focus-visible:ring-4 focus-visible:ring-primary-500/20 disabled:opacity-50';
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
    <Modal isOpen={open} onClose={() => !busy && setOpen(false)} title="Função do membro" size="lg" className="!max-w-xl">
      <p className="mb-4 text-sm text-slate-500">{member.email}</p>
      <label className="block text-sm font-medium">Função
        <div className="mt-2"><RoleSelect label="Função" value={choice} onChange={setChoice} disabled={busy} options={[
          { value: 'none', label: 'Sem acesso a funis' }, { value: 'admin', label: 'Administrador — acesso operacional completo' },
          ...config.roles.map(r => ({ value: r.id, label: r.name })),
        ]} /></div>
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
    <TeamRoleEditor draft={editor} onChange={setEditor} boards={config.availableBoards} busy={busy} error={error} onClose={() => setEditor(null)} onSave={async () => {
      if (!editor) return;
      const { id, name, description, boards } = editor;
      if (await save('saveRole', { ...(id ? { id } : {}), name, description, boards })) setEditor(null);
    }} />
    <Modal isOpen={masterOpen} onClose={() => !busy && setMasterOpen(false)} title="Definir Administrador Mestre" size="lg" className="!max-w-xl">
      <p className="mb-4 text-sm text-slate-500">O Mestre poderá gerenciar membros e funções. O Mestre anterior continuará como administrador.</p>
      <label className="block text-sm">Membro<div className="mt-2"><RoleSelect label="Membro" value={master} onChange={setMaster} disabled={busy} placeholder="Selecione um membro" options={members.map(m => ({ value: m.id, label: m.email }))} /></div></label>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-3"><button disabled={busy} onClick={() => setMasterOpen(false)}>Cancelar</button><button className={primary} disabled={busy || !master || master === config.masterUserId} onClick={async () => { if (await save('master', { userId: master })) setMasterOpen(false); }}>Confirmar Mestre</button></div>
    </Modal>
    <Modal isOpen={!!deleteRole} onClose={() => !busy && setDeleteRole(null)} title="Excluir função">
      <p>Excluir “{deleteRole?.name}”?</p>{error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-6 flex justify-end gap-3"><button disabled={busy} onClick={() => setDeleteRole(null)}>Cancelar</button><button className={primary} disabled={busy} onClick={async () => { if (await save('deleteRole', { id: deleteRole?.id })) setDeleteRole(null); }}>Excluir função</button></div>
    </Modal>
  </section>;
}
