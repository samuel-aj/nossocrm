'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const FeedbackPage = dynamic(
    () => import('@/features/feedback/FeedbackPage').then(m => ({ default: m.FeedbackPage })),
    { loading: () => <PageLoader />, ssr: false }
)

export default function Suggestions() {
    return <FeedbackPage />
}
