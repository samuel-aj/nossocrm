import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import ConfirmModal from '@/components/ConfirmModal';
import { Loader2, UserPlus, Crown, Briefcase, KeyRound, Mail, Check, X, Sparkles, Clock, RefreshCw, Trash2, Link, Copy, CheckCircle2, KanbanSquare, Phone, Users as UsersIcon, Eye, EyeOff } from 'lucide-react';
import { UserRole } from '@/types/constants';
import { useCRM } from '@/context/CRMContext';
import {
    DEFAULT_VISIBILITY_RULES,
    normalizeVisibilityRules,
    type VisibilityRules,
    type VisibilityScope,
} from '@/lib/permissions/types';

interface Profile {
    id: string;
    email: string;
    role: string;
    organization_id: string;
    created_at: string;
    status: 'active' | 'pending';
    invited_at?: string;
    confirmed_at?: string;
    last_sign_in_at?: string;
}

interface InviteResult {
    email: string;
    success: boolean;
    error?: string;
}

// Gera iniciais e cor consistente baseada no email
const getAvatarProps = (email: string | null | undefined) => {
    const safe = email || '??';
    const initials = safe.substring(0, 2).toUpperCase();
    const colors = [
        'from-violet-500 to-purple-600',
        'from-blue-500 to-cyan-500',
        'from-emerald-500 to-teal-500',
        'from-orange-500 to-amber-500',
        'from-pink-500 to-rose-500',
        'from-indigo-500 to-blue-500',
    ];
    const colorIndex = safe.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
    return { initials, gradient: colors[colorIndex] };
};

