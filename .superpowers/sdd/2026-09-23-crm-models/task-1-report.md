# Task 1 — Biblioteca de modelos de robôs

Implemented and committed as `7a56b691507e55d1602564d50df8de94cdb370e6` (`feat(robots): add portable private and official model library`). No remote writes, migration application, deployment, actual WhatsApp sends, or robot activation were performed.

## Delivered

- New robot entry offers blank flow, private/official library, and versioned JSON import (1 MB maximum; bounded request reader).
- Editor exports the current draft and saves private or official snapshots. Real persisted profile role, not tab impersonation role, controls official creation/publication. Official snapshots start unpublished; superadmin can publish/unpublish in the library.
- Portable format `nossocrm.bot`, version 1, keeps branch edges, timeout/button paths, trigger position, groups, order, and layout. Every resource dependency has its own abstract reference; references include numbers, boards/stages (including legacy and clause conditions), message templates, agents, other robots, owners, custom fields/variables, and webhooks.
- Each import creates a separate disabled bot in the destination org. UI remaps resources; unresolved resources stay explicitly marked, visible in the editor, and are blocked by POST/PATCH activation guards. Numbers represented in a model must be mapped at import because the legacy primary number is a DB FK; other resources can be completed in the editor.
- Webhook URLs, secrets and body templates are removed and require destination configuration. Signed/query/credential-bearing URLs in free text are replaced with a pending-review marker. Snapshot reads and imports revalidate/sanitize.
- All actual destination references are checked against organization ownership, including board-stage consistency. Superadmin profiles cannot be assigned as owners and are excluded from shared editor options.
- Private snapshots never cross organizations. Published official snapshots expose no source org or creator. Source IDs are abstracted; imports need no access to the origin organization.
- Existing template/number compatibility validation remains. Following controller feedback, CRM-only/end flows do not acquire a new number requirement; WhatsApp actions still require a selected number.
- Additive migration created with `npx supabase migration new bot_templates`: table, indexes, RLS, explicit revocation of direct public/anon/authenticated access and service-role grants. Authenticated server routes are the only access path.

## Files

- `app/api/wa-agents/bot-templates/{route.ts,_shared.ts,route.test.ts,[id]/route.ts}`
- `app/api/wa-agents/bots/route.ts`, `app/api/wa-agents/bots/[id]/route.ts`
- `app/api/wa-agents/options/route.ts` (superadmin owner exclusion)
- `features/wa-agents/BotList.tsx`, `features/wa-agents/BotEditor.tsx`
- `features/wa-agents/templates/{BotTemplateActions.tsx,BotTemplateLibrary.tsx,useBotTemplates.ts}`
- `lib/wa-agents/{botTemplates.ts,botTemplates.test.ts,botTemplateDependencies.ts,botTemplateResources.ts,botTemplateResources.test.ts}`
- `supabase/migrations/20260924002950_bot_templates.sql`

## Verification evidence

All commands used `PATH=/Users/samuelmacario/.local/node/bin:$PATH` in the assigned worktree.

Initial red (before implementation):

`npx vitest run lib/wa-agents/botTemplates.test.ts`

Output: `Failed to resolve import "./botTemplates"`; `Test Files 1 failed (1)`, `Tests no tests`. The initial tests specified branch/layout roundtrip, secret removal, and invalid input rejection.

Final focused suite:

`npx vitest run lib/wa-agents/botTemplates.test.ts lib/wa-agents/botTemplateResources.test.ts app/api/wa-agents/bot-templates/route.test.ts app/api/wa-agents/bots/'[id]'/route.test.ts lib/wa-agents/botConnections.test.ts lib/wa-agents/bulkBots.test.ts`

Output (exit 0):

```text
✓ lib/wa-agents/bulkBots.test.ts (2 tests)
✓ lib/wa-agents/botTemplateResources.test.ts (5 tests)
✓ lib/wa-agents/botTemplates.test.ts (4 tests)
✓ app/api/wa-agents/bots/[id]/route.test.ts (3 tests)
✓ app/api/wa-agents/bot-templates/route.test.ts (5 tests)
✓ lib/wa-agents/botConnections.test.ts (4 tests)
Test Files 6 passed (6)
Tests 23 passed (23)
Duration 1.72s
```

Coverage includes foreign private snapshot denial, published official visibility without origin identifiers, real-role authorization, invalid import, foreign destination binding rejection, disabled independent copy, unmapped activation rejection, owner and custom-field remapping, URL/secret removal, board-stage mismatch, superadmin owner rejection, and valid CRM-only number-free flows.

`npm run typecheck` → `tsc --noEmit`, exit 0.

`npx eslint --max-warnings 0 lib/wa-agents/botTemplate*.ts features/wa-agents/templates/*.tsx features/wa-agents/templates/*.ts features/wa-agents/BotList.tsx features/wa-agents/BotEditor.tsx app/api/wa-agents/bot-templates app/api/wa-agents/bots/route.ts app/api/wa-agents/bots/'[id]'/route.ts app/api/wa-agents/options/route.ts` → no diagnostics, exit 0.

`git diff --check` → no diagnostics, exit 0.

Supabase skill read; changelog fetched through curl (no relevant breaking change found in the reviewed latest entries), current RLS docs checked, migration command help discovered first. React best-practices checklist reviewed after TSX edits; existing modal/field patterns reused, query cache follows existing waAgents/bots key, pending state memoized.

## Self-review and remaining integration

- Reviewed every table query for org filtering. The only intentional cross-org template read is published official snapshots (or official drafts for real superadmin). Owner profiles queried outside active org are first proven members; publication checks only authenticated user profile ID.
- Migration is intentionally server-only with RLS and no client grants. Runtime SQL/RLS verification awaits controller's staging migration application; no local database was started or mutated.
- API tests use controlled database mocks, not a live Postgres instance. No browser screenshot or staging flow verification was done by this worker. Controller explicitly deferred build and staging integration to the combined delivery after the tags task.
- New official/private libraries start empty. Models are immutable snapshots in this UI: saving creates another snapshot; publication toggles do not affect existing copies.
- Source resource labels currently identify resource type and field location rather than querying original resource names. Users choose destination resources from canonical organization options.
- Source webhook payloads are deliberately cleared entirely to avoid transporting embedded credentials; configure URL, optional secret and body in destination editor. Arbitrary prose cannot be guaranteed free of manually embedded secrets, but all structured webhook secrets/payloads and credential-bearing URLs are removed.
