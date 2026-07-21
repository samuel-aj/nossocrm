'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const TemplatesPage = dynamic(
    () => import('@/features/templates/TemplatesPage').then(m => ({ default: m.TemplatesPage })),
    { loading: () => <PageLoader />, ssr: false }
)

export default function Modelos() {
    return <TemplatesPage />
}
