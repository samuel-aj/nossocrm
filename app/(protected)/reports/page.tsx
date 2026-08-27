'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PageLoader } from '@/components/PageLoader'

/**
 * /reports virou uma seção da Visão Geral: manda para a âncora da página única
 * (links antigos, página inicial configurada como Relatórios, favoritos).
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function Reports() {
    const router = useRouter()
    useEffect(() => {
        router.replace('/dashboard#relatorios')
    }, [router])
    return <PageLoader />
}
