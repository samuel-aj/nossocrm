# Personal notifications — STAGING, 2026-09-17

Approved scope: personal, per-organization opt-in preferences for incoming lead messages (own leads or visible leads), new/ transferred leads in selected boards, desktop notifications and optional sound while the CRM is open. Entry point: header bell → Preferências de notificações. All categories default off. MAIN is not released in this round.

## Implementation

- A service-only, RLS-protected ID journal captures incoming message inserts and deal creation/board transfers in the same transaction. Stage-only changes, outgoing messages, edits and deletes do not create alerts. Hydration excludes old WhatsApp history and deleted messages/leads.
- Authenticated, organization-scoped API applies team, legacy board/owner, WhatsApp number/label/owner and personal audience rules before returning any notice. No user or organization overrides accepted in request bodies.
- Global polling every four seconds, with a two-minute overlapping window and paginated IDs, avoids missing transactions that commit out of order. First load/preference change starts a new baseline; no old backlog on login. Temporary network errors retry automatically.
- Web Locks plus short-lived per-user/org markers deduplicate desktop/audio delivery across same-origin tabs. In-app notices remain visible in every tab. Browsers lacking locks/storage retain in-app delivery, avoiding unsafe duplicate audio/desktop fallback.
- Desktop permission is requested only on an explicit click; sound unlocks after interaction. Suspended/offline tabs or a sleeping computer cannot guarantee immediate delivery. No closed-app push.
- Recent in-app notices are session-local (up to 30); account preferences persist in Supabase. “Testar aviso” previews a local notice without sending messages or creating leads.
- Conversation links use exact conversation IDs and support repeated navigation while Chats stays mounted. Existing system notifications remain intact.

## Validation

- 13 focused unit tests: defaults, strict payloads, baseline, scope isolation, team/legacy/WA restrictions, own/all scope, board transfer relevance, cross-tab deduplication and permission prompting.
- STAGING SQL transaction, rolled back: deal creation + transfer emit exactly two events; outgoing and incoming edits/deletes do not emit extra events.
- Browser using a synthetic STAGING account: modal and existing design-system dropdown, preferences save/reload/disable, two simulated categories and two tabs produce exactly one desktop alert per event, exact conversation URL, no JavaScript page errors. Desktop constructor mocked for automated verification; native OS permission/audio remain user-testable through “Testar aviso”. No real WhatsApp sends.
- Real API checks: unauthorized 401, settings 200, initial empty baseline, malformed cursor 400, cross-origin mutation 403, unknown payload field 400.
- Supabase advisors: new tables intentionally have RLS with no authenticated policies, because only the authorized server reads them; client grants are revoked. [Service-only RLS guidance](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Existing unrelated warnings are unchanged.
- TypeScript and production build passed (Next.js Turbopack); changed-file lint passed.
- Full repository tests: 513 passed, 6 failures in existing cache-integrity assertions/snapshot, outdated login redirect expectation and missing useOrgUsers story mock. Related files are unchanged from merged baseline. Focused notification tests pass.
- Full lint includes pre-existing NavigationRail/ActivitiesContext warnings and webhook ts-ignore errors; changed-file lint passes.
- Build exposed pre-existing synchronous searchParams types in join, pipeline alias and lab cockpit pages. Updated those three server pages to await Next.js searchParams; preserved their behavior.

## Release

Base is STAGING f0252ba merged with MAIN df149b3 (merge b6e3e74), preserving the latest robot changes and the STAGING chat demo. Notification migration applied only to mggvzlmquzqcloprxmoe. No production schema or branch changes.
