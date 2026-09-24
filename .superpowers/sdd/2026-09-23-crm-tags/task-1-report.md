# Task 1 — Catálogo e sincronização de etiquetas

Status: implemented; controller review/build pending. Commit: see task commit containing this report (hash recorded in controller handoff).

## Behavior and files

- `supabase/migrations/20260924010603_unified_chat_tags.sql`: canonical `wa_labels`; legacy `tags` becomes a writable security-invoker view. Original legacy rows/IDs/colors retained in private read-only archive. Normalized organization/name uniqueness, preserved chat IDs, legacy IDs reused when not already represented, CSS color mapping, no migration truncation. Existing valid conversation links receive union of all preexisting labels and lead tags; no links inferred from contacts.
- Private database triggers cover direct lead/conversation writes, bots, integrations and forms. Include/removal propagates to exactly the linked lead and all its linked conversations. New links union; relink/unlink leaves old lead untouched. Reject foreign labels/leads and groups linked to leads. Soft-deleted leads detach chats, linked leads cannot move organization. Persistent retired catalog names prevent stale string arrays from recreating deleted/renamed labels; explicit catalog create can restore the name.
- Backend-only atomic chat delta RPC, same-organization validation, and retry for aborted transactions (`40P01`, `40001`). Existing full `labelIds` contract preserved; explicit `{dealId}` selection validates contact/team visibility.
- Both tag APIs share the canonical catalog; CRM responses retain legacy CSS color strings. Batch import uses generated normalized key (no view upsert). Bot options read canonical catalog; old direct cleanup through `tags` still works.
- `lib/whatsapp/{labelCompatibility,conversationLabels}.ts` separate normalization, linked-lead selection, delta payload and retry contracts. `lib/realtime/labelCache.ts` refreshes canonical/raw/detail lead caches, chats, catalog and agent options. Settings catalog reloads on catalog events. Message preview realtime events avoid unnecessary lead refreshes.
- Chats only display/change the persisted linked lead; selector explicitly links/unlinks. Creating a lead links it when a conversation exists. Label dialog saves snapshot deltas. Groups callback from previous task preserved. Model options superadmin-owner exclusion preserved.
- `components/Layout.tsx`: sidebar header now `min-h-16 shrink-0 py-3`, accommodating stacked organization shortcut. No other home changes.
- Spec explicitly documents agreed concurrency boundary.

## Verification

All commands below run with `PATH=/Users/samuelmacario/.local/node/bin:$PATH` from this worktree.

1. Red first: `npx vitest run lib/whatsapp/labelCompatibility.test.ts --maxWorkers=2` failed because the new helper module did not exist, before implementation.
2. Final focused command: `npx vitest run lib/whatsapp/labelCompatibility.test.ts lib/whatsapp/conversationLabels.test.ts lib/realtime/labelCache.test.ts 'app/api/whatsapp/conversations/[id]/route.test.ts' components/MainOrganizationShortcut.test.tsx app/api/superadmin/main-organization/route.test.ts --maxWorkers=2` — **6 files, 23 tests passed** (15 tags + 8 home).
3. `npm run typecheck` — passed, including final implementation.
4. `npx eslint app/api/tags/route.ts 'app/api/tags/[id]/route.ts' app/api/wa-agents/options/route.ts 'app/api/whatsapp/conversations/[id]/route.ts' 'app/api/whatsapp/conversations/[id]/route.test.ts' app/api/whatsapp/labels/route.ts 'app/api/whatsapp/labels/[id]/route.ts' components/Layout.tsx context/settings/SettingsContext.tsx features/chats/ChatsPage.tsx lib/realtime/labelCache.ts lib/realtime/labelCache.test.ts lib/realtime/useRealtimeSync.ts lib/whatsapp/labels.ts lib/whatsapp/labelCompatibility.ts lib/whatsapp/labelCompatibility.test.ts lib/whatsapp/conversationLabels.ts lib/whatsapp/conversationLabels.test.ts --max-warnings 0` — passed. Subsequent changed realtime/UI files also rerun with zero warnings.
5. `git diff --check` — passed.
6. Supabase CLI `migration new --help`, then `migration new unified_chat_tags` generated the migration. Read Supabase RLS docs (security-invoker views and grants). Changelog markdown web fetch failed unsupported content type; no client-library update involved.

Controller performed actual STAGING SQL validation (worker did not apply remote SQL):

