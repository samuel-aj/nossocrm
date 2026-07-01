'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const TutorialPage = dynamic(
    () => import('@/features/tutorial/TutorialPage').then(m => ({ default: m.TutorialPage })),
    { loading: () => <PageLoader />, ssr: false }
)

export default function Tutorial() {
    return <TutorialPage />
}
