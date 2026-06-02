import type { Metadata } from 'next'
import { Rubik } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister'
import { InstallBanner } from '@/components/pwa/InstallBanner'
import RootProviders from './providers'

const rubik = Rubik({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'NossoCRM',
  description: 'CRM Inteligente para Gestão de Vendas',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <body className={`${rubik.variable} font-sans antialiased bg-[var(--color-bg)] text-[var(--color-text-primary)]`}>
        <ServiceWorkerRegister />
        <InstallBanner />
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  )
}
