# AGENTS.md — NossoCRM

## Commands
- **Dev**: `npm run dev`
- **Build**: `npm run build`
- **Lint**: `npm run lint` (zero warnings enforced)
- **Typecheck**: `npm run typecheck`
- **Tests**: `npm test` (watch) | `npm run test:run` (single run) | `npx vitest path/to/file.test.ts` (single file)

## Architecture
- **Next.js 16 (App Router)**: routes in `app/`, protected routes under `app/(protected)/`
- **Supabase**: Auth + Postgres + RLS. Clients in `lib/supabase/` (client/server/service-role)
- **Proxy auth**: `proxy.ts` + `lib/supabase/middleware.ts` (not middleware.ts); excludes `/api/*`
- **State**: TanStack Query with facades in `context/`, queries in `lib/query/`
- **Cache**: Single Source of Truth pattern (see Cache Rules below)
- **AI**: SDK v6, chat via `/api/ai/chat`, tools in `lib/ai/tools.ts` (always filter by `organization_id`)

## Deploy & Restore Points (CRITICAL)
- Production = push to `main` (Vercel deploys automatically). The CRM is in use: never push to `main` without the owner's explicit OK.
- Other sessions publish to `main` in parallel: always `git fetch` and merge `origin/main` before pushing.
- Before every push to `main`, bookmark what is live: `npm run checkpoint -- <short-name>` (creates and pushes the tag `prod-pre-<short-name>` at the current production commit).
- A release that needs SQL ships with an undo file `docs/<name>-rollback.sql` whose header says when to use it and whether it runs before or after rolling the code back. Add the pair to the table in `docs/restauracao.md`.
- Never force-push or delete `main`, and never delete `prod-pre-*` tags.
- Never run destructive SQL or delete Storage files in production without a restore path (Storage objects are NOT covered by database backups).
- How to roll back code, schema and data: `docs/restauracao.md`.

## Cache Rules (CRITICAL)
- **One cache per entity**: All operations (CRUD, Realtime, optimistic) use the SAME cache
- **Deals**: Always use `[...queryKeys.deals.lists(), 'view']` for all mutations
- **Other entities**: Use `queryKeys.{entity}.lists()` for mutations
- **NEVER use** `queryKeys.*.list({ filter })` for optimistic updates - those are separate caches
- **Prefer** `setQueryData` over `invalidateQueries` for instant UI updates

## Code Style
- TypeScript 5.x strict, React 19, Tailwind CSS v4, Radix UI primitives
- Shared components in `components/`, feature modules in `features/`
- Imports: use `@/` alias (e.g., `@/lib/utils`, `@/components/ui`)
- Naming: camelCase for variables/functions, PascalCase for components/types
- Tests: Vitest + happy-dom + React Testing Library; place `.test.ts(x)` files alongside source
