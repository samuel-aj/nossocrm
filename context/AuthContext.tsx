/**
 * @fileoverview Contexto de Autenticação
 * 
 * Provider React que gerencia autenticação Supabase e perfil do usuário.
 * Fornece sessão, usuário, perfil e organizationId para toda a aplicação.
 * 
 * @module context/AuthContext
 * 
 * @example
 * ```tsx
 * // No App.tsx
 * <AuthProvider>
 *   <App />
 * </AuthProvider>
 * 
 * // Em qualquer componente
 * function UserInfo() {
 *   const { user, profile, organizationId, signOut } = useAuth();
 *   
 *   return (
 *     <div>
 *       <span>{profile?.first_name}</span>
 *       <button onClick={signOut}>Sair</button>
 *     </div>
 *   );
 * }
 * ```
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { queryClient } from '@/lib/query';
import { clearTabOrg, pinTabOrg, readTabOrg } from '@/lib/tabOrg';
import { installTabOrgFetch } from '@/lib/tabOrgFetch';
import type { OrganizationId } from '../types';

// Instala (uma vez por aba) o injetor do header x-org-id nos fetches de /api —
// precisa acontecer ANTES de qualquer query, por isso no load do módulo.
installTabOrgFetch();

/**
 * Perfil do usuário no sistema
 * 
 * @interface Profile
 * @property {string} id - UUID do usuário (= auth.users.id)
 * @property {string} email - Email do usuário
 * @property {OrganizationId} organization_id - ID da organização (tenant)
 * @property {'admin' | 'vendedor'} role - Papel do usuário
 * @property {string | null} [first_name] - Primeiro nome
 * @property {string | null} [last_name] - Sobrenome
 * @property {string | null} [nickname] - Apelido
 * @property {string | null} [phone] - Telefone
 * @property {string | null} [avatar_url] - URL do avatar
 * @property {string} [created_at] - Data de criação
 */
interface Profile {
    id: string;
    email: string;
    organization_id: OrganizationId;
    organization_name?: string | null;
    role: 'super_admin' | 'admin' | 'vendedor';
    first_name?: string | null;
    last_name?: string | null;
    nickname?: string | null;
    phone?: string | null;
    avatar_url?: string | null;
    created_at?: string;
}

/**
 * Tipo do contexto de autenticação
 * 
 * @interface AuthContextType
 */
