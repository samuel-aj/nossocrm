import { THEME_INIT_SCRIPT, buildThemeCss } from '@/lib/theme/themes'
import type { Metadata, Viewport } from 'next'
import { Rubik } from 'next/font/google'
import './globals.css'
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister'
import { ChunkErrorReload } from '@/components/pwa/ChunkErrorReload'
import { InstallBanner } from '@/components/pwa/InstallBanner'
import RootProviders from './providers'

const rubik = Rubik({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'NossoCRM',
  description: 'CRM Inteligente para Gestão de Vendas',
}

// viewport-fit=cover ativa o env(safe-area-inset-*) no iOS (home indicator);
// sem isso o padding de safe-area da BottomNav/sheets calcula sempre 0.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className="dark" suppressHydrationWarning>
      <head>
        {/* Temas (paletas): variáveis de cor por data-theme; roxo (padrão) não gera nada */}
        <style id="crm-themes" dangerouslySetInnerHTML={{ __html: buildThemeCss() }} />
        {/* Aplica tema e claro/escuro salvos ANTES da hidratação (sem piscar) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${rubik.variable} font-sans antialiased bg-[var(--color-bg)] text-[var(--color-text-primary)]`}>
        <ServiceWorkerRegister />
        <ChunkErrorReload />
        <InstallBanner />
        <RootProviders>{children}</RootProviders>
      </body>
    </html>
  )
}
