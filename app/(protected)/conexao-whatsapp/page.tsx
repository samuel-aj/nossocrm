'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const WhatsAppConnectionPage = dynamic(
    () => import('@/features/whatsapp/WhatsAppConnectionPage').then(m => ({ default: m.WhatsAppConnectionPage })),
    { loading: () => <PageLoader />, ssr: false }
)

export default function ConexaoWhatsApp() {
    return <WhatsAppConnectionPage />
}