- Migration applied twice in one transaction: idempotence passed.
- Populated legacy backfill seed: legacy ID preserved, normalized name and red color retained, original raw name/color archived. Seed organization cascade cleanup passed. `unified_chat_tags_backfill.sql` records a pre-migration psql fixture for repeatability; this exact psql file was not executed locally (no psql/Postgres/docker available).
- `supabase/tests/unified_chat_tags_regression.sql`: **8 cases passed**, rolled back. Controller translated temporary results-table rows into notices for MCP execution. Covers normalized catalog/color, same-contact multiple leads, multiple conversations, bidirectional add/remove, atomic delta, late linking, relink/unlink, groups, cross-org rejection, retirement/recreation, RPC privilege, org moves and soft deletion.
- Regression initially found foreign-ID alias shadowing and organization-cascade tombstone FK failure; both fixed and SQL rerun successfully.
- Controller HTTP harness `.tmp/verify-tags.cjs`: **exit 0**, actual routes + staging database; initial union, concurrent additions from two conversations preserve both, convergence, other same-contact lead untouched, direct integration updates, rename/delete stale resurrection prevention, group/foreign rejection, catalog reads. Fixtures cleaned, no messages sent.
- Authenticated non-superadmin SQL transaction: `SET LOCAL ROLE authenticated` with actual staging admin identity; own-organization direct `tags` INSERT/UPDATE/DELETE and canonical color succeeded; foreign-organization INSERT denied with `42501`; rolled back.
- Controller browser verified sidebar shortcut no longer clips and navigates back to Anúncio Jurídico.

## Limits / review notes

- Legacy clients replacing whole arrays retain last-write-wins semantics. They cannot communicate intent/version; broad versioned lead updates were explicitly out of scope. New chat UI uses atomic deltas. Database fanout is transactional; deadlock/serialization aborts are retried by the chat route, while direct integration clients retain their existing retry responsibility.
- Backfill preserves full source data in the private legacy archive; equivalent normalized names necessarily converge to one canonical ID/color, preferring existing chat label. Existing persisted external legacy-ID references to merged duplicates require a fresh catalog lookup.
- Catalog creation/rename input is limited to 500 characters; migration retains longer legacy strings without truncating. Interactive delta/replacement payloads capped at 500 IDs.
- Build, independent review, deployment and any further staging checks belong to controller. No pushes or production writes performed by worker.

## Review follow-up — persisted-lead authorization (P1)

Independent review `.tmp/tags-review.md` found that conversation access can come from visible lead A while the persisted linked lead B is hidden. Both delta and legacy replacement routes now load `deal_id`, validate the exact linked lead in the same organization and call `getTeamAccess`/`visibleLead` before any mutation. Unlinked/group-local labeling continues; explicit unlink/relink authorizes only the destination because the old lead's labels remain untouched.

The controller also approved closing the authorization/read race. Atomic requests pass captured `p_expected_deal` (including null) with `p_check_link=true`; the RPC checks this under its row lock. Legacy full replacement adds a `deal_id` equality/null condition. A changed link returns 409 and cannot redirect a previously authorized write to a different lead. The RPC keeps one unambiguous signature with optional default arguments, so old backend four-argument calls remain compatible. Public/authenticated execution remains revoked.

Validation:

- Red regression: `npx vitest run 'app/api/whatsapp/conversations/[id]/route.test.ts' --maxWorkers=2` — 4 new assertions failed against the original route (hidden lead returned 200, visible linked lead was never checked).
- Green: `npx vitest run 'app/api/whatsapp/conversations/[id]/route.test.ts' lib/whatsapp/conversationLabels.test.ts lib/whatsapp/labelCompatibility.test.ts --maxWorkers=2` — **3 files, 20 tests passed** (13 route + 7 helpers). Includes both payload forms, denied indirect writes with no update/RPC, visible-link success, unlink/relink preservation, atomic and replacement race rejection.
- `npm run typecheck` — passed.
- `npx eslint 'app/api/whatsapp/conversations/[id]/route.ts' 'app/api/whatsapp/conversations/[id]/route.test.ts' --max-warnings 0` — passed.
- `git diff --check` — passed.
- Controller reapplied SQL authorization fix on staging and all **9 rollback cases passed**, including expected-link mismatch/null rejection and unchanged lead labels on rejection.
- Controller reported broad suite on the preceding commit: 613 passing / 11 known baseline failures; controller repeats build and focused review after this fix.
