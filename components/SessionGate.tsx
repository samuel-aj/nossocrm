'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Button } from '@/components/ui/button';

/** Os providers do CRM só montam com a sessão e o perfil da mesma pessoa resolvidos. */
export default function SessionGate({ children }: { children: ReactNode }) {
  const { user, profile, loading, profileError, refreshProfile, signOut } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (user && profile?.id === user.id) return children;
  if (!loading && !user) return null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--color-bg)] p-6 text-slate-900 dark:text-white">
      {profileError && !loading ? (
        <section role="alert" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm dark:border-white/10 dark:bg-dark-card">
          <h1 className="text-xl font-semibold">Não foi possível carregar seu perfil</h1>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Verifique sua conexão e tente novamente.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button className="rounded-xl bg-primary-600 text-white hover:bg-primary-700" onClick={() => void refreshProfile()}><RefreshCw size={16} className="mr-2" />Tentar novamente</Button>
            <Button variant="outline" className="rounded-xl border-slate-200 hover:bg-slate-50 dark:border-white/10 dark:hover:bg-white/5" onClick={() => void signOut()}>Sair da conta</Button>
          </div>
        </section>
      ) : (
        <div role="status" className="flex items-center gap-3 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 size={20} aria-hidden="true" className="animate-spin text-primary-600 dark:text-primary-400" />
          Carregando seu perfil…
        </div>
      )}
    </main>
  );
}
