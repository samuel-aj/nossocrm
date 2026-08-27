'use client'

import { useEffect } from 'react'
import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

// Dynamic import with loading state
const DashboardPage = dynamic(
    () => import('@/features/dashboard/DashboardPage'),
    {
        loading: () => <PageLoader />,
        ssr: false
    }
)

// Relatórios de Performance: mesma página, em sequência (sem loader próprio;
// a Visão Geral já ocupa a tela enquanto este pedaço carrega)
const ReportsPage = dynamic(
    () => import('@/features/reports/ReportsPage'),
    { loading: () => null, ssr: false }
)

/**
 * Visão Geral + Relatórios de Performance numa página só: a visão geral
 * primeiro e, rolando para baixo, os relatórios (âncora #relatorios).
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function Dashboard() {
    // Chegou por /dashboard#relatorios (menu ou a rota antiga /reports): rola
    // até a seção assim que ela existir (os componentes carregam sob demanda).
    useEffect(() => {
        if (typeof window === 'undefined') return
        const scrollToReports = () => {
            if (window.location.hash !== '#relatorios') return false
            const el = document.getElementById('relatorios')
            if (!el) return false
            el.scrollIntoView({ behavior: 'smooth', block: 'start' })
            return true
        }
        let tries = 0
        const timer = window.setInterval(() => {
            tries += 1
            if (scrollToReports() || tries > 40 || window.location.hash !== '#relatorios') window.clearInterval(timer)
        }, 100)
        const onHash = () => {
            scrollToReports()
        }
        window.addEventListener('hashchange', onHash)
        return () => {
            window.clearInterval(timer)
            window.removeEventListener('hashchange', onHash)
        }
    }, [])

    return (
        <div className="flex flex-col">
            <DashboardPage />
            <ReportsPage embedded />
        </div>
    )
}
