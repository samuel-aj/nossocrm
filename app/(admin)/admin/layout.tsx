/**
 * Layout do grupo `(admin)`. Providers globais (Query, Toast, Theme, Auth)
 * ficam no root (`app/providers.tsx`) e são compartilhados com `(protected)`,
 * `/login`, `/select-org`. Aqui não há providers adicionais — admin é só
 * uma página dentro da mesma sessão autenticada.
 */
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