// Valida formato de email
const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/**
 * Componente React `UsersPage`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export const UsersPage: React.FC = () => {
    const { profile: currentUserProfile } = useAuth();
    const { addToast } = useToast();
    const [users, setUsers] = useState<Profile[]>([]);
    // Permissões de visualização por usuário (uma entrada por usuário restringido)
    const [visRules, setVisRules] = useState<Record<string, VisibilityRules>>({});
    const [permUser, setPermUser] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newUserRole, setNewUserRole] = useState<string>(UserRole.VENDEDOR);
    // Como convidar: link copiável, convite por email, ou login pronto (email+senha)
    const [inviteMode, setInviteMode] = useState<'link' | 'email' | 'login'>('link');
    const [inviteEmail, setInviteEmail] = useState('');
    const [newLoginPassword, setNewLoginPassword] = useState('');
    const [sendingInvites, setSendingInvites] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null); // id do usuário em ação
    const [userToDelete, setUserToDelete] = useState<Profile | null>(null);
    const [activeInvites, setActiveInvites] = useState<any[]>([]);
    const [expirationDays, setExpirationDays] = useState<number | null>(7); // 7 days default, null = never

    const sb = supabase;

    const fetchUsers = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/users', {
                method: 'GET',
                headers: { accept: 'application/json' },
                credentials: 'include',
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Falha ao carregar usuários (HTTP ${res.status})`);
            }

            setUsers(data?.users || []);
        } catch (err) {
            console.error('Error fetching users:', err);
            setUsers([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchVisibilityRules = useCallback(async () => {
        try {
            const res = await fetch('/api/org/visibility', { credentials: 'include' });
            const data = await res.json().catch(() => null);
            if (!res.ok) return;
            const map: Record<string, VisibilityRules> = {};
            for (const r of data?.rules || []) map[r.user_id] = normalizeVisibilityRules(r.rules);
            setVisRules(map);
        } catch {
            // sem regras carregadas a tela segue normal (botão continua funcionando)
        }
    }, []);

    useEffect(() => {
        void fetchVisibilityRules();
    }, [fetchVisibilityRules]);

    const fetchActiveInvites = useCallback(async () => {
        try {
            const res = await fetch('/api/admin/invites', {
                method: 'GET',
                headers: { accept: 'application/json' },
                credentials: 'include',
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Falha ao carregar convites (HTTP ${res.status})`);
            }

            const invites = data?.invites || [];
            const nowTs = Date.now();
            const validInvites = (invites || []).filter((invite: any) => {
                // Only show invites that are not used
                if (invite.used_at) return false;
                // If no expiration, it's valid
                if (!invite.expires_at) return true;
                // Check if expiration is in the future (with small buffer for timezone issues)
                const expiresTs = Date.parse(invite.expires_at);
                return expiresTs > nowTs;
            });
            // Force state update by creating new array reference
            setActiveInvites([...validInvites]);
        } catch (error) {
            console.error('Error fetching invites:', error);
            // On error, still try to update state to empty array to clear stale data
            setActiveInvites([]);
        }
    }, []);

    const closeModal = useCallback(() => {
        setIsModalOpen(false);
        setError(null);
        setNewUserRole(UserRole.VENDEDOR);
        setExpirationDays(7);
        setInviteMode('link');
        setInviteEmail('');
        setNewLoginPassword('');
    }, []);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    useEffect(() => {
        if (isModalOpen) {
            fetchActiveInvites();
        }
    }, [fetchActiveInvites, isModalOpen]);

    if (!sb) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="text-center max-w-md">
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                        Configuração incompleta
                    </h2>
                    <p className="text-slate-500 dark:text-slate-400">
                        O Supabase não está configurado neste ambiente. Configure as variáveis de ambiente para gerenciar usuários.
                    </p>
                </div>
            </div>
        );
    }

    const handleDeleteUser = (user: Profile) => {
        setUserToDelete(user);
    };

    const handleGenerateLink = async () => {
        setSendingInvites(true);
        setError(null);
        try {
            const expiresAt = expirationDays
                ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000).toISOString()
                : null;

            const res = await fetch('/api/admin/invites', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    role: newUserRole,
                    expiresAt,
                }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Erro ao gerar link (HTTP ${res.status})`);
            }

            // Force refresh of active invites and ensure state updates
            await fetchActiveInvites();
            
            // Small delay to ensure state propagation
            await new Promise(resolve => setTimeout(resolve, 100));
            
            addToast('Novo link gerado!', 'success');
        } catch (err: any) {
            setError(err.message || 'Erro ao gerar link');
        } finally {
            setSendingInvites(false);
        }
    };

    const handleSendEmailInvite = async () => {
        const email = inviteEmail.trim().toLowerCase();
        if (!isValidEmail(email)) {
            setError('Informe um email válido');
            return;
        }
        setSendingInvites(true);
        setError(null);
        try {
            const expiresAt = expirationDays
                ? new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000).toISOString()
                : null;

            const res = await fetch('/api/admin/invites', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    role: newUserRole,
                    expiresAt,
                    email,
                    sendEmail: true,
                }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Erro ao enviar convite (HTTP ${res.status})`);
            }

            if (data?.addedExisting) {
                // Conta já existia: entrou direto na org (aviso vai por email via n8n).
                addToast(
                    data?.emailSent
                        ? `${email} já tinha conta no CRM: foi adicionado à organização e avisado por email.`
                        : `${email} já tinha conta no CRM e foi adicionado à organização (o email de aviso falhou, avise a pessoa).`,
                    'success'
                );
                setInviteEmail('');
                await fetchUsers();
                return;
            }
            await fetchActiveInvites();
            if (data?.emailSent) {
                addToast(`Convite enviado para ${email}`, 'success');
                setInviteEmail('');
            } else {
                // Convite criado mas o email falhou: o link fica na lista pra copiar.
                setError(data?.emailError || 'Convite criado, mas o email não foi enviado. Copie o link e envie direto.');
            }
        } catch (err: any) {
            setError(err.message || 'Erro ao enviar convite');
        } finally {
            setSendingInvites(false);
        }
    };

    const handleCreateLogin = async () => {
        const email = inviteEmail.trim().toLowerCase();
        if (!isValidEmail(email)) {
            setError('Informe um email válido');
            return;
        }
        if (newLoginPassword.length < 6) {
            setError('A senha precisa ter pelo menos 6 caracteres');
            return;
        }
        setSendingInvites(true);
        setError(null);
        try {
            const res = await fetch('/api/admin/users', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    email,
                    password: newLoginPassword,
                    role: newUserRole,
                }),
            });

            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Erro ao criar login (HTTP ${res.status})`);
            }

            if (data?.existing) {
                addToast(
                    data?.emailSent
                        ? `${email} já tinha conta no CRM: foi adicionado à organização com a senha que já usava e avisado por email.`
                        : `${email} já tinha conta no CRM e foi adicionado à organização com a senha que já usava (a senha digitada foi ignorada).`,
                    'success'
                );
            } else {
                addToast(
                    data?.emailSent
                        ? `Login criado e o acesso (email e senha) foi enviado por email para ${email}.`
                        : `Login criado para ${email}, mas o email não foi enviado. Passe o email e a senha pra pessoa.`,
                    'success'
                );
            }
            setInviteEmail('');
            setNewLoginPassword('');
            await fetchUsers();
        } catch (err: any) {
            setError(err.message || 'Erro ao criar login');
        } finally {
            setSendingInvites(false);
        }
    };

    const handleDeleteInvite = async (id: string) => {
        try {
            const res = await fetch(`/api/admin/invites/${id}`, {
                method: 'DELETE',
                headers: { accept: 'application/json' },
                credentials: 'include',
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Erro ao remover link (HTTP ${res.status})`);
            }

            await fetchActiveInvites();
            addToast('Link removido!', 'success');
        } catch (err: any) {
            addToast('Erro ao remover link', 'error');
        }
    };

    const copyLink = (token: string) => {
        const link = `${window.location.origin}/join?token=${token}`;
        navigator.clipboard.writeText(link);
        addToast('Link copiado!', 'success');
    };

    const confirmDeleteUser = async () => {
        if (!userToDelete) return;

        setActionLoading(userToDelete.id);
        setUserToDelete(null);

        try {
            const res = await fetch(`/api/admin/users/${userToDelete.id}`, {
                method: 'DELETE',
                headers: { accept: 'application/json' },
                credentials: 'include',
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                throw new Error(data?.error || `Erro ao remover usuário (HTTP ${res.status})`);
            }

            addToast(
                userToDelete.status === 'pending' ? 'Convite cancelado' : 'Usuário removido',
                'success'
            );
            fetchUsers();
        } catch (err: any) {
            addToast(`Erro: ${err.message}`, 'error');
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="animate-spin h-8 w-8 text-primary-500" />
                    <span className="text-sm text-slate-500 dark:text-slate-400">Carregando equipe...</span>
                </div>
            </div>
        );
    }

    if (currentUserProfile?.role !== UserRole.ADMIN && currentUserProfile?.role !== UserRole.SUPER_ADMIN) {
        return (
            <div className="min-h-[60vh] flex items-center justify-center">
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
                        <KeyRound className="h-8 w-8 text-red-500" />
                    </div>
                    <h2 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">Acesso Restrito</h2>
                    <p className="text-slate-500 dark:text-slate-400 max-w-sm">
                        Apenas administradores podem gerenciar usuários da equipe.
                    </p>
                </div>
            </div>
        );
    }

    const admins = users.filter(u => u.role === UserRole.ADMIN);
    const vendedores = users.filter(u => u.role === UserRole.VENDEDOR);

    return (
        <div className="max-w-4xl mx-auto pb-10">
            {/* Header */}
            <div className="mb-10">
                <div className="flex items-start justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-slate-900 dark:text-white font-display tracking-tight">
                            Sua Equipe
                        </h1>
                        <p className="text-slate-500 dark:text-slate-400 mt-2 text-lg">
                            {users.length} {users.length === 1 ? 'membro' : 'membros'} • {admins.length} admin{admins.length !== 1 && 's'}, {vendedores.length} vendedor{vendedores.length !== 1 && 'es'}
                        </p>
                    </div>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="group flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-500 transition-all shadow-lg shadow-primary-600/25 hover:shadow-xl hover:shadow-primary-600/30 hover:-translate-y-0.5 font-medium"
                    >
                        <UserPlus className="w-4 h-4 transition-transform group-hover:scale-110" />
                        Convidar
                    </button>
                </div>
            </div>

            {/* User Grid */}
            <div className="grid gap-3">
                {users.map((user) => {
                    const { initials, gradient } = getAvatarProps(user.email);
                    const isCurrentUser = user.id === currentUserProfile?.id;

                    return (
                        <div
                            key={user.id}
                            className={`group relative bg-white dark:bg-white/[0.03] border rounded-2xl p-5 transition-all duration-200 hover:shadow-lg dark:hover:bg-white/[0.05] ${isCurrentUser
                                ? 'border-primary-200 dark:border-primary-500/30 ring-1 ring-primary-100 dark:ring-primary-500/10'
                                : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                                }`}
                        >
                            <div className="flex items-center gap-4">
                                {/* Avatar */}
                                <div className={`relative flex-shrink-0 h-14 w-14 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-lg shadow-lg`}>
                                    {initials}
                                    {user.role === UserRole.ADMIN && (
                                        <div className="absolute -top-1 -right-1 h-5 w-5 bg-amber-400 rounded-full flex items-center justify-center shadow-md ring-2 ring-white dark:ring-slate-900">
                                            <Crown className="h-3 w-3 text-amber-900" />
                                        </div>
                                    )}
                                </div>

                                {/* Info */}
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                                            {user.email}
                                        </h3>
                                        {isCurrentUser && (
                                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                                                você
                                            </span>
                                        )}
                                        {/* Super admin da agência adicionado de propósito a esta org */}
                                        {(user as { is_super_admin?: boolean }).is_super_admin && (
                                            <span
                                                className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300"
                                                title="Super admin da agência, adicionado como membro desta organização"
                                            >
                                                super admin
                                            </span>
                                        )}
                                        {user.status === 'pending' && (
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                                <Clock className="h-3 w-3" />
                                                Pendente
                                            </span>
                                        )}
                                        {visRules[user.id] && (
                                            <span
                                                className="inline-flex items-center text-amber-500 dark:text-amber-400"
                                                title="Visualização restrita: este usuário tem permissões de visualização configuradas"
                                                aria-label="Visualização restrita"
                                            >
                                                <EyeOff className="h-3.5 w-3.5" />
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 mt-1.5">
                                        <span className={`inline-flex items-center gap-1.5 text-sm ${user.role === UserRole.ADMIN
                                            ? 'text-amber-600 dark:text-amber-400'
                                            : 'text-slate-500 dark:text-slate-400'
                                            }`}>
                                            {user.role === UserRole.ADMIN ? (
                                                <>
                                                    <Crown className="h-3.5 w-3.5" />
                                                    Administrador
                                                </>
                                            ) : (
                                                <>
                                                    <Briefcase className="h-3.5 w-3.5" />
                                                    Vendedor
                                                </>
                                            )}
                                        </span>
                                        <span className="text-slate-300 dark:text-slate-600">•</span>
                                        <span className="text-sm text-slate-400 dark:text-slate-500">
                                            {user.status === 'pending'
                                                ? `Convidado ${new Date(user.invited_at || user.created_at).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })}`
                                                : `Desde ${new Date(user.created_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })}`
                                            }
                                        </span>
                                    </div>
                                </div>

                                {/* Actions */}
                                {!isCurrentUser && (
                                    <div className="flex items-center gap-1">
                                        {actionLoading === user.id ? (
                                            <div className="p-2">
                                                <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                                            </div>
                                        ) : (
                                            <>
                                                {/* Resend Invite removed as we don't use email invites anymore */}
                                                {user.role === UserRole.VENDEDOR && user.status !== 'pending' && (
                                                    <button
                                                        onClick={() => setPermUser(user)}
                                                        className="opacity-0 group-hover:opacity-100 max-md:opacity-100 p-2 rounded-lg text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/20 transition-all"
                                                        title="Permissões de visualização"
                                                    >
                                                        <Eye className="h-4 w-4" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => handleDeleteUser(user)}
                                                    className="opacity-0 group-hover:opacity-100 max-md:opacity-100 p-2 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                                                    title={user.status === 'pending' ? 'Cancelar convite' : 'Remover usuário'}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Empty State */}
            {users.length === 0 && (
                <div className="text-center py-16">
                    <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-slate-100 dark:bg-white/5 mb-4">
                        <UserPlus className="h-10 w-10 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">Nenhum membro ainda</h3>
                    <p className="text-slate-500 dark:text-slate-400 mb-6 max-w-sm mx-auto">
                        Comece convidando membros da sua equipe para colaborar no CRM.
                    </p>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl hover:bg-primary-500 transition-all font-medium"
                    >
                        <UserPlus className="w-4 h-4" />
                        Convidar primeiro membro
                    </button>
                </div>
            )}

            {permUser && (
                <VisibilityModal
                    user={permUser}
                    members={users.filter(u => u.id !== permUser.id && u.status !== 'pending')}
                    initial={visRules[permUser.id] ?? null}
                    onClose={() => setPermUser(null)}
                    onSaved={(rules) => {
                        setVisRules(prev => {
                            const next = { ...prev };
                            if (rules) next[permUser.id] = rules;
                            else delete next[permUser.id];
                            return next;
                        });
                        setPermUser(null);
                    }}
                />
            )}

            {/* Modal */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
                    onClick={(e) => {
                        // Close only when clicking the backdrop (outside the panel).
                        if (e.target === e.currentTarget) closeModal();
                    }}
                >
                    <div
                        className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden max-md:max-h-[85dvh] max-md:overflow-y-auto animate-in fade-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="px-6 pt-6 pb-4">
                            <div className="flex items-center gap-3 mb-1">
                                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/25">
                                    <Link className="h-5 w-5 text-white" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-slate-900 dark:text-white font-display">
                                        Convidar
                                    </h2>
                                    <p className="text-sm text-slate-500 dark:text-slate-400">
                                        Link, convite por email ou login pronto
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="px-6 pb-6">
                            {/* Active Links List */}
                            <div className="mb-6">
                                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-3">
                                    Links Ativos
                                </h3>

                                {activeInvites.length > 0 ? (
                                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                        {activeInvites.map((invite) => (
                                            <div key={invite.id} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${invite.role === UserRole.ADMIN
                                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                                            : 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                                                            }`}>
                                                            {invite.role}
                                                        </span>
                                                        <span className="text-xs text-slate-400">
                                                            {invite.expires_at
                                                                ? `Expira em ${new Date(invite.expires_at).toLocaleDateString()}`
                                                                : 'Nunca expira'
                                                            }
                                                        </span>
                                                    </div>
                                                    <code className="block text-xs text-slate-600 dark:text-slate-300 truncate">
                                                        {invite.email ? invite.email : `...${invite.token.slice(-8)}`}
                                                    </code>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={() => copyLink(invite.token)}
                                                        className="p-2 text-primary-600 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded-lg transition-colors"
                                                        title="Copiar link"
                                                    >
                                                        <Copy className="h-4 w-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteInvite(invite.id)}
                                                        className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                                                        title="Revogar link"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center p-6 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl">
                                        <p className="text-sm text-slate-500 dark:text-slate-400">
                                            Nenhum link ativo
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-5 border-t border-slate-100 dark:border-white/5 pt-5">
                                {/* Como convidar */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                                        Como convidar
                                    </label>
                                    <div className="grid grid-cols-3 gap-2">
                                        {([
                                            { id: 'link', label: 'Link', hint: 'Gera um link pra você enviar' },
                                            { id: 'email', label: 'Por email', hint: 'Envia o convite pro email da pessoa' },
                                            { id: 'login', label: 'Login pronto', hint: 'Você define email e senha e passa pra pessoa' },
                                        ] as const).map((opt) => (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => { setInviteMode(opt.id); setError(null); }}
                                                title={opt.hint}
                                                className={`py-2 px-2 rounded-lg text-sm font-medium border transition-all ${inviteMode === opt.id
                                                    ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white'
                                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                                    }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                        {inviteMode === 'link' && 'Gera um link de acesso pra você copiar e enviar como quiser.'}
                                        {inviteMode === 'email' && 'A pessoa recebe um email com o link do convite e define a própria senha. Email que já tem conta no CRM entra direto na organização, sem email.'}
                                        {inviteMode === 'login' && 'A conta já nasce pronta: você escolhe o email e a senha, e o acesso completo (com a senha) vai por email pra pessoa. Email que já tem conta entra na organização com a senha que já usa.'}
                                    </p>
                                </div>

                                {/* Email (convite por email e login pronto) */}
                                {inviteMode !== 'link' && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Email da pessoa
                                        </label>
                                        <div className="relative">
                                            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                                            <input
                                                type="email"
                                                value={inviteEmail}
                                                onChange={(e) => setInviteEmail(e.target.value)}
                                                placeholder="cliente@empresa.com"
                                                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Senha (só login pronto) */}
                                {inviteMode === 'login' && (
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                            Senha da pessoa
                                        </label>
                                        <div className="relative">
                                            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                                            <input
                                                type="text"
                                                value={newLoginPassword}
                                                onChange={(e) => setNewLoginPassword(e.target.value)}
                                                placeholder="Mínimo 6 caracteres"
                                                autoComplete="off"
                                                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500"
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Role Selection */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                                        Cargo
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => setNewUserRole(UserRole.VENDEDOR)}
                                            className={`relative p-3 rounded-xl border-2 text-left transition-all ${newUserRole === UserRole.VENDEDOR
                                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                                }`}
                                        >
                                            <div className="flex items-center gap-2 mb-1">
                                                <Briefcase className={`h-4 w-4 ${newUserRole === UserRole.VENDEDOR ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'}`} />
                                                <span className={`font-medium text-sm ${newUserRole === UserRole.VENDEDOR ? 'text-primary-900 dark:text-primary-100' : 'text-slate-700 dark:text-slate-300'}`}>
                                                    Vendedor
                                                </span>
                                            </div>
                                            {newUserRole === UserRole.VENDEDOR && (
                                                <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary-500" />
                                            )}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setNewUserRole(UserRole.ADMIN)}
                                            className={`relative p-3 rounded-xl border-2 text-left transition-all ${newUserRole === UserRole.ADMIN
                                                ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                                                : 'border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                                                }`}
                                        >
                                            <div className="flex items-center gap-2 mb-1">
                                                <Crown className={`h-4 w-4 ${newUserRole === UserRole.ADMIN ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`} />
                                                <span className={`font-medium text-sm ${newUserRole === UserRole.ADMIN ? 'text-amber-900 dark:text-amber-100' : 'text-slate-700 dark:text-slate-300'}`}>
                                                    Admin
                                                </span>
                                            </div>
                                            {newUserRole === UserRole.ADMIN && (
                                                <div className="absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-500" />
                                            )}
                                        </button>
                                    </div>
                                </div>

                                {/* Expiration Selection (login pronto não expira) */}
                                {inviteMode !== 'login' && (
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
                                        Expiração
                                    </label>
                                    <div className="grid grid-cols-3 gap-3">
                                        {[
                                            { label: '7 dias', value: 7 },
                                            { label: '30 dias', value: 30 },
                                            { label: 'Nunca', value: null }
                                        ].map((opt) => (
                                            <button
                                                key={opt.label}
                                                type="button"
                                                onClick={() => setExpirationDays(opt.value)}
                                                className={`py-2 px-3 rounded-lg text-sm font-medium border transition-all ${expirationDays === opt.value
                                                    ? 'bg-slate-800 text-white border-slate-800 dark:bg-white dark:text-slate-900 dark:border-white'
                                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                                                    }`}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                )}

                                {/* Error Message */}
                                {error && (
                                    <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-xl text-sm">
                                        <div className="h-5 w-5 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                                            <span className="text-xs">!</span>
                                        </div>
                                        <span>{error}</span>
                                    </div>
                                )}
                            </div>

                            {/* Modal Footer */}
                            <div className="flex gap-3 mt-8 pt-6 border-t border-slate-100 dark:border-white/5">
                                <button
                                    type="button"
                                    onClick={closeModal}
                                    className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                                >
                                    Fechar
                                </button>

                                <button
                                    onClick={
                                        inviteMode === 'link'
                                            ? handleGenerateLink
                                            : inviteMode === 'email'
                                                ? handleSendEmailInvite
                                                : handleCreateLogin
                                    }
                                    disabled={sendingInvites}
                                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-primary-600/25 transition-all"
                                >
                                    {sendingInvites ? (
                                        <>
                                            <Loader2 className="animate-spin h-4 w-4" />
                                            {inviteMode === 'link' ? 'Gerando...' : inviteMode === 'email' ? 'Enviando...' : 'Criando...'}
                                        </>
                                    ) : inviteMode === 'link' ? (
                                        <>
                                            <Link className="h-4 w-4" />
                                            Gerar Link
                                        </>
                                    ) : inviteMode === 'email' ? (
                                        <>
                                            <Mail className="h-4 w-4" />
                                            Enviar Convite
                                        </>
                                    ) : (
                                        <>
                                            <UserPlus className="h-4 w-4" />
                                            Criar Login
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            <ConfirmModal
                isOpen={!!userToDelete}
                onClose={() => setUserToDelete(null)}
                onConfirm={confirmDeleteUser}
                title={userToDelete?.status === 'pending' ? 'Cancelar Convite' : 'Remover Usuário'}
                message={userToDelete?.status === 'pending'
                    ? `Tem certeza que deseja cancelar o convite para ${userToDelete?.email}?`
                    : `Tem certeza que deseja remover ${userToDelete?.email} da equipe? Os leads, contatos e atividades dele ficam sem responsável (nada é apagado).`
                }
                confirmText={userToDelete?.status === 'pending' ? 'Cancelar Convite' : 'Remover'}
                cancelText="Voltar"
                variant="danger"
            />
        </div>
    );
};


// ---------------------------------------------------------------------------
// Permissões de visualização de um vendedor (Configurações > Equipe)
// ---------------------------------------------------------------------------
const RADIO_CLASS = 'h-4 w-4 accent-primary-600';
const OPTION_ROW =
    'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors border-slate-200 dark:border-white/10 hover:border-primary-300 dark:hover:border-primary-500/40';

function CheckRow({ checked, onToggle, label, sub }: { checked: boolean; onToggle: () => void; label: string; sub?: string }) {
    return (
        <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-50 dark:hover:bg-white/5 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-primary-600" checked={checked} onChange={onToggle} />
            <span className="min-w-0">
                <span className="block text-sm text-slate-800 dark:text-slate-100 truncate">{label}</span>
                {sub ? <span className="block text-[11px] text-slate-400 truncate">{sub}</span> : null}
            </span>
        </label>
    );
}

const VisibilityModal: React.FC<{
    user: Profile;
    members: Profile[];
    initial: VisibilityRules | null;
    onClose: () => void;
    onSaved: (rules: VisibilityRules | null) => void;
}> = ({ user, members, initial, onClose, onSaved }) => {
    const { addToast } = useToast();
    const { boards } = useCRM();
    const base = initial ?? DEFAULT_VISIBILITY_RULES;

    const [scope, setScope] = useState<VisibilityScope>(base.deals.scope);
    const [teamIds, setTeamIds] = useState<string[]>(base.deals.team_user_ids);
    const [allBoards, setAllBoards] = useState(base.boards.board_ids === null);
    const [boardIds, setBoardIds] = useState<string[]>(base.boards.board_ids ?? []);
    const [allConns, setAllConns] = useState(base.whatsapp.connection_ids === null);
    const [connIds, setConnIds] = useState<string[]>(base.whatsapp.connection_ids ?? []);
    const [connections, setConnections] = useState<Array<{ id: string; label: string }>>([]);
    // Conversas por RESPONSÁVEL (dono do lead do contato, como no filtro dos Chats)
    const [allOwners, setAllOwners] = useState(base.whatsapp.owner_user_ids === null);
    const [ownerIds, setOwnerIds] = useState<string[]>(base.whatsapp.owner_user_ids ?? []);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let alive = true;
        (async () => {
            try {
                const res = await fetch('/api/whatsapp/connection', { credentials: 'include' });
                const data = await res.json().catch(() => null);
                if (!alive || !res.ok) return;
                const list = (data?.connections || []) as Array<{
                    id: string;
                    profileName?: string | null;
                    phoneNumber?: string | null;
                    provider?: string | null;
                    status?: string | null;
                }>;
                const providerLabel = (p?: string | null) =>
                    p === 'meta_cloud' ? 'Número via API oficial' : p ? 'Número via QR Code' : 'Número conectado';
                // TODOS os números da org entram na lista (conectados e caídos);
                // nome e número vêm da rota em camelCase (phoneNumber/profileName)
                setConnections(
                    list.map(c => ({
                        id: c.id,
                        label:
                            ([c.profileName, c.phoneNumber].filter(Boolean).join(' · ') || providerLabel(c.provider)) +
                            (c.status === 'connected' ? '' : ' (desconectado)'),
                    }))
                );
            } catch {
                // sem números carregados a seção mostra o aviso de lista vazia
            }
        })();
        return () => {
            alive = false;
        };
    }, []);

    const toggle = (list: string[], setList: (v: string[]) => void, id: string) =>
        setList(list.includes(id) ? list.filter(x => x !== id) : [...list, id]);

    const save = async () => {
        if (scope === 'team' && teamIds.length === 0) {
            addToast('Escolha ao menos um membro da equipe.', 'warning');
            return;
        }
        if (!allBoards && boardIds.length === 0) {
            addToast('Escolha ao menos um quadro.', 'warning');
            return;
        }
        if (!allConns && connIds.length === 0) {
            addToast('Escolha ao menos um número.', 'warning');
            return;
        }
        setSaving(true);
        try {
            const rules: VisibilityRules = {
                deals: { scope, team_user_ids: scope === 'team' ? teamIds : [] },
                boards: { board_ids: allBoards ? null : boardIds },
                whatsapp: {
                    connection_ids: allConns ? null : connIds,
                    label_ids: base.whatsapp.label_ids,
                    owner_user_ids: allOwners ? null : ownerIds,
                },
            };
            const res = await fetch(`/api/org/visibility/${user.id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ rules }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) throw new Error(data?.error || `Falha ao salvar (HTTP ${res.status})`);
            addToast('Permissões salvas.', 'success');
            onSaved(data?.rules ?? null);
        } catch (e) {
            addToast((e as Error).message, 'error');
        } finally {
            setSaving(false);
        }
    };

    const activeBoards = boards.filter(b => !(b as { deletedAt?: string | null }).deletedAt);

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={e => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden max-h-[88dvh] flex flex-col animate-in fade-in zoom-in-95 duration-200">
                <div className="px-6 pt-6 pb-4 border-b border-slate-100 dark:border-white/5">
                    <div className="flex items-center gap-3">
                        <span className="h-10 w-10 rounded-xl bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 flex items-center justify-center">
                            <Eye className="h-5 w-5" />
                        </span>
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Permissões de visualização</h2>
                            <p className="text-sm text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
                        </div>
                    </div>
                </div>

                <div className="px-6 py-4 space-y-6 overflow-y-auto">
                    {/* Leads */}
                    <section>
                        <p className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 mb-1">
                            <UsersIcon className="h-4 w-4 text-primary-500" /> Leads (negócios)
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                            Vale nos quadros, nas listas e em tudo que mostra leads. Leads sem responsável ficam sempre
                            visíveis, para alguém poder assumir.
                        </p>
                        <div className="space-y-2">
                            {(
                                [
                                    ['all', 'Todos', 'Vê os leads de todos os vendedores da organização.'],
                                    ['own', 'Somente próprios', 'Só vê os leads em que ele é o responsável.'],
                                    ['team', 'Equipe', 'Vê os próprios e os dos membros escolhidos abaixo.'],
                                ] as Array<[VisibilityScope, string, string]>
                            ).map(([value, label, help]) => (
                                <label key={value} className={OPTION_ROW}>
                                    <input
                                        type="radio"
                                        name="vis-scope"
                                        className={`${RADIO_CLASS} mt-0.5`}
                                        checked={scope === value}
                                        onChange={() => setScope(value)}
                                    />
                                    <span>
                                        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
                                        <span className="block text-xs text-slate-500 dark:text-slate-400">{help}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        {scope === 'team' && (
                            <div className="mt-2 rounded-xl border border-slate-200 dark:border-white/10 max-h-44 overflow-y-auto py-1">
                                {members.length === 0 ? (
                                    <p className="px-3 py-3 text-xs text-slate-500">Nenhum outro membro na equipe.</p>
                                ) : (
                                    members.map(m => (
                                        <CheckRow
                                            key={m.id}
                                            checked={teamIds.includes(m.id)}
                                            onToggle={() => toggle(teamIds, setTeamIds, m.id)}
                                            label={m.email}
                                            sub={m.role === UserRole.ADMIN ? 'Administrador' : 'Vendedor'}
                                        />
                                    ))
                                )}
                            </div>
                        )}
                    </section>

                    {/* Quadros */}
                    <section>
                        <p className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 mb-1">
                            <KanbanSquare className="h-4 w-4 text-primary-500" /> Quadros (pipelines)
                        </p>
                        <div className="space-y-2">
                            <label className={OPTION_ROW}>
                                <input type="radio" name="vis-boards" className={`${RADIO_CLASS} mt-0.5`} checked={allBoards} onChange={() => setAllBoards(true)} />
                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Todos os quadros</span>
                            </label>
                            <label className={OPTION_ROW}>
                                <input type="radio" name="vis-boards" className={`${RADIO_CLASS} mt-0.5`} checked={!allBoards} onChange={() => setAllBoards(false)} />
                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Somente estes</span>
                            </label>
                        </div>
                        {!allBoards && (
                            <div className="mt-2 rounded-xl border border-slate-200 dark:border-white/10 max-h-44 overflow-y-auto py-1">
                                {activeBoards.length === 0 ? (
                                    <p className="px-3 py-3 text-xs text-slate-500">Nenhum quadro na organização.</p>
                                ) : (
                                    activeBoards.map(b => (
                                        <CheckRow
                                            key={b.id}
                                            checked={boardIds.includes(b.id)}
                                            onToggle={() => toggle(boardIds, setBoardIds, b.id)}
                                            label={b.name}
                                        />
                                    ))
                                )}
                            </div>
                        )}
                    </section>

                    {/* Números de WhatsApp */}
                    <section>
                        <p className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 mb-1">
                            <Phone className="h-4 w-4 text-primary-500" /> Números de WhatsApp
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                            Controla quais conversas aparecem na página Chats e por quais números ele pode enviar.
                        </p>
                        <div className="space-y-2">
                            <label className={OPTION_ROW}>
                                <input type="radio" name="vis-conns" className={`${RADIO_CLASS} mt-0.5`} checked={allConns} onChange={() => setAllConns(true)} />
                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Todos os números</span>
                            </label>
                            <label className={OPTION_ROW}>
                                <input type="radio" name="vis-conns" className={`${RADIO_CLASS} mt-0.5`} checked={!allConns} onChange={() => setAllConns(false)} />
                                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Somente estes</span>
                            </label>
                        </div>
                        {!allConns && (
                            <div className="mt-2 rounded-xl border border-slate-200 dark:border-white/10 max-h-44 overflow-y-auto py-1">
                                {connections.length === 0 ? (
                                    <p className="px-3 py-3 text-xs text-slate-500">Nenhum número conectado na organização.</p>
                                ) : (
                                    connections.map(c => (
                                        <CheckRow
                                            key={c.id}
                                            checked={connIds.includes(c.id)}
                                            onToggle={() => toggle(connIds, setConnIds, c.id)}
                                            label={c.label}
                                        />
                                    ))
                                )}
                            </div>
                        )}

                        {/* Conversas por RESPONSÁVEL (o dono do lead do contato, como no filtro dos Chats) */}
                        <div className="mt-4 pt-3 border-t border-slate-100 dark:border-white/5">
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Conversas por responsável</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                                O responsável do chat é o dono do lead daquele contato, igual ao filtro da página Chats.
                            </p>
                            <div className="space-y-2">
                                <label className={OPTION_ROW}>
                                    <input type="radio" name="vis-owners" className={`${RADIO_CLASS} mt-0.5`} checked={allOwners} onChange={() => setAllOwners(true)} />
                                    <span>
                                        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Todas as conversas</span>
                                        <span className="block text-xs text-slate-500 dark:text-slate-400">De qualquer responsável, nos números permitidos.</span>
                                    </span>
                                </label>
                                <label className={OPTION_ROW}>
                                    <input type="radio" name="vis-owners" className={`${RADIO_CLASS} mt-0.5`} checked={!allOwners} onChange={() => setAllOwners(false)} />
                                    <span>
                                        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">Somente destes responsáveis</span>
                                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                                            As dele mesmo, sempre; e as dos escolhidos abaixo. Conversas sem responsável continuam
                                            visíveis (é assim que um lead novo é assumido).
                                        </span>
                                    </span>
                                </label>
                            </div>
                            {!allOwners && (
                                <div className="mt-2 rounded-xl border border-slate-200 dark:border-white/10 max-h-44 overflow-y-auto py-1">
                                    <div className="px-3 py-2 text-xs text-slate-400 flex items-center gap-2">
                                        <Check className="h-3.5 w-3.5 text-emerald-500" /> {user.email} (ele mesmo, sempre incluído)
                                    </div>
                                    {members.length === 0 ? (
                                        <p className="px-3 py-3 text-xs text-slate-500">Nenhum outro membro na equipe.</p>
                                    ) : (
                                        members.map(m => (
                                            <CheckRow
                                                key={m.id}
                                                checked={ownerIds.includes(m.id)}
                                                onToggle={() => toggle(ownerIds, setOwnerIds, m.id)}
                                                label={m.email}
                                                sub={m.role === UserRole.ADMIN ? 'Administrador' : 'Vendedor'}
                                            />
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </section>

                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                        As permissões valem na interface e no servidor: leads e quadros são cortados na própria leitura do
                        banco, e as conversas de WhatsApp nas rotas do sistema. Administradores sempre veem tudo.
                    </p>
                </div>

                <div className="px-6 py-4 border-t border-slate-100 dark:border-white/5 flex items-center justify-end gap-2">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/10"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => void save()}
                        disabled={saving}
                        className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-primary-600 hover:bg-primary-500 disabled:opacity-50 inline-flex items-center gap-2"
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Salvar
                    </button>
                </div>
            </div>
        </div>
    );
};
