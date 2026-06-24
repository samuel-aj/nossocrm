'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const SuggestionsPage = dynamic(
    () => import('@/features/suggestions/SuggestionsPage').then(m => ({ default: m.SuggestionsPage })),
    { loading: () => <PageLoader />, ssr: false }
)

export default function Suggestions() {
    return <SuggestionsPage />
}
