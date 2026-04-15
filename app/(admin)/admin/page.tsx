'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import {
  Building2,
  Plus,
  Users,
  Shield,
  Power,
  PowerOff,
  Pencil,
  ChevronLeft,
  X,
  Eye,
  Loader2,
  LogOut,
  UserPlus,
  Trash2,
  ExternalLink,
} from 'lucide-react'

interface Organization {
  id: string
  name: string
  max_users: number
  is_active: boolean
  created_at: string
  userCount: number
  adminCount: number
  vendedorCount: number
}

interface OrgMember {
  id: string
  email: string
  name: string
  role: string
  created_at: string
}

export default function AdminPage() {
  const router = useRouter()
  const { profile, loading: authLoading, signOut, refreshProfile } = useAuth()
  const { addToast } = useToast()

  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [setupNeeded, setSetupNeeded] = useState(false)
  const [settingUp, setSettingUp] = useState(false)

  // Create org form
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formData, setFormData] = useState({
    companyName: '',
    adminEmail: '',
    adminPassword: '',
    adminName: '',
    maxUsers: 1,
  })

  // Detail view
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null)
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)

  // Edit
  const [editingOrg, setEditingOrg] = useState<Organization | null>(null)
  const [editName, setEditName] = useState('')
  const [editMaxUsers, setEditMaxUsers] = useState(5)
  const [saving, setSaving] = useState(false)

  // Collaborators (super_admins)
  const [collaborators, setCollaborators] = useState<{ id: string; email: string; name: string; created_at: string }[]>([])
  const [newCollabEmail, setNewCollabEmail] = useState('')
  const [addingCollab, setAddingCollab] = useState(false)
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null)

  const isSuperAdmin = profile?.role === 'super_admin'

  const fetchOrganizations = useCallback(async () => {
    try {
      const res = await fetch('/api/superadmin/organizations', { credentials: 'include' })
      if (res.status === 403) {
        setSetupNeeded(true)
        setLoading(false)
        return
      }
      const data = await res.json()
      if (data.organizations) {
        setOrganizations(data.organizations)
        setSetupNeeded(false)
      }
    } catch {
      addToast('Erro ao carregar organizações', 'error')
    } finally {
      setLoading(false)
    }
  }, [addToast])

  const fetchCollaborators = useCallback(async () => {
    try {
      const res = await fetch('/api/superadmin/collaborators', { credentials: 'include' })
      const data = await res.json()
      if (data.collaborators) setCollaborators(data.collaborators)
    } catch {
      // silent
    }
  }, [])

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newCollabEmail.trim()) return
    setAddingCollab(true)
    try {
      const res = await fetch('/api/superadmin/collaborators', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email: newCollabEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addToast(data.message, 'success')
      setNewCollabEmail('')
      fetchCollaborators()
    } catch (err: any) {
      addToast(`Erro: ${err.message}`, 'error')
    } finally {
      setAddingCollab(false)
    }
  }

  const handleRemoveCollaborator = async (userId: string) => {
    try {
      const res = await fetch('/api/superadmin/collaborators', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addToast('Acesso removido', 'success')
      fetchCollaborators()
    } catch (err: any) {
      addToast(`Erro: ${err.message}`, 'error')
    }
  }

  // On mount, refresh profile to get latest role from DB
  const [profileRefreshed, setProfileRefreshed] = useState(false)
  useEffect(() => {
    if (authLoading || !profile) return
    if (!profileRefreshed) {
      refreshProfile().then(() => setProfileRefreshed(true))
      return
    }
    if (profile.role === 'super_admin') {
      fetchOrganizations()
      fetchCollaborators()
    } else if (profile.role === 'admin') {
      setSetupNeeded(true)
      setLoading(false)
    } else {
      router.push('/')
    }
  }, [profile, authLoading, router, fetchOrganizations, fetchCollaborators, profileRefreshed, refreshProfile])

  const handleSetup = async () => {
    setSettingUp(true)
    try {
      const res = await fetch('/api/superadmin/setup', {
        method: 'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addToast('Super admin configurado!', 'success')
      await refreshProfile()
      setSetupNeeded(false)
      fetchOrganizations()
    } catch (err: any) {
      addToast(`Erro: ${err.message}`, 'error')
    } finally {
      setSettingUp(false)
    }
  }

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    try {
      const res = await fetch('/api/superadmin/organizations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      addToast(`Organização "${formData.companyName}" criada com sucesso!`, 'success')
      setShowCreateForm(false)
      setFormData({ companyName: '', adminEmail: '', adminPassword: '', adminName: '', maxUsers: 1 })
      fetchOrganizations()
    } catch (err: any) {
      addToast(`Erro: ${err.message}`, 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleViewOrg = async (org: Organization) => {
    setSelectedOrg(org)
    setLoadingMembers(true)
    try {
      const res = await fetch(`/api/superadmin/organizations/${org.id}`, { credentials: 'include' })
      const data = await res.json()
      if (data.members) setOrgMembers(data.members)
    } catch {
      addToast('Erro ao carregar membros', 'error')
    } finally {
      setLoadingMembers(false)
    }
  }

  const handleToggleActive = async (org: Organization) => {
    try {
      const res = await fetch(`/api/superadmin/organizations/${org.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ is_active: !org.is_active }),
      })
      if (!res.ok) throw new Error('Erro ao atualizar')
      addToast(org.is_active ? 'Organização desativada' : 'Organização ativada', 'success')
      fetchOrganizations()
      if (selectedOrg?.id === org.id) setSelectedOrg({ ...org, is_active: !org.is_active })
    } catch (err: any) {
      addToast(`Erro: ${err.message}`, 'error')
    }
  }

  const handleSaveEdit = async () => {
    if (!editingOrg) return
    setSaving(true)
    try {
      const res = await fetch(`/api/superadmin/organizations/${editingOrg.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: editName, max_users: editMaxUsers }),
      })
      if (!res.ok) throw new Error('Erro ao salvar')
      addToast('Organização atualizada', 'success')
      setEditingOrg(null)
      fetchOrganizations()
    } catch (err: any) {
      addToast(`Erro: ${err.message}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleAccessCRM = async (org: Organization) => {
    setSwitchingOrgId(org.id)
    try {
      const res = await fetch('/api/superadmin/switch-org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ organizationId: org.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      await refreshProfile()
      router.push('/')
    } catch (err: any) {
      addToast(`Erro: ${err.message}`, 'error')
      setSwitchingOrgId(null)
    }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-dark-bg flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
      </div>
    )
  }

  // Setup screen for first-time admin → super_admin promotion
  if (setupNeeded) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-dark-bg flex items-center justify-center p-4">
        <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-xl max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-primary-100 dark:bg-primary-900/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Shield className="w-8 h-8 text-primary-600 dark:text-primary-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
            Painel Super Admin
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            Para gerenciar organizações de clientes, você precisa ativar o modo Super Admin.
            Isso promove sua conta para ter acesso total ao painel de gerenciamento.
          </p>
          <button
            onClick={handleSetup}
            disabled={settingUp}
            className="w-full bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-primary-600/20"
          >
            {settingUp ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Configurando...</>
            ) : (
              <><Shield className="w-4 h-4" /> Ativar Super Admin</>
            )}
          </button>
          <button
            onClick={() => router.push('/')}
            className="mt-3 w-full text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 py-2"
          >
            Voltar ao CRM
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-dark-bg">
      {/* Header */}
      <header className="bg-white dark:bg-dark-card border-b border-slate-200 dark:border-white/10 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary-500 to-primary-700 rounded-xl flex items-center justify-center text-white font-bold text-sm">
              SA
            </div>
            <div>
              <h1 className="font-bold text-slate-900 dark:text-white text-lg">Super Admin</h1>
              <p className="text-xs text-slate-500">{profile?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-1"
            >
              <ChevronLeft size={16} /> Voltar ao CRM
            </button>
            <button
              onClick={() => signOut()}
              className="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"
              title="Sair"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6">
        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Building2 size={16} className="text-primary-500" />
              <span className="text-xs text-slate-500">Organizações</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{organizations.length}</p>
          </div>
          <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Users size={16} className="text-emerald-500" />
              <span className="text-xs text-slate-500">Total de Usuários</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">
              {organizations.reduce((sum, o) => sum + o.userCount, 0)}
            </p>
          </div>
          <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Power size={16} className="text-green-500" />
              <span className="text-xs text-slate-500">Ativas</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">
              {organizations.filter(o => o.is_active !== false).length}
            </p>
          </div>
        </div>

        {/* Action Bar */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">Organizações</h2>
          <button
            onClick={() => setShowCreateForm(true)}
            className="bg-primary-600 hover:bg-primary-500 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-primary-600/20 transition-colors"
          >
            <Plus size={16} /> Nova Organização
          </button>
        </div>

        {/* Create Form Modal */}
        {showCreateForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                <h3 className="font-bold text-slate-900 dark:text-white text-lg">Nova Organização</h3>
                <button onClick={() => setShowCreateForm(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleCreateOrg} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome da Empresa</label>
                  <input
                    required
                    type="text"
                    value={formData.companyName}
                    onChange={e => setFormData(p => ({ ...p, companyName: e.target.value }))}
                    placeholder="Ex: Escritório Silva & Associados"
                    className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome do Administrador</label>
                  <input
                    type="text"
                    value={formData.adminName}
                    onChange={e => setFormData(p => ({ ...p, adminName: e.target.value }))}
                    placeholder="Ex: João Silva"
                    className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Email do Admin</label>
                  <input
                    required
                    type="email"
                    value={formData.adminEmail}
                    onChange={e => setFormData(p => ({ ...p, adminEmail: e.target.value }))}
                    placeholder="admin@empresa.com"
                    className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Senha Inicial</label>
                    <input
                      required
                      type="password"
                      minLength={6}
                      value={formData.adminPassword}
                      onChange={e => setFormData(p => ({ ...p, adminPassword: e.target.value }))}
                      placeholder="Min. 6 caracteres"
                      className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Limite de Usuários</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={formData.maxUsers}
                      onChange={e => setFormData(p => ({ ...p, maxUsers: parseInt(e.target.value) || 1 }))}
                      className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-primary-600/20"
                >
                  {creating ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Criando...</>
                  ) : (
                    <><Plus size={16} /> Criar Organização</>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingOrg && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
            <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
                <h3 className="font-bold text-slate-900 dark:text-white">Editar Organização</h3>
                <button onClick={() => setEditingOrg(null)} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Nome</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Limite de Usuários</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={editMaxUsers}
                    onChange={e => setEditMaxUsers(parseInt(e.target.value) || 5)}
                    className="w-full bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="w-full bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
                >
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Org Detail Drawer */}
        {selectedOrg && (
          <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/60 backdrop-blur-sm">
            <div className="bg-white dark:bg-dark-card w-full max-w-lg h-full overflow-y-auto shadow-2xl border-l border-slate-200 dark:border-white/10">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between sticky top-0 bg-white dark:bg-dark-card z-10">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-lg">{selectedOrg.name}</h3>
                  <p className="text-xs text-slate-500">
                    {selectedOrg.is_active !== false ? (
                      <span className="text-green-500">Ativa</span>
                    ) : (
                      <span className="text-red-500">Desativada</span>
                    )}
                    {' '}· Criada em {new Date(selectedOrg.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <button onClick={() => setSelectedOrg(null)} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {/* Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4">
                    <p className="text-xs text-slate-500 mb-1">Usuários</p>
                    <p className="text-xl font-bold text-slate-900 dark:text-white">
                      {selectedOrg.userCount} <span className="text-sm font-normal text-slate-400">/ {selectedOrg.max_users || '∞'}</span>
                    </p>
                  </div>
                  <div className="bg-slate-50 dark:bg-white/5 rounded-xl p-4">
                    <p className="text-xs text-slate-500 mb-1">Admins / Vendedores</p>
                    <p className="text-xl font-bold text-slate-900 dark:text-white">
                      {selectedOrg.adminCount} / {selectedOrg.vendedorCount}
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditingOrg(selectedOrg)
                      setEditName(selectedOrg.name)
                      setEditMaxUsers(selectedOrg.max_users || 5)
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-slate-200 dark:border-white/10 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <Pencil size={14} /> Editar
                  </button>
                  <button
                    onClick={() => handleToggleActive(selectedOrg)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                      selectedOrg.is_active !== false
                        ? 'bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-500/20 hover:bg-red-100'
                        : 'bg-green-50 dark:bg-green-900/10 text-green-600 dark:text-green-400 border border-green-200 dark:border-green-500/20 hover:bg-green-100'
                    }`}
                  >
                    {selectedOrg.is_active !== false ? (
                      <><PowerOff size={14} /> Desativar</>
                    ) : (
                      <><Power size={14} /> Ativar</>
                    )}
                  </button>
                </div>

                {/* Members */}
                <div>
                  <h4 className="text-sm font-bold text-slate-700 dark:text-white mb-3">Membros da Equipe</h4>
                  {loadingMembers ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {orgMembers.map(member => (
                        <div
                          key={member.id}
                          className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-xl"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-xs font-bold text-primary-600 dark:text-primary-400">
                              {(member.name || member.email || '??').substring(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-900 dark:text-white">
                                {member.name || member.email || 'Sem nome'}
                              </p>
                              <p className="text-xs text-slate-500">{member.email || 'Sem email'}</p>
                            </div>
                          </div>
                          <span className={`text-xs font-bold px-2 py-1 rounded ${
                            member.role === 'admin'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                          }`}>
                            {member.role === 'admin' ? 'Admin' : 'Vendedor'}
                          </span>
                        </div>
                      ))}
                      {orgMembers.length === 0 && (
                        <p className="text-sm text-slate-500 italic text-center py-4">Nenhum membro.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Collaborators Section */}
        <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={18} className="text-primary-500" />
            <h3 className="font-bold text-slate-900 dark:text-white">Colaboradores Super Admin</h3>
          </div>

          <form onSubmit={handleAddCollaborator} className="flex gap-2 mb-4">
            <input
              type="email"
              value={newCollabEmail}
              onChange={e => setNewCollabEmail(e.target.value)}
              placeholder="Email do colaborador..."
              className="flex-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
            />
            <button
              type="submit"
              disabled={addingCollab || !newCollabEmail.trim()}
              className="bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors"
            >
              {addingCollab ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus size={16} />}
              Adicionar
            </button>
          </form>

          <div className="space-y-2">
            {collaborators.map(collab => (
              <div
                key={collab.id}
                className="flex items-center justify-between p-3 bg-slate-50 dark:bg-white/5 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-xs font-bold text-primary-600 dark:text-primary-400">
                    {(collab.name || collab.email || '??').substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-900 dark:text-white">
                      {collab.name || collab.email}
                    </p>
                    <p className="text-xs text-slate-500">{collab.email}</p>
                  </div>
                </div>
                {collab.id !== profile?.id ? (
                  <button
                    onClick={() => handleRemoveCollaborator(collab.id)}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/10 rounded-lg transition-colors"
                    title="Remover acesso Super Admin"
                  >
                    <Trash2 size={16} />
                  </button>
                ) : (
                  <span className="text-[10px] px-2 py-1 bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400 rounded font-bold">
                    VOCE
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Organizations List */}
        <div className="space-y-3">
          {organizations.length === 0 && (
            <div className="bg-white dark:bg-dark-card border border-slate-200 dark:border-white/10 rounded-xl p-12 text-center">
              <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">Nenhuma organização criada ainda.</p>
              <p className="text-sm text-slate-400 mt-1">Clique em "Nova Organização" para começar.</p>
            </div>
          )}

          {organizations.map(org => (
            <div
              key={org.id}
              className={`bg-white dark:bg-dark-card border rounded-xl p-4 flex items-center justify-between hover:shadow-md transition-all ${
                org.is_active === false
                  ? 'border-red-200 dark:border-red-500/20 opacity-60'
                  : 'border-slate-200 dark:border-white/10'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg ${
                  org.is_active === false
                    ? 'bg-slate-400'
                    : 'bg-gradient-to-br from-primary-500 to-primary-700'
                }`}>
                  {org.name.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-slate-900 dark:text-white">{org.name}</h3>
                    {org.is_active === false && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 rounded font-bold">
                        DESATIVADA
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    <Users size={12} className="inline mr-1" />
                    {org.userCount} usuários (máx {org.max_users || '∞'})
                    {' · '}
                    {org.adminCount} admin{org.adminCount !== 1 ? 's' : ''},
                    {' '}
                    {org.vendedorCount} vendedor{org.vendedorCount !== 1 ? 'es' : ''}
                    {' · '}
                    Criada {new Date(org.created_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleViewOrg(org)}
                  className="p-2 text-slate-400 hover:text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-500/10 rounded-lg transition-colors"
                  title="Ver detalhes"
                >
                  <Eye size={18} />
                </button>
                <button
                  onClick={() => {
                    setEditingOrg(org)
                    setEditName(org.name)
                    setEditMaxUsers(org.max_users || 1)
                  }}
                  className="p-2 text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded-lg transition-colors"
                  title="Editar"
                >
                  <Pencil size={18} />
                </button>
                <button
                  onClick={() => handleToggleActive(org)}
                  className={`p-2 rounded-lg transition-colors ${
                    org.is_active !== false
                      ? 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10'
                      : 'text-slate-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10'
                  }`}
                  title={org.is_active !== false ? 'Desativar' : 'Ativar'}
                >
                  {org.is_active !== false ? <PowerOff size={18} /> : <Power size={18} />}
                </button>
                <button
                  onClick={() => handleAccessCRM(org)}
                  disabled={switchingOrgId === org.id}
                  className="p-2 text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 rounded-lg transition-colors disabled:opacity-50"
                  title="Acessar CRM"
                >
                  {switchingOrgId === org.id ? <Loader2 size={18} className="animate-spin" /> : <ExternalLink size={18} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
