'use client'

import dynamic from 'next/dynamic'
import { PageLoader } from '@/components/PageLoader'

const SettingsPage = dynamic(
  () => import('@/features/settings/SettingsPage'),
  { loading: () => <PageLoader />, ssr: false }
)

/**
 * Componente React `SettingsAgentes`.
 * @returns {Element} Retorna um valor do tipo `Element`.
 */
export default function SettingsAgentes() {
  return <SettingsPage tab="ai" />
}
