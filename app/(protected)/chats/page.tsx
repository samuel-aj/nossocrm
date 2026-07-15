'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const ChatsPage = dynamic(
    () => import('@/features/chats/ChatsPage').then(m => ({ default: m.ChatsPage })),
    { loading: () => <PageLoader />, ssr: false }
)

export default function Chats() {
    return <ChatsPage />
}
