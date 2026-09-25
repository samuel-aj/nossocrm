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

import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase/client';
import { queryClient } from '@/lib/query';
import { clearTabOrg, pinTabOrg, readTabOrg } from '@/lib/tabOrg';
import { installTabOrgFetch } from '@/lib/tabOrgFetch';
import { loadAuthProfile } from '@/lib/supabase/authProfile';
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
export interface Profile {
    id: string;
    email: string;
    organization_id: OrganizationId;
    organization_name?: string | null;
    role: 'super_admin' | 'admin' | 'vendedor';
    /** Nome exibido (colunas reais do banco: name/display_name preenchidos; first_name/nickname costumam ser nulos) */
    name?: string | null;
    display_name?: string | null;
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
    /** Falha recuperável ao carregar o perfil; não é uma troca de usuário. */
    profileError: string | null;
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
    const [profileError, setProfileError] = useState<string | null>(null);
    const mountedRef = useRef(false);
    const userIdRef = useRef<string | null>(null);
    const profileRef = useRef<Profile | null>(null);
    const requestRef = useRef<{
        key: string;
        cancelled: boolean;
        controller: AbortController;
        promise: Promise<void>;
    } | null>(null);
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

    const cancelProfileRequest = useCallback(() => {
        const request = requestRef.current;
        if (request) {
            request.cancelled = true;
            request.controller.abort();
            requestRef.current = null;
        }
    }, []);

    const fetchProfile = useCallback((userId: string): Promise<void> => {
        if (!sb || !mountedRef.current || userIdRef.current !== userId) return Promise.resolve();
        const pinned = readTabOrg();
        const key = `${userId}:${pinned?.id ?? ''}`;
        if (requestRef.current?.key === key) return requestRef.current.promise;
        cancelProfileRequest();
        setProfileError(null);
        if (!profileRef.current) setLoading(true);
        const request = { key, cancelled: false, controller: new AbortController(), promise: Promise.resolve() };
        requestRef.current = request;
        const isCurrent = () => mountedRef.current && !request.cancelled
            && requestRef.current === request && userIdRef.current === userId;

        request.promise = (async () => {
            // O callback de auth deve terminar antes de iniciar consultas autenticadas.
            await new Promise(resolve => setTimeout(resolve, 0));
            for (const delay of [0, 600, 1500]) {
                if (delay) await new Promise(resolve => setTimeout(resolve, delay));
                if (!isCurrent()) return;
                request.controller = new AbortController();
                let timeout: ReturnType<typeof setTimeout> | undefined;
                try {
                    const resolved = await Promise.race([
                        loadAuthProfile(userId, pinned, request.controller.signal),
                        new Promise<never>((_, reject) => {
                            timeout = setTimeout(() => {
                                request.controller.abort();
                                reject(new Error('Tempo esgotado ao carregar o perfil.'));
                            }, 8000);
                        }),
                    ]);
                    if (!isCurrent()) return;
                    if ((readTabOrg()?.id ?? null) !== (pinned?.id ?? null)) {
                        // A organização desta aba mudou durante a consulta.
                        void fetchProfile(userId);
                        return;
                    }
                    if (resolved.organization_id) pinTabOrg(resolved.organization_id, resolved.organization_name);
                    profileRef.current = resolved;
                    setProfile(resolved);
                    setProfileError(null);
                    return;
                } catch (error) {
                    if (!isCurrent()) return;
                    if (delay === 1500) {
                        console.error('Error fetching profile after retries:', error);
                        setProfileError('Não foi possível carregar seu perfil. Verifique sua conexão e tente novamente.');
                    }
                } finally {
                    clearTimeout(timeout);
                }
            }
        })().finally(() => {
            if (isCurrent()) {
                requestRef.current = null;
                setLoading(false);
            }
        });
        return request.promise;
    }, [sb, cancelProfileRequest]);

    const refreshProfile = useCallback(async () => {
        if (userIdRef.current) await fetchProfile(userIdRef.current);
    }, [fetchProfile]);

    useEffect(() => {
        mountedRef.current = true;
        if (!sb) {
            setIsInitialized(true);
            setLoading(false);
            return () => { mountedRef.current = false; };
        }

        void checkInitialization();
        let active = true;
        let authEventReceived = false;
        const acceptSession = (next: Session | null, signedOut = false) => {
            if (!active) return;
            const nextId = next?.user.id ?? null;
            if (nextId !== userIdRef.current || signedOut) {
                cancelProfileRequest();
                // Invalida também uma consulta antiga quando há troca de conta sem reload.
                if (signedOut || (userIdRef.current && nextId && nextId !== userIdRef.current)) {
                    queryClient.clear();
                    clearTabOrg();
                }
                profileRef.current = null;
                setProfile(null);
                setProfileError(null);
            }
            userIdRef.current = nextId;
            setSession(next);
            setUser(next?.user ?? null);
            if (nextId) void fetchProfile(nextId);
            else setLoading(false);
        };

        const { data: { subscription } } = sb.auth.onAuthStateChange((event, next) => {
            authEventReceived = true;
            acceptSession(next, event === 'SIGNED_OUT');
        });
        // Fallback de inicialização: nunca sobrepor um evento de auth mais recente.
        void sb.auth.getSession().then(({ data: { session: initial } }) => {
            if (!authEventReceived) acceptSession(initial);
        }).catch(error => {
            if (active && !authEventReceived) {
                console.error('Error loading session:', error);
                setLoading(false);
            }
        });

        const retryMissingProfile = () => {
            if (userIdRef.current && !profileRef.current) void fetchProfile(userIdRef.current);
        };
        window.addEventListener('online', retryMissingProfile);
        window.addEventListener('focus', retryMissingProfile);
        return () => {
            active = false;
            mountedRef.current = false;
            cancelProfileRequest();
            subscription.unsubscribe();
            window.removeEventListener('online', retryMissingProfile);
            window.removeEventListener('focus', retryMissingProfile);
        };
    }, [sb, fetchProfile, cancelProfileRequest]);

    const signOut = async () => {
        if (sb) await sb.auth.signOut();
        cancelProfileRequest();
        userIdRef.current = null;
        profileRef.current = null;
        queryClient.clear();
        clearTabOrg();
        setProfile(null);
        setProfileError(null);
        setUser(null);
        setSession(null);
        setLoading(false);
    };

    const value = {
        session,
        user,
        profile,
        organizationId: profile?.organization_id ?? null,
        loading,
        profileError,
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