interface AuthContextType {
    /** Sessão Supabase ativa */
    session: Session | null;
    /** Usuário Supabase autenticado */
    user: User | null;
    /** Perfil do usuário com dados da organização */
    profile: Profile | null;
    /** Getter de conveniência para profile.organization_id */
    organizationId: OrganizationId | null;
    /** Se está carregando dados iniciais */
    loading: boolean;
    /** Se a instância foi inicializada (setup feito) */
    isInitialized: boolean | null;
    /** Verifica se instância foi inicializada */
    checkInitialization: () => Promise<void>;
    /** Faz logout do usuário */
    signOut: () => Promise<void>;
    /** Recarrega dados do perfil */
    refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Provider de autenticação
 * 
 * Gerencia sessão Supabase e mantém perfil do usuário sincronizado.
 * Escuta mudanças de estado de autenticação automaticamente.
 * 
 * @param {Object} props - Props do componente
 * @param {React.ReactNode} props.children - Componentes filhos
 * 
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <AuthProvider>
 *       <Router>
 *         <Routes>...</Routes>
 *       </Router>
 *     </AuthProvider>
 *   );
 * }
 * ```
 */
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [profile, setProfile] = useState<Profile | null>(null);
    const [loading, setLoading] = useState(true);
    const [isInitialized, setIsInitialized] = useState<boolean | null>(null);

    // Supabase client pode ser null quando envs não estão configuradas.
    // O app real exige Supabase configurado, mas este guard evita falha no build.
    const sb = supabase;

    const checkInitialization = async () => {
        try {
            if (!sb) {
                setIsInitialized(true);
                return;
            }

            const { data, error } = await sb.rpc('is_instance_initialized');
            if (error) throw error;
            setIsInitialized(data);
        } catch (error) {
            console.error('Error checking initialization:', error);
            setIsInitialized(true);
        }
    };

    const fetchProfile = async (userId: string) => {
        try {
            if (!sb) {
                setProfile(null);
                return;
            }

            const { data, error } = await sb
                .from('profiles')
                .select('*, organizations!profiles_organization_id_fkey(name)')
                .eq('id', userId)
                .single();

            if (error) {
                console.error('Error fetching profile:', error);
            } else {
                const org = (data as any)?.organizations as { name: string } | null;
                const base = {
                    ...data,
                    organization_name: org?.name ?? null,
                    organizations: undefined,
                } as Profile;

                // ORG POR ABA: se esta aba está fixada em OUTRA org (sessionStorage),
                // o perfil exposto pro app reflete a org DA ABA (id, nome e papel do
                // vínculo), não a org "ativa" da sessão — assim duas abas convivem
                // em orgs diferentes. Pin inválido (perdeu o vínculo) é descartado.
                const pinned = readTabOrg();
                if (!pinned && base.organization_id) {
                    pinTabOrg(base.organization_id, base.organization_name);
                    setProfile(base);
                } else if (!pinned || pinned.id === base.organization_id) {
                    setProfile(base);
                } else if (base.role === 'super_admin') {
                    const { data: pinnedOrg } = await sb
                        .from('organizations')
                        .select('name')
                        .eq('id', pinned.id)
                        .maybeSingle();
                    setProfile({
                        ...base,
                        organization_id: pinned.id as OrganizationId,
                        organization_name: (pinnedOrg as { name?: string } | null)?.name ?? pinned.name,
                    });
                } else {
                    const { data: link, error: linkError } = await sb
                        .from('user_organizations')
                        .select('role, organizations!user_organizations_organization_id_fkey(name)')
                        .eq('user_id', base.id)
                        .eq('organization_id', pinned.id)
                        .maybeSingle();
                    if (linkError) {
                        // Falha TRANSITÓRIA (rede/refresh de token): NUNCA abandonar
                        // o pin — abandonar fazia a aba "seguir" a troca de org feita
                        // em outra aba. Mantém a org da aba com o que se sabe; a
                        // próxima fetchProfile (próximo evento) corrige os detalhes.
                        setProfile({
                            ...base,
                            organization_id: pinned.id as OrganizationId,
                            organization_name: pinned.name,
                        });
                    } else if (!link) {
                        // Consulta OK e SEM vínculo: removido da org de verdade —
                        // só então volta pra org do perfil.
                        pinTabOrg(base.organization_id, base.organization_name);
                        setProfile(base);
                    } else {
                        const linkOrg = (link as any)?.organizations as { name?: string } | null;
                        setProfile({
                            ...base,
                            organization_id: pinned.id as OrganizationId,
                            organization_name: linkOrg?.name || pinned.name,
                            role: ((link as { role?: string }).role as Profile['role']) || base.role,
                        });
                    }
                }
            }
        } finally {
            setLoading(false);
        }
    };

    const refreshProfile = async () => {
        if (user?.id) {
            await fetchProfile(user.id);
        }
    };

    useEffect(() => {
        if (!sb) {
            // Sem Supabase configurado: mantém app em estado "deslogado".
            setSession(null);
            setUser(null);
            setProfile(null);
            setIsInitialized(true);
            setLoading(false);
            return;
        }

        checkInitialization();

        sb.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id);
            } else {
                setLoading(false);
            }
        });

        const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
            setSession(session);
            setUser(session?.user ?? null);
            if (session?.user) {
                fetchProfile(session.user.id);
            } else {
                // IMPORTANTE: só limpar o queryClient em SIGNED_OUT explícito.
                // O Supabase dispara INITIAL_SESSION com session=null toda vez
                // que o AuthProvider remonta (ex.: navegação entre route groups
                // `(protected)` ↔ `(admin)`) — limpar o cache nesses momentos
                // transientes deixava telas (ex.: Kanban) vazias até F5.
                if (event === 'SIGNED_OUT') {
                    queryClient.clear();
                    // A marcação de org é da SESSÃO do usuário; sem limpar, o
                    // pin do usuário anterior vira falso conflito no próximo
                    // login nesta mesma aba.
                    clearTabOrg();
                }
                setProfile(null);
                setLoading(false);
            }
        });

        return () => subscription.unsubscribe();
    }, []);

    const signOut = async () => {
        if (sb) await sb.auth.signOut();
        // CRÍTICO: limpa o QueryClient para evitar que dados do usuário anterior
        // vazem para a sessão seguinte (próximo login sem hard reload mostraria
        // listas/contadores da sessão anterior até o staleTime expirar).
        queryClient.clear();
        clearTabOrg();
        setProfile(null);
        setUser(null);
        setSession(null);
    };

    const value = {
        session,
        user,
        profile,
        organizationId: profile?.organization_id ?? null,
        loading,
        isInitialized,
        checkInitialization,
        signOut,
        refreshProfile,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * Hook para acessar contexto de autenticação
 * 
 * Fornece acesso ao usuário autenticado, perfil e funções de auth.
 * Deve ser usado dentro de um AuthProvider.
 * 
 * @returns {AuthContextType} Contexto de autenticação
 * @throws {Error} Se usado fora do AuthProvider
 * 
 * @example
 * ```tsx
 * function ProtectedComponent() {
 *   const { user, profile, organizationId, loading, signOut } = useAuth();
 *   
 *   if (loading) return <Spinner />;
 *   if (!user) return <Navigate to="/login" />;
 *   
 *   return (
 *     <div>
 *       Olá, {profile?.first_name}!
 *       Org: {organizationId}
 *     </div>
 *   );
 * }
 * ```
 */
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
