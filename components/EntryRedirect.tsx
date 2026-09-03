'use client';

/**
 * Página inicial configurável (Configurações → Geral → Navegação).
 *
 * Todo fluxo de entrada do CRM (login, troca de organização, "/") termina em
 * /dashboard. Na PRIMEIRA tela de cada sessão da aba, se a pessoa escolheu
 * outra página inicial, trocamos por ela. Depois disso a navegação é livre
 * (abrir /dashboard pelo menu continua funcionando).
 *
 * A preferência vem do SettingsContext (user_settings.default_route, com cópia
 * no localStorage para aplicar antes de o servidor responder).
 */
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { DEFAULT_ROUTE_STORAGE_KEY, useSettings } from '@/context/settings/SettingsContext';

const SESSION_KEY = 'crm_entry_redirect_done';
const LANDING = '/dashboard';

function readLocalDefault(): string | null {
  try {
    const raw = localStorage.getItem(DEFAULT_ROUTE_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as unknown;
    return typeof v === 'string' && v.startsWith('/') ? v : null;
  } catch {
    return null;
  }
}

export default function EntryRedirect() {
  const pathname = usePathname();
  const router = useRouter();
  const { defaultRoute, loading } = useSettings();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    // Só decide na tela de entrada; qualquer outra rota já é escolha da pessoa.
    if (pathname !== LANDING) {
      sessionStorage.setItem(SESSION_KEY, '1');
      return;
    }
    // Preferência local aplica na hora; sem ela, espera o servidor.
    const local = readLocalDefault();
    const target = local ?? (loading ? null : defaultRoute);
    if (target === null) return;
    sessionStorage.setItem(SESSION_KEY, '1');
    if (target && target !== LANDING) router.replace(target);
  }, [pathname, defaultRoute, loading, router]);

  return null;
}
