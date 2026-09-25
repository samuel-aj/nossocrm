/**
 * Next.js 16+ Proxy (ex-"middleware")
 *
 * Convenção oficial:
 * - Este arquivo precisa se chamar `proxy.ts|js` e ficar na raiz (ou em `src/`).
 * - Deve exportar APENAS uma função (default export ou named `proxy`).
 * - Pode exportar `config.matcher` para limitar onde roda.
 *
 * Referências oficiais:
 * - https://nextjs.org/docs/app/api-reference/file-conventions/proxy
 * - https://nextjs.org/docs/app/api-reference/file-conventions/proxy#migration-to-proxy
 *
 * Neste projeto, o Proxy é usado só para:
 * - refresh de sessão do Supabase SSR
 * - redirects de páginas protegidas para `/login`
 *
 * Importante:
 * - NÃO queremos interceptar `/api/*` aqui, porque Route Handlers já tratam auth
 *   e um redirect 307 para /login quebra clientes (ex: fetch do chat).
 */

import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

/**
 * Função pública `proxy` do projeto.
 *
 * @param {NextRequest} request - Objeto da requisição.
 * @returns {Promise<NextResponse<unknown>>} Retorna um valor do tipo `Promise<NextResponse<unknown>>`.
 */
export async function proxy(request: NextRequest) {
    return await updateSession(request)
}

export const config = {
    matcher: [
        /*
         * Match all request paths exceto:
         * - api (Route Handlers)
         * - _next/static, _next/image
         * - _next/data (mesmo excluindo, o Next pode ainda invocar o Proxy para /_next/data por segurança)
         * - arquivos de metadata (manifest, sitemap, robots)
         * - service worker e página offline neutra (sem sessão/dados do CRM)
         * - assets (imagens)
         */
        '/((?!api|_next/static|_next/image|_next/data|sw[.]js$|offline[.]html$|favicon.ico|sitemap.xml|robots.txt|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
