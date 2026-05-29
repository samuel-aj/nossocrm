'use client'

import { QueryProvider } from '@/lib/query'
import { ToastProvider } from '@/context/ToastContext'
import { ThemeProvider } from '@/context/ThemeContext'
import { AuthProvider } from '@/context/AuthContext'

/**
 * Providers globais montados UMA vez no root layout.
 *
 * Antes esses providers eram duplicados em cada route group
 * (`(protected)/layout.tsx` e `(admin)/admin/layout.tsx`), fazendo com que
 * navegar entre `/dashboard` ↔ `/admin` desmontasse tudo e remontasse do
 * zero — AuthProvider voltava a `loading=true`, queries com `enabled:
 * !authLoading && !!user` ficavam bloqueadas, e telas apareciam vazias
 * por algumas centenas de ms até a sessão reiniciar.
 *
 * Mantendo-os no root, navegação entre rotas é instantânea: a sessão
 * persiste, o cache do TanStack Query persiste, observers das queries
 * permanecem ativos.
 *
 * Páginas públicas (`/login`, `/select-org`) também herdam — o que permite
 * `useAuth()` nelas (antes precisava ser evitado).
 */
export default function RootProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ToastProvider>
        <ThemeProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </ToastProvider>
    </QueryProvider>
  )
}
