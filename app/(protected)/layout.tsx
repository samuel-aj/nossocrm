'use client'

import { usePathname } from 'next/navigation'

import { CRMProvider } from '@/context/CRMContext'
import { AIProvider } from '@/context/AIContext'
import Layout from '@/components/Layout'

/**
 * Layout do grupo `(protected)`. Providers globais (Query, Toast, Theme,
 * Auth) ficam no root (`app/providers.tsx`) — aqui só ficam os providers
 * específicos da área autenticada do app (CRM, AI) que dependem de auth
 * já estar resolvido.
 */
export default function ProtectedLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const pathname = usePathname()
    const isSetupRoute = pathname === '/setup'
    const isLabsRoute = pathname === '/labs' || pathname.startsWith('/labs/')
    const shouldUseAppShell = !isSetupRoute && !isLabsRoute

    return (
        <CRMProvider>
            <AIProvider>
                {shouldUseAppShell ? <Layout>{children}</Layout> : children}
            </AIProvider>
        </CRMProvider>
    )
}

