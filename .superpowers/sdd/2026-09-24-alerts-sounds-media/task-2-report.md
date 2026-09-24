# Task 2 — recovery alerts

Status: implemented, ready for controller review, migration application and staging UI verification. No database was changed, no real bot or customer message touched. Existing dev server left running.

## Behavior

- New linear `activate_alert` robot block with editable message (1–300 chars, default `Respondeu à recuperação`), palette, summary, serialization, runtime and server graph validation. Portable templates preserve it through their existing generic schema/resource mapping; explicit regression added.
- Single persisted `deals.active_alert` snapshot; full creation/ack provenance in dedicated service-only `deal_alert_events`. Atomic activation validates organization, resolved lead and run/bot ownership. Row lock plus unique `(run_id,block_id)` prevents replay/notifications and prevents acknowledged executions reactivating on resume.
- Atomic acknowledgement compares the expected immutable ID. A stale/repeated opening never clears a newer alert or writes duplicate acknowledgement history. Cookie-authenticated route checks origin, org and SELECT visibility through the user RLS client before privileged RPC.
- Cards and list rows use soft emerald backgrounds/outlines plus BellRing and text. Existing badges/tags remain. `Com alertas` is part of existing personal general filters and active-filter count.
- `useAcknowledgeAlert` snapshots only the first resolved alert per opening, never prefetch; cache mutation compares the original ID. Alerts arriving while the modal remains open are preserved for the next opening. Failures leave the alert visible and another opening retries.
- DB mapping + realtime payload mapping use existing DealView cache. New `alert` notification category independently polls when messages/leads are disabled, resolves current responsible seller and existing board/lead visibility, suppresses superseded/acknowledged alerts. Existing delivery dedup, sounds and volume remain intact.
- `alerts` preference defaults true so the requested assigned-lead notice works without enabling messages/leads. Desktop/sound remain opt-in and all old preferences preserved by schema defaults.

## Migration and SQL verification

Created with installed Supabase CLI `migration new deal_recovery_alerts`:
`supabase/migrations/20260924141857_deal_recovery_alerts.sql`.

Controller should review and apply to staging, then run `supabase/tests/deal_recovery_alerts.sql` as postgres. It creates isolated test organizations/deal/manual disabled bot/done run inside BEGIN/ROLLBACK. It checks replay, notification uniqueness, new-version protection, other-org rejection, repeated ack, no reactivation after ack, grants and authenticated direct-write denial. No customer rows are used. Controller confirmed current staging NOT NULL constraints fit this fixture.

All new RPCs are SECURITY INVOKER and service-only. Audit table RLS enabled, client grants revoked; trigger prevents authenticated/anon changes to active_alert even where the deal is otherwise editable. Only current alert payload is visible under existing deals RLS. No schema advisors/SQL execution performed by this worker because database mutations belong to controller.

## Verification

- `npm run typecheck`: passed.
- `npm run lint` (zero warnings): passed.
- Targeted Vitest suite: **15 files, 93 tests passed** (robot engine/serialization/portable templates, notification server/delivery/types/preferences, route auth/org/visibility/CSRF, acknowledgement cache/open lifecycle, filters, realtime).
- `git diff --check`: passed.
- React review: hooks unconditional, no acknowledgement in render/prefetch, stable per-opening ref, no extra cache entity, semantic label/input and text with decorative icon.

## Review notes / limits

- SQL fixture is supplied but not executed; controller must validate migration and fixture against staging and run advisors as appropriate.
- Visual browser verification of board/list/editor and end-to-end realtime across team tabs remains for controller after migration. Background classes were implemented following approved option 2; no production publication performed.
- Old untouched notification feed still limits its replay window to 120 seconds; persistent board alert does not expire with that window.
- `.tmp/` untracked content predates this scoped commit and was excluded.
